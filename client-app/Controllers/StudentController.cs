using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using For_Testing_Only_Capstone.Models;
using System;
using System.Threading.Tasks;
using BlockGo.Models;
using BlockGo.Services;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Globalization;
using Npgsql;

namespace Client_app.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class StudentController : ControllerBase
    {
        private readonly RegistrarDbContext _context;
        private readonly IBlockchainService _blockchain;
        private readonly string _connectionString;
        private readonly ILogger<StudentController> _logger;

        public StudentController(RegistrarDbContext context, IBlockchainService blockchain, IConfiguration configuration, ILogger<StudentController> logger)
        {
            _context = context;
            _blockchain = blockchain;
            _logger = logger;
            _connectionString = configuration.GetConnectionString("MasterConnection")
                ?? configuration.GetConnectionString("PostgresConnection")
                ?? throw new InvalidOperationException("A PostgreSQL connection is required.");
        }

        [HttpGet("profile")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetProfile()
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrEmpty(email)) return Unauthorized();

            try
            {
                using var connection = _context.Database.GetDbConnection();
                await connection.OpenAsync();
                using var command = connection.CreateCommand();

                command.CommandText = @"
                    SELECT phone, sex, middle_name 
                    FROM studentprofiles 
                    WHERE user_id = (SELECT id FROM users WHERE email = @email)";

                var pEmail = command.CreateParameter(); pEmail.ParameterName = "@email"; pEmail.Value = email; command.Parameters.Add(pEmail);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    return Ok(new
                    {
                        phone = reader.IsDBNull(0) ? "" : reader.GetString(0),
                        sex = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        middleName = reader.IsDBNull(2) ? "" : reader.GetString(2)
                    });
                }
                return NotFound(new { message = "Profile not found." });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Profile Fetch Error]: {ex}");
                return StatusCode(500, new { message = "Database error fetching profile.", error = ex.Message });
            }
        }

        [HttpPut("profile")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
        {
            var email = User.Identity?.Name;
            // If the user is an admin/faculty, they might be passing a specific student email
            // (Need to extend UpdateProfileRequest to support this if we want admins to edit others)
            if (string.IsNullOrEmpty(email)) return Unauthorized();

            try
            {
                using var connection = _context.Database.GetDbConnection();
                await connection.OpenAsync();
                using var command = connection.CreateCommand();

                command.CommandText = @"
                    UPDATE studentprofiles 
                    SET phone = @phone, sex = @sex, middle_name = @middleName
                    WHERE user_id = (SELECT id FROM users WHERE email = @email)";

                var pPhone = command.CreateParameter(); pPhone.ParameterName = "@phone"; pPhone.Value = string.IsNullOrEmpty(request.Phone) ? DBNull.Value : request.Phone; command.Parameters.Add(pPhone);
                var pSex = command.CreateParameter(); pSex.ParameterName = "@sex"; pSex.Value = string.IsNullOrEmpty(request.Sex) ? DBNull.Value : request.Sex; command.Parameters.Add(pSex);
                var pMiddleName = command.CreateParameter(); pMiddleName.ParameterName = "@middleName"; pMiddleName.Value = string.IsNullOrEmpty(request.MiddleName) ? DBNull.Value : request.MiddleName; command.Parameters.Add(pMiddleName);
                var pEmail = command.CreateParameter(); pEmail.ParameterName = "@email"; pEmail.Value = email; command.Parameters.Add(pEmail);

                int rowsAffected = await command.ExecuteNonQueryAsync();

                if (rowsAffected == 0) return NotFound(new { message = "Profile not found." });

                return Ok(new { message = "Profile updated successfully." });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Profile Update Error]: {ex}");
                return StatusCode(500, new { message = "Database error updating profile.", error = ex.Message });
            }
        }

        [HttpGet("subjects")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetCurrentSubjects(CancellationToken cancellationToken)
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(email)) return Unauthorized();

            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var enrollment = new NpgsqlCommand(@"
                SELECT sp.student_no, se.school_year, se.semester, se.year_level,
                       p.program_id, p.program_code, p.program_name, s.id, s.section_num,
                       c.curriculum_id
                FROM users u
                JOIN studentprofiles sp ON sp.user_id = u.id
                JOIN LATERAL (
                    SELECT current.* FROM student_enrollments current
                    WHERE current.student_user_id = u.id
                      AND LOWER(TRIM(current.student_no)) = LOWER(TRIM(sp.student_no))
                    ORDER BY current.school_year DESC,
                             CASE current.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC,
                             current.enrollment_id DESC
                    LIMIT 1
                ) se ON TRUE
                JOIN academic_programs p ON p.program_id = se.program_id AND p.is_active = TRUE
                JOIN academicsections s ON s.id = se.academic_section_id
                    AND s.year_level = se.year_level
                    AND LOWER(TRIM(s.department)) IN (LOWER(TRIM(p.program_code)), LOWER(TRIM(p.program_name)))
                JOIN program_curriculum_assignments pca ON pca.program_id = p.program_id
                JOIN curriculums c ON c.curriculum_id = pca.curriculum_id
                    AND c.program_id = p.program_id AND c.status IN ('PUBLISHED', 'ARCHIVED')
                WHERE LOWER(u.email) = LOWER(@email)
                  AND LOWER(u.role) = 'student' AND LOWER(u.status) = 'approved' AND u.is_active
                  AND se.status = 'ENROLLED';", connection);
            enrollment.Parameters.AddWithValue("email", email);
            string studentNo, schoolYear, semester, programCode, department;
            short yearLevel;
            int programId, sectionId, sectionNumber;
            long curriculumId;
            await using (var reader = await enrollment.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                    return NotFound(new { status = "Error", message = "No enrolled academic section with an assigned published curriculum was found for this student." });
                studentNo = reader.GetString(0);
                schoolYear = reader.GetString(1);
                semester = reader.GetString(2);
                yearLevel = reader.GetInt16(3);
                programId = reader.GetInt32(4);
                programCode = reader.GetString(5);
                department = reader.GetString(6);
                sectionId = reader.GetInt32(7);
                sectionNumber = reader.GetInt32(8);
                curriculumId = reader.GetInt64(9);
            }

            var sectionToken = $"{yearLevel}-{sectionNumber}";
            var subjects = new List<object>();
            await using var command = new NpgsqlCommand(@"
                SELECT cs.subject_code, cs.subject_title, cs.units,
                       faculty.full_name
                FROM curriculum_subjects cs
                LEFT JOIN LATERAL (
                    SELECT COALESCE(fp.full_name, u.email) AS full_name
                    FROM facultysections fs
                    JOIN users u ON u.id = fs.user_id
                        AND LOWER(u.role) = 'faculty' AND LOWER(u.status) = 'approved' AND u.is_active
                    LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
                    WHERE LOWER(TRIM(fs.subject)) = LOWER(TRIM(cs.subject_code))
                      AND LOWER(TRIM(fs.department)) IN (LOWER(TRIM(@department)), LOWER(TRIM(@programCode)))
                      AND (
                          SUBSTRING(fs.section FROM '([1-4]-[0-9]+)') = @sectionToken
                          OR (TRIM(fs.section) = @sectionNumber AND TRIM(fs.year_level) = @yearLevel)
                      )
                    ORDER BY u.id LIMIT 1
                ) faculty ON TRUE
                WHERE cs.curriculum_id = @curriculumId
                  AND cs.year_level = @yearLevelNumber AND cs.semester = @semester
                ORDER BY cs.subject_code;", connection);
            command.Parameters.AddWithValue("curriculumId", curriculumId);
            command.Parameters.AddWithValue("yearLevelNumber", yearLevel);
            command.Parameters.AddWithValue("yearLevel", yearLevel.ToString(CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("sectionNumber", sectionNumber.ToString(CultureInfo.InvariantCulture));
            command.Parameters.AddWithValue("sectionToken", sectionToken);
            command.Parameters.AddWithValue("department", department);
            command.Parameters.AddWithValue("programCode", programCode);
            command.Parameters.AddWithValue("semester", semester);
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    subjects.Add(new
                    {
                        subjectCode = reader.GetString(0), subjectTitle = reader.GetString(1),
                        units = reader.GetDecimal(2),
                        facultyName = reader.IsDBNull(3) ? "To be assigned" : reader.GetString(3),
                        status = "Enrolled"
                    });
            }
            return Ok(new { status = "Success", data = new {
                studentNo, schoolYear, semester, section = $"{programCode} {sectionToken}",
                sectionId, yearLevel, department, programCode, programId, curriculumId, subjects
            } });
        }

        [HttpGet("grades")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetHistoricalGrades(CancellationToken cancellationToken)
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(email)) return Unauthorized();

            List<AcademicRecord> records = new();
            try
            {
                var responseJson = await _blockchain.GetAllGradesAsync(email);
                using var responseDocument = JsonDocument.Parse(responseJson);
                var data = responseDocument.RootElement.TryGetProperty("data", out var dataElement)
                    ? dataElement
                    : responseDocument.RootElement;
                records = JsonSerializer.Deserialize<List<AcademicRecord>>(
                    data.GetRawText(),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new List<AcademicRecord>();

                records = records.Where(record =>
                    string.Equals(record.StudentHash, email, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(record.Status, "Finalized", StringComparison.OrdinalIgnoreCase)).ToList();
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Blockchain grade retrieval failed for student {StudentEmail}, checking database fallback.", email);
            }

            if (!records.Any())
            {
                try
                {
                    using var conn = new NpgsqlConnection(_connectionString);
                    await conn.OpenAsync(cancellationToken);
                    using var dbCmd = new NpgsqlCommand(@"
                        SELECT grade.id, grade.student_hash, grade.student_no, grade.student_name,
                               grade.course, grade.subject_code, grade.subject_title, grade.grade,
                               grade.term, grade.status, grade.date, grade.semester, grade.school_year,
                               grade.faculty_id, grade.units, grade.section,
                               COALESCE(enrollment.year_level::text, '') AS year_level
                        FROM pending_grade_records grade
                        JOIN users student ON LOWER(student.email) = LOWER(@email)
                          AND LOWER(student.role) = 'student'
                        JOIN studentprofiles sp ON sp.user_id = student.id
                        LEFT JOIN student_enrollments enrollment
                          ON enrollment.student_user_id = student.id
                         AND enrollment.school_year = grade.school_year
                         AND enrollment.semester = grade.semester
                        WHERE LOWER(grade.student_hash) = LOWER(student.email)
                          AND LOWER(grade.student_no) = LOWER(sp.student_no)
                          AND LOWER(grade.status) = 'finalized'
                        ORDER BY grade.school_year DESC, grade.semester DESC, grade.subject_code ASC", conn);
                    dbCmd.Parameters.AddWithValue("email", email.Trim());
                    using var reader = await dbCmd.ExecuteReaderAsync(cancellationToken);
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        records.Add(new AcademicRecord
                        {
                            Id = reader["id"]?.ToString(),
                            SubjectCode = reader["subject_code"]?.ToString(),
                            SubjectTitle = reader["subject_title"]?.ToString(),
                            Grade = reader["grade"]?.ToString(),
                            Term = reader["term"]?.ToString() ?? "Final",
                            Status = reader["status"]?.ToString(),
                            Date = reader["date"]?.ToString(),
                            StudentHash = reader["student_hash"]?.ToString() ?? reader["student_no"]?.ToString(),
                            StudentNo = reader["student_no"]?.ToString() ?? "",
                            StudentId = reader["student_no"]?.ToString() ?? "",
                            Course = reader["course"]?.ToString(),
                            SchoolYear = reader["school_year"]?.ToString(),
                            Semester = reader["semester"]?.ToString(),
                            FacultyId = reader["faculty_id"]?.ToString(),
                            Units = reader["units"] != DBNull.Value ? Convert.ToInt32(reader["units"]) : 0,
                            Section = reader["section"]?.ToString(),
                            YearLevel = reader["year_level"]?.ToString()
                        });
                    }
                }
                catch (Exception dbEx)
                {
                    _logger.LogWarning(dbEx, "Database fallback failed for student {StudentEmail}", email);
                }
            }

            try
            {
                var facultyNames = await LoadFacultyNamesAsync(records.Select(record => record.FacultyId), cancellationToken);
                var subjectMetadata = await LoadSubjectMetadataAsync(email, cancellationToken);
                var currentEnrollment = await LoadCurrentEnrollmentAsync(email, cancellationToken);
                var grades = new List<object>();
                foreach (var record in records)
                {
                    var yearLevel = ParseYearLevel(record.YearLevel, record.Section);
                    var subjectTitle = !string.IsNullOrWhiteSpace(record.SubjectTitle)
                        ? record.SubjectTitle
                        : subjectMetadata.TryGetValue(record.SubjectCode, out var subject) ? subject.Title : record.SubjectCode;
                    var units = record.Units > 0
                        ? record.Units
                        : subjectMetadata.TryGetValue(record.SubjectCode, out subject) ? subject.Units : 0;
                    var professor = !string.IsNullOrWhiteSpace(record.ProfessorName)
                        ? record.ProfessorName
                        : facultyNames.TryGetValue(record.FacultyId, out var name) ? name : record.FacultyId;
                    var terms = ParseGradeTerms(record.Grade, record.Term);
                    var isCurrentEnrollmentRecord = currentEnrollment != null &&
                        SectionsMatch(record.Section, currentEnrollment.Value.Section);
                    var displaySchoolYear = isCurrentEnrollmentRecord
                        ? currentEnrollment!.Value.SchoolYear
                        : record.SchoolYear;
                    var displaySemester = isCurrentEnrollmentRecord
                        ? currentEnrollment!.Value.Semester
                        : record.Semester;

                    foreach (var term in terms)
                    {
                        grades.Add(new
                        {
                            recordId = record.Id,
                            studentId = string.IsNullOrWhiteSpace(record.StudentId) ? record.StudentNo : record.StudentId,
                            subjectCode = record.SubjectCode,
                            subjectTitle,
                            professor,
                            facultyId = record.FacultyId,
                            committedBy = string.IsNullOrWhiteSpace(record.SubmittedBy) ? professor : record.SubmittedBy,
                            units,
                            yearLevel,
                            semester = displaySemester,
                            schoolYear = displaySchoolYear,
                            term = term.Name,
                            grade = term.Grade,
                            finalAverage = term.FinalAverage,
                            status = record.Status,
                            transactionId = record.TransactionId,
                            transactionHash = string.IsNullOrWhiteSpace(record.TransactionHash) ? record.TransactionId : record.TransactionHash,
                            timestamp = record.Timestamp,
                            date = record.Date
                        });
                    }
                }

                var orderedGrades = grades.OrderBy(item => JsonSerializer.Serialize(item)).ToArray();
                return Ok(new
                {
                    status = "Success",
                    data = orderedGrades,
                    message = orderedGrades.Length == 0 ? "There are currently no grade records available." : null
                });
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Grade processing failed for student {StudentEmail}", email);
                return Ok(new
                {
                    status = "Success",
                    data = Array.Empty<object>(),
                    message = "There are currently no grade records available."
                });
            }
        }

        [HttpGet("blockchain-transactions")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetBlockchainTransactions()
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(email)) return Unauthorized();

            var safeTransactions = new List<object>();
            try
            {
                var responseJson = await _blockchain.GetStudentTransactionsAsync(email);
                using var responseDocument = JsonDocument.Parse(responseJson);
                var data = responseDocument.RootElement.TryGetProperty("data", out var dataElement)
                    ? dataElement
                    : responseDocument.RootElement;
                if (data.ValueKind == JsonValueKind.Array)
                {
                    foreach (var transaction in data.EnumerateArray())
                    {
                        if (!transaction.TryGetProperty("record", out var recordElement)) continue;
                        var record = JsonSerializer.Deserialize<AcademicRecord>(recordElement.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        if (record is null || !string.Equals(record.StudentHash, email, StringComparison.OrdinalIgnoreCase)) continue;

                        var transactionId = GetJsonString(transaction, "transaction_id");
                        safeTransactions.Add(new
                        {
                            transactionId,
                            transactionHash = GetJsonString(transaction, "transaction_hash", transactionId),
                            transactionType = GetJsonString(transaction, "transaction_type", "GRADE_UPDATED"),
                            studentId = string.IsNullOrWhiteSpace(record.StudentId) ? record.StudentNo : record.StudentId,
                            subjectCode = record.SubjectCode,
                            subjectTitle = record.SubjectTitle,
                            professor = string.IsNullOrWhiteSpace(record.ProfessorName) ? record.FacultyId : record.ProfessorName,
                            facultyId = record.FacultyId,
                            program = string.IsNullOrWhiteSpace(record.Program) ? record.Course : record.Program,
                            section = record.Section,
                            yearLevel = ParseYearLevel(record.YearLevel, record.Section),
                            semester = record.Semester,
                            schoolYear = record.SchoolYear,
                            term = string.IsNullOrWhiteSpace(record.Term) ? InferTerm(record.Grade) : record.Term,
                            grade = GetDisplayGrade(record.Grade, record.Term),
                            status = record.Status,
                            timestamp = NormalizeTransactionTimestamp(GetJsonString(transaction, "timestamp", record.Timestamp))
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Blockchain transaction retrieval failed for student {Email}, returning empty list.", email);
            }
            return Ok(new { status = "Success", data = safeTransactions });
        }

        [HttpGet("academic-summary")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetAcademicSummary(CancellationToken cancellationToken)
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(email)) return Unauthorized();

            var records = await LoadFinalizedRecordsAsync(email);
            var metadata = await LoadSubjectMetadataAsync(email, cancellationToken);
            var latestByRecord = records
                .GroupBy(record => record.Id, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.Last())
                .ToArray();
            decimal totalUnits = 0;
            decimal creditedUnits = 0;
            decimal weightedPoints = 0;
            var failedSubjects = 0;
            var gradedSubjects = 0;

            foreach (var record in latestByRecord)
            {
                var numericGrade = FinalNumericGrade(record.Grade);
                if (!numericGrade.HasValue) continue;
                var units = record.Units > 0
                    ? record.Units
                    : metadata.TryGetValue(record.SubjectCode, out var subject) ? subject.Units : 0;
                var equivalent = GradeEquivalent(numericGrade.Value);
                totalUnits += units;
                weightedPoints += equivalent * units;
                gradedSubjects++;
                if (equivalent >= 5m) failedSubjects++;
                else creditedUnits += units;
            }

            return Ok(new
            {
                status = "Success",
                data = new
                {
                    gwa = totalUnits > 0 ? decimal.Round(weightedPoints / totalUnits, 2) : 0m,
                    totalUnits,
                    creditedUnits,
                    failedSubjectsCount = failedSubjects,
                    gradedSubjectsCount = gradedSubjects,
                    deanListEligible = gradedSubjects > 0 && failedSubjects == 0 && totalUnits > 0 && weightedPoints / totalUnits <= 1.75m
                }
            });
        }

        [HttpGet("curriculum-progress")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetCurriculumProgress(CancellationToken cancellationToken)
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(email)) return Unauthorized();
            var finalized = await LoadFinalizedRecordsAsync(email);
            var completed = finalized
                .Where(record => FinalNumericGrade(record.Grade) is decimal grade && GradeEquivalent(grade) < 5m)
                .GroupBy(record => record.SubjectCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.Last(), StringComparer.OrdinalIgnoreCase);

            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand(@"
                SELECT c.curriculum_id, c.curriculum_code, c.curriculum_name, c.curriculum_version,
                       cs.subject_id, cs.subject_code, cs.subject_title, cs.units, cs.year_level, cs.semester,
                       cs.prerequisite, cs.subject_type
                FROM users u
                JOIN studentprofiles sp ON sp.user_id = u.id
                LEFT JOIN LATERAL (
                    SELECT se.program_id
                    FROM student_enrollments se
                    WHERE se.student_user_id = u.id
                    ORDER BY se.updated_at DESC, se.enrollment_id DESC LIMIT 1
                ) enrollment ON TRUE
                JOIN academic_programs p ON p.program_id = enrollment.program_id
                    OR (enrollment.program_id IS NULL AND
                        (LOWER(p.program_name) = LOWER(sp.department) OR LOWER(p.program_code) = LOWER(sp.department)))
                JOIN program_curriculum_assignments pca ON pca.program_id = p.program_id
                JOIN curriculums c ON c.curriculum_id = pca.curriculum_id
                JOIN curriculum_subjects cs ON cs.curriculum_id = c.curriculum_id
                WHERE LOWER(u.email) = LOWER(@email)
                  AND c.status IN ('PUBLISHED', 'ARCHIVED')
                ORDER BY cs.year_level,
                         CASE cs.semester WHEN 'FIRST' THEN 1 WHEN 'SECOND' THEN 2 ELSE 3 END,
                         cs.subject_code;", connection);
            command.Parameters.AddWithValue("email", email);
            var subjects = new List<object>();
            long curriculumId = 0;
            string curriculumCode = "", curriculumName = "", curriculumVersion = "";
            var completedCount = 0;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                curriculumId = reader.GetInt64(0);
                curriculumCode = reader.GetString(1);
                curriculumName = reader.GetString(2);
                curriculumVersion = reader.GetString(3);
                var subjectCode = reader.GetString(5);
                var isCompleted = completed.TryGetValue(subjectCode, out var grade);
                if (isCompleted) completedCount++;
                subjects.Add(new
                {
                    subjectId = reader.GetInt64(4), subjectCode, subjectTitle = reader.GetString(6), units = reader.GetDecimal(7),
                    yearLevel = reader.GetInt16(8), semester = reader.GetString(9),
                    prerequisite = reader.IsDBNull(10) ? null : reader.GetString(10),
                    subjectType = reader.IsDBNull(11) ? null : reader.GetString(11),
                    completionStatus = isCompleted ? "COMPLETED" : "REMAINING",
                    finalGrade = isCompleted ? FinalNumericGrade(grade!.Grade) : null,
                    transactionId = isCompleted ? grade!.TransactionId : null
                });
            }
            if (curriculumId == 0) return NotFound(new { status = "Error", message = "No curriculum is assigned to this student." });
            return Ok(new
            {
                status = "Success",
                data = new { curriculumId, curriculumCode, curriculumName, curriculumVersion, subjects,
                    completedCount, remainingCount = subjects.Count - completedCount }
            });
        }

        private async Task<List<AcademicRecord>> LoadFinalizedRecordsAsync(string email)
        {
            var responseJson = await _blockchain.GetAllGradesAsync(email);
            using var document = JsonDocument.Parse(responseJson);
            var data = document.RootElement.TryGetProperty("data", out var nested) ? nested : document.RootElement;
            return (JsonSerializer.Deserialize<List<AcademicRecord>>(data.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new List<AcademicRecord>())
                .Where(record => string.Equals(record.StudentHash, email, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(record.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        private static decimal? FinalNumericGrade(string? rawGrade)
        {
            if (string.IsNullOrWhiteSpace(rawGrade)) return null;
            if (decimal.TryParse(rawGrade, NumberStyles.Number, CultureInfo.InvariantCulture, out var direct)) return direct;
            try
            {
                using var document = JsonDocument.Parse(rawGrade);
                foreach (var property in new[] { "finalAverage", "finals", "midterm" })
                {
                    if (document.RootElement.TryGetProperty(property, out var value)
                        && decimal.TryParse(value.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
                        return parsed;
                }
            }
            catch (JsonException) { }
            return null;
        }

        private static decimal GradeEquivalent(decimal grade)
        {
            if (grade <= 5m) return grade;
            if (grade >= 98.5m) return 1m;
            if (grade >= 94m) return 1.25m;
            if (grade >= 91m) return 1.5m;
            if (grade >= 88m) return 1.75m;
            if (grade >= 84m) return 2m;
            if (grade >= 81m) return 2.25m;
            if (grade >= 78m) return 2.5m;
            if (grade >= 75m) return 3m;
            return 5m;
        }

        private async Task<Dictionary<string, string>> LoadFacultyNamesAsync(IEnumerable<string> facultyIds, CancellationToken cancellationToken)
        {
            var ids = facultyIds.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (ids.Length == 0) return result;
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = @"
                SELECT u.email, COALESCE(fp.full_name, ap.full_name, u.email)
                FROM users u
                LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
                LEFT JOIN adminprofiles ap ON ap.user_id = u.id
                WHERE u.email = ANY(@ids);";
            var parameter = command.CreateParameter(); parameter.ParameterName = "@ids"; parameter.Value = ids; command.Parameters.Add(parameter);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) result[reader.GetString(0)] = reader.GetString(1);
            return result;
        }

        private async Task<(string SchoolYear, string Semester, string Section)?> LoadCurrentEnrollmentAsync(
            string email,
            CancellationToken cancellationToken)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = @"
                SELECT se.school_year, se.semester, COALESCE(se.section, sp.section, '')
                FROM users u
                JOIN studentprofiles sp ON sp.user_id = u.id
                JOIN student_enrollments se ON se.student_user_id = u.id
                WHERE LOWER(u.email) = LOWER(@email)
                  AND se.status = 'ENROLLED'
                ORDER BY se.updated_at DESC, se.enrollment_id DESC
                LIMIT 1;";
            command.Parameters.AddWithValue("email", email);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return null;
            return (
                reader.IsDBNull(0) ? "" : reader.GetString(0),
                reader.IsDBNull(1) ? "" : reader.GetString(1),
                reader.IsDBNull(2) ? "" : reader.GetString(2));
        }

        private static bool SectionsMatch(string? gradeSection, string? enrollmentSection)
        {
            var grade = Regex.Replace(gradeSection ?? "", @"\s+", " ").Trim();
            var enrollment = Regex.Replace(enrollmentSection ?? "", @"\s+", " ").Trim();
            if (grade.Length == 0 || enrollment.Length == 0) return false;
            return string.Equals(grade, enrollment, StringComparison.OrdinalIgnoreCase) ||
                   grade.EndsWith($" {enrollment}", StringComparison.OrdinalIgnoreCase) ||
                   enrollment.EndsWith($" {grade}", StringComparison.OrdinalIgnoreCase);
        }

        private async Task<Dictionary<string, (string Title, decimal Units)>> LoadSubjectMetadataAsync(string email, CancellationToken cancellationToken)
        {
            var result = new Dictionary<string, (string Title, decimal Units)>(StringComparer.OrdinalIgnoreCase);
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = @"
                SELECT cs.subject_code, cs.subject_title, cs.units
                FROM users u
                JOIN studentprofiles sp ON sp.user_id = u.id
                LEFT JOIN LATERAL (
                    SELECT se.program_id
                    FROM student_enrollments se
                    WHERE se.student_user_id = u.id
                    ORDER BY se.updated_at DESC, se.enrollment_id DESC
                    LIMIT 1
                ) enrollment ON TRUE
                JOIN academic_programs p ON p.program_id = enrollment.program_id
                    OR (enrollment.program_id IS NULL AND
                        (LOWER(p.program_name) = LOWER(sp.department) OR LOWER(p.program_code) = LOWER(sp.department)))
                JOIN program_curriculum_assignments pca ON pca.program_id = p.program_id
                JOIN curriculums c ON c.curriculum_id = pca.curriculum_id
                    AND c.status IN ('PUBLISHED', 'ARCHIVED')
                JOIN curriculum_subjects cs ON cs.curriculum_id = c.curriculum_id
                WHERE LOWER(u.email) = LOWER(@email);";
            var parameter = command.CreateParameter(); parameter.ParameterName = "@email"; parameter.Value = email; command.Parameters.Add(parameter);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) result[reader.GetString(0)] = (reader.GetString(1), reader.GetDecimal(2));
            return result;
        }

        private static IReadOnlyCollection<(string Name, string Grade, string FinalAverage)> ParseGradeTerms(string rawGrade, string explicitTerm)
        {
            var terms = new List<(string Name, string Grade, string FinalAverage)>();
            if (!string.IsNullOrWhiteSpace(rawGrade) && rawGrade.TrimStart().StartsWith("{"))
            {
                try
                {
                    using var document = JsonDocument.Parse(rawGrade);
                    var finalAverage = GetJsonString(document.RootElement, "finalAverage");
                    var midterm = GetJsonString(document.RootElement, "midterm");
                    var finals = GetJsonString(document.RootElement, "finals");
                    if (!string.IsNullOrWhiteSpace(midterm)) terms.Add(("midterm", midterm, finalAverage));
                    if (!string.IsNullOrWhiteSpace(finals)) terms.Add(("finals", finals, finalAverage));
                }
                catch { }
            }
            if (terms.Count == 0) terms.Add((string.IsNullOrWhiteSpace(explicitTerm) ? "finals" : explicitTerm.ToLowerInvariant(), rawGrade, rawGrade));
            return terms;
        }

        private static string GetDisplayGrade(string rawGrade, string explicitTerm)
        {
            var term = string.IsNullOrWhiteSpace(explicitTerm) ? InferTerm(rawGrade) : explicitTerm;
            return ParseGradeTerms(rawGrade, term).FirstOrDefault(value => string.Equals(value.Name, term, StringComparison.OrdinalIgnoreCase)).Grade
                ?? ParseGradeTerms(rawGrade, term).LastOrDefault().Grade
                ?? rawGrade;
        }

        private static string InferTerm(string rawGrade) => ParseGradeTerms(rawGrade, "midterm").Any(value => value.Name == "finals") ? "finals" : "midterm";

        private static string NormalizeTransactionTimestamp(string rawTimestamp)
        {
            if (string.IsNullOrWhiteSpace(rawTimestamp)) return "";

            var fabricTimestamp = Regex.Match(
                rawTimestamp,
                @"^seconds:\s*(-?\d+)\s+nanos:\s*(\d+)\s*$",
                RegexOptions.IgnoreCase);

            if (fabricTimestamp.Success &&
                long.TryParse(fabricTimestamp.Groups[1].Value, out var seconds) &&
                long.TryParse(fabricTimestamp.Groups[2].Value, out var nanoseconds))
            {
                try
                {
                    return DateTimeOffset
                        .FromUnixTimeSeconds(seconds)
                        .AddTicks(nanoseconds / 100)
                        .ToString("O", CultureInfo.InvariantCulture);
                }
                catch (ArgumentOutOfRangeException)
                {
                    return rawTimestamp;
                }
            }

            if (DateTimeOffset.TryParse(
                rawTimestamp,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsedTimestamp))
            {
                return parsedTimestamp.ToString("O", CultureInfo.InvariantCulture);
            }

            return rawTimestamp;
        }

        private static int ParseYearLevel(string? value, string? section)
        {
            var match = Regex.Match($"{value} {section}", @"\b([1-4])(?:st|nd|rd|th)?\b", RegexOptions.IgnoreCase);
            return match.Success && int.TryParse(match.Groups[1].Value, out var year) ? year : 0;
        }

        private static string GetJsonString(JsonElement element, string property, string fallback = "")
        {
            if (!element.TryGetProperty(property, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return fallback;
            return value.ValueKind == JsonValueKind.String ? value.GetString() ?? fallback : value.ToString();
        }
    }

    public class UpdateProfileRequest
    {
        public string? Phone { get; set; }
        public string? Sex { get; set; }
        public string? MiddleName { get; set; }
    }
}
