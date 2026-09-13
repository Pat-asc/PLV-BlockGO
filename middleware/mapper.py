import csv
import hashlib
import os
import re
import shutil
import sys
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import ipfshttpclient
import requests
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / "network" / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=False)


class GradeMapper:
    """Validate, encrypt, archive, and submit grading files.

    Security defaults:
      * INTERNAL_API_KEY is environment-only; it is never accepted on the CLI.
      * IPFS_ENCRYPTION_KEY is mandatory; no hard-coded fallback exists.
      * Kubernetes/container environment variables override network/.env.
      * Input files are never rewritten in place.
      * Temporary plaintext/encrypted working files are permission-restricted and
        removed after use.
      * API redirects are disabled so x-api-key cannot be forwarded unexpectedly.
      * IPFS archival fails closed by default.

    Encryption compatibility:
      * legacy-cbc (default) preserves the existing .NET-compatible ciphertext
        format: AES-256-CBC + PKCS7 + zero IV. This is retained only to avoid
        breaking existing consumers.
      * aes-gcm-v1 is available for migration to authenticated encryption, but the
        corresponding decryptor must be upgraded before enabling it.
    """

    LEGACY_MODE = "legacy-cbc"
    GCM_MODE = "aes-gcm-v1"
    GCM_MAGIC = b"BLOCKGO1"
    GCM_AAD = b"blockgo-grade-ipfs-v1"
    CHUNK_SIZE = 1024 * 1024

    def __init__(
        self,
        csharp_api_url=None,
        ipfs_api_url="/ip4/127.0.0.1/tcp/5001/http",
    ):
        self.csharp_url = (
            csharp_api_url
            or os.getenv("CSHARP_API_URL")
            or "http://localhost:5000"
        ).rstrip("/")
        self._validate_api_url(self.csharp_url)
        self.api_endpoint = f"{self.csharp_url}/api/grades/bulk-upload"

        self.api_key = self._require_secret("INTERNAL_API_KEY")
        self.ipfs_secret = self._require_secret("IPFS_ENCRYPTION_KEY")

        self.ipfs_url = os.getenv("IPFS_API_URL", ipfs_api_url)
        self.ipfs_client = None
        self.detected_metadata = {}
        self.active_term = "midterm"

        self.encryption_mode = os.getenv(
            "IPFS_ENCRYPTION_MODE", self.LEGACY_MODE
        ).strip().lower()
        if self.encryption_mode not in {self.LEGACY_MODE, self.GCM_MODE}:
            raise ValueError(
                "IPFS_ENCRYPTION_MODE must be 'legacy-cbc' or 'aes-gcm-v1'."
            )

        # The legacy implementation used the first 32 UTF-8 bytes. Requiring at
        # least 32 bytes removes the previous insecure right-padding fallback while
        # keeping existing 32+ byte secrets compatible.
        secret_bytes = self.ipfs_secret.encode("utf-8")
        if len(secret_bytes) < 32:
            raise ValueError(
                "IPFS_ENCRYPTION_KEY must contain at least 32 UTF-8 bytes. "
                "Use a cryptographically random secret and keep it in .env/Kubernetes Secret."
            )
        self.legacy_encryption_key = secret_bytes[:32]
        self.gcm_encryption_key = hashlib.sha256(secret_bytes).digest()

        self.max_file_bytes = self._positive_int_env(
            "MAX_GRADE_FILE_BYTES", 25 * 1024 * 1024
        )
        self.connect_timeout = self._positive_int_env(
            "GRADE_API_CONNECT_TIMEOUT_SECONDS", 10
        )
        self.read_timeout = self._positive_int_env(
            "GRADE_API_READ_TIMEOUT_SECONDS", 120
        )

        self.http = requests.Session()
        self.http.headers.update({"User-Agent": "BlockGo-GradeMapper/2"})

    @staticmethod
    def _require_secret(name):
        value = os.getenv(name)
        if value is None or not value.strip():
            raise RuntimeError(f"{name} environment variable is required.")
        return value

    @staticmethod
    def _positive_int_env(name, default):
        raw = os.getenv(name)
        if raw is None or not raw.strip():
            return default
        try:
            value = int(raw)
        except ValueError as exc:
            raise ValueError(f"{name} must be an integer.") from exc
        if value <= 0:
            raise ValueError(f"{name} must be greater than zero.")
        return value

    @staticmethod
    def _validate_api_url(url):
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("CSHARP_API_URL must be a valid http:// or https:// URL.")
        if parsed.username or parsed.password:
            raise ValueError("CSHARP_API_URL must not contain embedded credentials.")
        if parsed.fragment:
            raise ValueError("CSHARP_API_URL must not contain a URL fragment.")

    @staticmethod
    def _validate_identity(value, label="faculty_id"):
        value = str(value or "").strip()
        if not value:
            raise ValueError(f"{label} is required.")
        if len(value) > 128:
            raise ValueError(f"{label} is too long.")
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise ValueError(f"{label} contains invalid control characters.")
        return value

    @staticmethod
    def _new_temp_path(suffix):
        handle = tempfile.NamedTemporaryFile(
            mode="wb",
            prefix="blockgo-grade-",
            suffix=suffix,
            delete=False,
        )
        path = Path(handle.name)
        handle.close()
        try:
            os.chmod(path, 0o600)
        except OSError:
            # Windows ACLs do not map directly to POSIX mode bits.
            pass
        return path

    @staticmethod
    def _remove_temp(path):
        if not path:
            return
        try:
            Path(path).unlink(missing_ok=True)
        except Exception as exc:
            print(f"Warning: could not remove temporary file: {exc}")

    def _validate_input_file(self, file_path):
        path = Path(file_path).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File not found: {path}")
        size = path.stat().st_size
        if size <= 0:
            raise ValueError("Input file is empty.")
        if size > self.max_file_bytes:
            raise ValueError(
                f"Input file is too large ({size} bytes). "
                f"Maximum allowed is {self.max_file_bytes} bytes."
            )
        return path

    def set_active_term(self, term=None):
        normalized = str(term or "midterm").strip().lower()
        if normalized not in {"midterm", "finals"}:
            raise ValueError("Term must be 'midterm' or 'finals'.")
        self.active_term = normalized

    def _encrypt_legacy_cbc(self, source_path, destination_path):
        """Preserve current ciphertext compatibility while streaming the file."""
        iv = b"\x00" * 16
        cipher = Cipher(
            algorithms.AES(self.legacy_encryption_key),
            modes.CBC(iv),
        )
        encryptor = cipher.encryptor()
        padder = padding.PKCS7(128).padder()

        with open(source_path, "rb") as source, open(destination_path, "wb") as out:
            while True:
                chunk = source.read(self.CHUNK_SIZE)
                if not chunk:
                    break
                padded = padder.update(chunk)
                if padded:
                    out.write(encryptor.update(padded))

            final_padded = padder.finalize()
            out.write(encryptor.update(final_padded))
            out.write(encryptor.finalize())

    def _encrypt_aes_gcm_v1(self, source_path, destination_path):
        """Authenticated encryption for migration once the decryptor supports it.

        File format:
            8 bytes  magic: BLOCKGO1
            12 bytes random nonce
            N bytes  ciphertext
            16 bytes GCM authentication tag
        """
        nonce = os.urandom(12)
        cipher = Cipher(
            algorithms.AES(self.gcm_encryption_key),
            modes.GCM(nonce),
        )
        encryptor = cipher.encryptor()
        encryptor.authenticate_additional_data(self.GCM_AAD)

        with open(source_path, "rb") as source, open(destination_path, "wb") as out:
            out.write(self.GCM_MAGIC)
            out.write(nonce)

            while True:
                chunk = source.read(self.CHUNK_SIZE)
                if not chunk:
                    break
                encrypted = encryptor.update(chunk)
                if encrypted:
                    out.write(encrypted)

            final = encryptor.finalize()
            if final:
                out.write(final)
            out.write(encryptor.tag)

    def encrypt_file(self, file_path):
        """Encrypt to a restricted temporary file and return its path."""
        source_path = self._validate_input_file(file_path)
        enc_path = self._new_temp_path(".enc")
        try:
            if self.encryption_mode == self.GCM_MODE:
                self._encrypt_aes_gcm_v1(source_path, enc_path)
            else:
                self._encrypt_legacy_cbc(source_path, enc_path)
            return str(enc_path)
        except Exception:
            self._remove_temp(enc_path)
            raise

    def connect_ipfs(self):
        """Establish the IPFS client connection without exposing secrets."""
        try:
            self.ipfs_client = ipfshttpclient.connect(self.ipfs_url)
            print(f"Connected to IPFS at {self.ipfs_url}")
            return True
        except Exception as exc:
            print(f"IPFS connection failed: {exc}")
            return False

    def close(self):
        try:
            if self.ipfs_client is not None and hasattr(self.ipfs_client, "close"):
                self.ipfs_client.close()
        except Exception:
            pass
        try:
            self.http.close()
        except Exception:
            pass

    def upload_to_ipfs(self, file_path):
        """Encrypt and upload the grade file to IPFS. Returns CID or None."""
        enc_path = None
        try:
            self._validate_input_file(file_path)
            enc_path = self.encrypt_file(file_path)

            if not self.ipfs_client and not self.connect_ipfs():
                return None

            response = self.ipfs_client.add(enc_path)
            cid = response.get("Hash") if isinstance(response, dict) else None
            if not cid or not isinstance(cid, str):
                print("IPFS upload failed: no CID was returned.")
                return None
            return cid
        except Exception as exc:
            print(f"IPFS upload failed: {exc}")
            return None
        finally:
            self._remove_temp(enc_path)

    def excel_to_csv(self, excel_path):
        """Convert Excel into a restricted temporary CSV; never rewrite source."""
        csv_path = self._new_temp_path(".csv")
        try:
            suffix = Path(excel_path).suffix.lower()
            if suffix == ".xls":
                import xlrd

                sheet = xlrd.open_workbook(str(excel_path), on_demand=True).sheet_by_index(0)
                rows = (
                    [sheet.cell_value(row, column) for column in range(sheet.ncols)]
                    for row in range(sheet.nrows)
                )
            else:
                import openpyxl

                workbook = openpyxl.load_workbook(
                    str(excel_path),
                    data_only=True,
                    read_only=True,
                )
                sheet = workbook.active
                rows = sheet.iter_rows(values_only=True)

            with open(csv_path, "w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                for row in rows:
                    writer.writerow([self._cell_to_text(value) for value in row])

            print("Converted Excel to temporary CSV for validation.")
            return str(csv_path)
        except Exception as exc:
            self._remove_temp(csv_path)
            print(f"Excel conversion failed: {exc}")
            return None

    def csv_to_working_copy(self, csv_path):
        """Copy user CSV into a restricted temporary file before normalization."""
        working_path = self._new_temp_path(".csv")
        try:
            shutil.copyfile(csv_path, working_path)
            return str(working_path)
        except Exception:
            self._remove_temp(working_path)
            raise

    @staticmethod
    def _cell_to_text(value):
        if value is None:
            return ""
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d")
        return str(value).strip()

    @staticmethod
    def _normalize_header(value):
        value = str(value or "").strip().lower().replace("\ufeff", "")
        value = re.sub(r"[^a-z0-9]+", "_", value)
        return value.strip("_")

    def _compact_header(self, value):
        return re.sub(r"[^a-z0-9]+", "", self._normalize_header(value))

    @staticmethod
    def _column_aliases():
        return {
            "student_id": [
                "student_id", "studentid", "student_no", "studentno", "student_number",
                "studentnumber", "student_num", "id_number", "id_no", "id", "school_id",
                "student_email", "email",
            ],
            "grade": [
                "grade", "final_grade", "finalgrade", "final_average", "finalaverage",
                "average", "computed_grade", "computedgrade", "equivalent", "rating",
            ],
            "midterm": ["midterm", "midterm_grade", "midtermgrade", "mid_term", "prelim"],
            "finals": ["finals", "finals_grade", "finalsgrade", "final_grade_term", "final_term"],
            "course": [
                "course", "program", "degree", "department", "course_name", "coursename",
                "program_name", "programname",
            ],
            "section": ["section", "sec", "class_section", "classsection", "block", "year_section"],
            "subject_code": [
                "subject_code", "subjectcode", "course_code", "coursecode", "subject",
                "subject_id", "subjectid", "code",
            ],
            "subject_name": [
                "subject_name", "subjectname", "subject_title", "subjecttitle",
                "descriptive_title", "description",
            ],
            "semester": ["semester", "sem", "term"],
            "school_year": [
                "school_year", "schoolyear", "sy", "academic_year", "academicyear",
                "acad_year", "acadyear",
            ],
            "year_level": ["year_level", "yearlevel", "level", "year"],
            "date": ["date", "encoded_date", "upload_date"],
            "faculty_id": ["faculty_id", "facultyid", "faculty_email", "facultyemail", "instructor_email"],
            "student_hash": ["student_hash", "studenthash"],
            "ipfs_cid": ["ipfs_cid", "ipfscid", "cid"],
        }

    def _alias_lookup(self):
        lookup = {}
        for target, aliases in self._column_aliases().items():
            for alias in aliases:
                lookup[self._compact_header(alias)] = target
        return lookup

    def _header_match_score(self, row, alias_lookup):
        mapped = set()
        for cell in row:
            compact = self._compact_header(cell)
            if compact in alias_lookup:
                mapped.add(alias_lookup[compact])
        score = len(mapped)
        if "student_id" in mapped:
            score += 3
        if {"grade", "midterm", "finals"} & mapped:
            score += 3
        if {"subject_code", "course", "section"} & mapped:
            score += 1
        return score

    def _find_header_row(self, rows, alias_lookup):
        best_index = 0
        best_score = -1
        max_scan = min(len(rows), 20)

        for index in range(max_scan):
            score = self._header_match_score(rows[index], alias_lookup)
            if score > best_score:
                best_index = index
                best_score = score

        return best_index if best_score > 0 else 0

    def _build_column_map(self, headers, alias_lookup):
        column_map = {}
        normalized_headers = []

        for index, header in enumerate(headers):
            normalized = self._normalize_header(header)
            compact = self._compact_header(header)
            normalized_headers.append(normalized or f"column_{index + 1}")

            target = alias_lookup.get(compact)
            if target and target not in column_map:
                column_map[target] = index

        return column_map, normalized_headers

    @staticmethod
    def _most_common(rows, key):
        values = [row.get(key, "").strip() for row in rows if row.get(key, "").strip()]
        if not values:
            return ""
        return Counter(values).most_common(1)[0][0]

    def _get_by_index(self, row, index):
        return self._cell_to_text(row[index]) if index is not None and index < len(row) else ""

    def _get_mapped_value(self, row, column_map, column_name):
        return self._get_by_index(row, column_map.get(column_name))

    def validate_csv(self, csv_path, ipfs_cid=None):
        try:
            expected_columns = [
                "student_id", "grade", "course", "section", "subject_code",
                "subject_name", "year_level", "semester", "school_year", "date",
                "faculty_id", "student_hash", "midterm", "finals", "ipfs_cid",
            ]

            with open(csv_path, "r", encoding="utf-8-sig", newline="") as handle:
                raw_rows = [
                    [self._cell_to_text(cell) for cell in row]
                    for row in csv.reader(handle)
                    if any(self._cell_to_text(cell) for cell in row)
                ]

            if not raw_rows:
                print("File has no valid data.")
                return False

            alias_lookup = self._alias_lookup()
            header_index = self._find_header_row(raw_rows, alias_lookup)
            headers = raw_rows[header_index]
            data_rows = raw_rows[header_index + 1 :]
            column_map, normalized_headers = self._build_column_map(headers, alias_lookup)

            if "student_id" not in column_map and headers:
                column_map["student_id"] = 0
                print("Student column not labelled. Using first column as student_id.")

            if (
                "grade" not in column_map
                and "midterm" not in column_map
                and "finals" not in column_map
                and len(headers) > 1
            ):
                column_map["grade"] = 1
                print("Grade column not labelled. Using second column as grade.")

            if "student_id" not in column_map:
                print(f"Missing student identifier column. Found headers: {normalized_headers}")
                return False

            if (
                "grade" not in column_map
                and "midterm" not in column_map
                and "finals" not in column_map
            ):
                print(
                    "Missing grade column. Expected grade, final_grade, midterm, or finals. "
                    f"Found headers: {normalized_headers}"
                )
                return False

            rows = []
            for row in data_rows:
                student_id = self._get_mapped_value(row, column_map, "student_id")
                grade = self._get_mapped_value(row, column_map, "grade")
                midterm = (
                    self._get_mapped_value(row, column_map, "midterm")
                    if self.active_term == "midterm"
                    else ""
                )
                finals = (
                    self._get_mapped_value(row, column_map, "finals")
                    if self.active_term == "finals"
                    else ""
                )

                if not student_id or (not grade and not midterm and not finals):
                    continue

                new_row = {}
                for col in expected_columns:
                    if col == "student_id":
                        new_row[col] = student_id
                    elif col == "grade":
                        if self.active_term == "midterm":
                            new_row[col] = grade if grade and not midterm else ""
                        else:
                            new_row[col] = grade if grade and not finals else ""
                    elif col == "midterm":
                        new_row[col] = midterm
                    elif col == "finals":
                        new_row[col] = finals
                    elif col == "ipfs_cid":
                        new_row[col] = ipfs_cid or ""
                    elif col == "date":
                        new_row[col] = (
                            self._get_mapped_value(row, column_map, col)
                            or datetime.now().strftime("%Y-%m-%d")
                        )
                    elif col == "student_hash":
                        new_row[col] = self._get_mapped_value(row, column_map, col) or student_id
                    else:
                        new_row[col] = self._get_mapped_value(row, column_map, col)

                if not new_row["subject_code"]:
                    new_row["subject_code"] = new_row["course"]
                if not new_row["subject_name"]:
                    new_row["subject_name"] = new_row["subject_code"] or new_row["course"]

                rows.append(new_row)

            if not rows:
                print("File has no valid student grade rows.")
                return False

            self.detected_metadata = {
                "semester": self._most_common(rows, "semester"),
                "schoolYear": self._most_common(rows, "school_year"),
                "course": self._most_common(rows, "course") or self._most_common(rows, "subject_code"),
                "facultyId": self._most_common(rows, "faculty_id"),
            }

            with open(csv_path, "w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=expected_columns)
                writer.writeheader()
                writer.writerows(rows)

            detected = ", ".join(
                f"{field}->{headers[index]}"
                for field, index in column_map.items()
                if index < len(headers)
            )
            print(f"File validation passed: {len(rows)} records.")
            print(f"Automatically mapped columns: {detected}")
            return True
        except Exception as exc:
            print(f"File validation error: {exc}")
            return False

    def upload(self, csv_path, faculty_id):
        faculty_id = self._validate_identity(faculty_id)
        if not Path(csv_path).exists():
            print(f"Working CSV not found: {csv_path}")
            return False

        try:
            print(f"Uploading validated grades to {self.api_endpoint}...")
            with open(csv_path, "rb") as handle:
                files = {"file": ("grades.csv", handle, "text/csv")}
                data = {
                    "facultyId": faculty_id,
                    "semester": self.detected_metadata.get("semester", ""),
                    "schoolYear": self.detected_metadata.get("schoolYear", ""),
                    "course": self.detected_metadata.get("course", ""),
                    "term": self.active_term,
                }
                data = {key: value for key, value in data.items() if value}
                headers = {
                    "x-api-key": self.api_key,
                    "x-user-identity": faculty_id,
                }

                response = self.http.post(
                    self.api_endpoint,
                    files=files,
                    data=data,
                    headers=headers,
                    timeout=(self.connect_timeout, self.read_timeout),
                    allow_redirects=False,
                )

            if 300 <= response.status_code < 400:
                print("Upload refused: API returned a redirect. Redirects are disabled for secret-bearing requests.")
                return False

            if response.status_code not in {200, 201}:
                print(f"HTTP {response.status_code}: {response.text[:200]}")
                return False

            try:
                result = response.json()
            except ValueError:
                print("Upload failed: API returned an invalid JSON response.")
                return False

            if not isinstance(result, dict):
                print("Upload failed: API returned an unexpected response shape.")
                return False

            print(f"Status: {result.get('status')}")
            print(f"Success: {result.get('successful')}/{result.get('totalProcessed')}")

            failed = result.get("failed", 0)
            try:
                failed_count = int(failed or 0)
            except (TypeError, ValueError):
                failed_count = 1

            if failed_count > 0:
                print(f"Failed: {failed_count}")
                errors = result.get("errors")
                if isinstance(errors, list):
                    for err in errors[:3]:
                        if isinstance(err, dict):
                            print(f"  - {err.get('studentId')}: {err.get('reason')}")
                return False

            return True

        except requests.RequestException as exc:
            print(f"Grade API request failed: {exc}")
            return False
        except Exception as exc:
            print(f"Upload error: {exc}")
            return False


def is_excel(file_path):
    """Detect ZIP-based XLSX or legacy OLE XLS by file signature."""
    try:
        with open(file_path, "rb") as handle:
            signature = handle.read(8)
            return signature.startswith(b"PK\x03\x04") or signature.startswith(
                b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
            )
    except Exception:
        return False


def main():
    if len(sys.argv) not in {3, 4}:
        print("Usage: python mapper.py <csv_or_xlsx> <faculty_id> [midterm|finals]")
        print("INTERNAL_API_KEY and IPFS_ENCRYPTION_KEY must come from the environment/.env.")
        return 2

    file_path = sys.argv[1]
    faculty_id = sys.argv[2]
    active_term = sys.argv[3] if len(sys.argv) == 4 else "midterm"

    mapper = None
    working_csv = None
    try:
        mapper = GradeMapper()
        source_path = mapper._validate_input_file(file_path)
        faculty_id = mapper._validate_identity(faculty_id)
        mapper.set_active_term(active_term)

        print("Encrypting and archiving grading sheet to IPFS...")
        ipfs_cid = mapper.upload_to_ipfs(source_path)
        if not ipfs_cid:
            print("FATAL ERROR: Grade upload stopped because IPFS archival failed.")
            return 1
        print(f"Grade file archived on IPFS. CID: {ipfs_cid}")

        if is_excel(source_path):
            print("Excel file format detected.")
            working_csv = mapper.excel_to_csv(source_path)
        else:
            if source_path.suffix.lower() != ".csv":
                print("FATAL ERROR: Unsupported file type. Use .csv, .xlsx, or .xls.")
                return 1
            print("CSV file format detected.")
            working_csv = mapper.csv_to_working_copy(source_path)

        if not working_csv:
            print("Failed to prepare a temporary CSV.")
            return 1

        if not mapper.validate_csv(working_csv, ipfs_cid):
            return 1

        return 0 if mapper.upload(working_csv, faculty_id) else 1

    except (RuntimeError, ValueError, FileNotFoundError) as exc:
        print(f"FATAL ERROR: {exc}")
        return 1
    except KeyboardInterrupt:
        print("Upload cancelled.")
        return 130
    except Exception as exc:
        print(f"FATAL ERROR: {exc}")
        return 1
    finally:
        GradeMapper._remove_temp(working_csv)
        if mapper is not None:
            mapper.close()


if __name__ == "__main__":
    sys.exit(main())
