#!/usr/bin/env python3
"""Classify repository paths without reading credential contents."""

from __future__ import annotations

import argparse
import re
from pathlib import Path, PurePosixPath

EXCEPTION_FILE = Path(__file__).with_name("temporary-credential-rotation-exceptions.txt")
FORBIDDEN_PATTERN = re.compile(
    r"(^|/)(\.env($|\.)|logs?/|ipfs_data/|keystore/)|"
    r"(^|/)(server|client)\.key$|_sk$|\.log$"
)
EXAMPLE_PATTERN = re.compile(r"(^|/)\.env[^/]*\.(example|sample|template)$")


def normalize_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe repository path: {value}")
    return path.as_posix()


def load_exceptions(path: Path = EXCEPTION_FILE) -> frozenset[str]:
    entries = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        entries.append(normalize_path(line))
    if len(entries) != 13 or len(set(entries)) != 13:
        raise ValueError("temporary credential exception manifest must contain exactly 13 unique paths")
    if any(not is_forbidden(item) for item in entries):
        raise ValueError("every temporary exception must be a credential path covered by the blocking policy")
    return frozenset(entries)


def is_forbidden(value: str) -> bool:
    path = normalize_path(value)
    return bool(FORBIDDEN_PATTERN.search(path)) and not EXAMPLE_PATTERN.search(path)


def classify(value: str, exceptions: frozenset[str] | None = None) -> str:
    path = normalize_path(value)
    allowed = exceptions if exceptions is not None else load_exceptions()
    if path in allowed:
        return "temporary-exception"
    return "forbidden" if is_forbidden(path) else "normal"


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate")
    classify_parser = subparsers.add_parser("classify")
    classify_parser.add_argument("path")
    args = parser.parse_args()

    exceptions = load_exceptions()
    if args.command == "validate":
        print(f"Validated {len(exceptions)} exact temporary credential rotation exceptions.")
        return 0
    print(classify(args.path, exceptions))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
