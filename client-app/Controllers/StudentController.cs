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
using Client_app.Services;

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
                SELECT sp.student_no, se.enrollment_id, se.school_year, se.semester, se.year_level,
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
                JOIN curriculums c ON c.curriculum_id = se.curriculum_id
                    AND c.program_id = p.program_id AND c.status IN ('PUBLISHED', 'ARCHIVED')
                WHERE LOWER(u.email) = LOWER(@email)
                  AND LOWER(u.role) = 'student' AND LOWER(u.status) = 'approved' AND u.is_active
                  AND se.status = 'ENROLLED' AND se.enrollment_state = 'FINALIZED';", connection);
            enrollment.Parameters.AddWithValue("email", email);
            string studentNo, schoolYear, semester, programCode, department;
            long enrollmentId;
            short yearLevel;
            int programId, sectionId, sectionNumber;
            long curriculumId;
            await using (var reader = await enrollment.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                    return NotFound(new { status = "Error", message = "No enrolled academic section with an assigned published curriculum was found for this student." });
                studentNo = reader.GetString(0);
                enrollmentId = reader.GetInt64(1);
                schoolYear = reader.GetString(2);
                semester = reader.GetString(3);
                yearLevel = reader.GetInt16(4);
                programId = reader.GetInt32(5);
                programCode = reader.GetString(6);
                department = reader.GetString(7);
                sectionId = reader.GetInt32(8);
                sectionNumber = reader.GetInt32(9);
                curriculumId = reader.GetInt64(10);
            }

            var sectionToken = $"{yearLevel}-{sectionNumber}";
            var canonicalSection = $"{programCode} {sectionToken}";
            var subjectRows = new List<CurrentSubjectRow>();
            await using var command = new NpgsqlCommand(@"
                SELECT cs.subject_code, cs.subject_title, cs.units,
                       faculty.full_name, faculty.assignment_cycle_id
                FROM curriculum_subjects cs
                LEFT JOIN LATERAL (
                    SELECT COALESCE(fp.full_name, u.email) AS full_name,
                           fs.id::text AS assignment_cycle_id
                    FROM facultysections fs
                    JOIN users u ON u.id = fs.user_id
                        AND LOWER(u.role) = 'faculty' AND LOWER(u.status) = 'approved' AND u.is_active
                    LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
                    WHERE LOWER(TRIM(fs.subject)) = LOWER(TRIM(cs.subject_code))
                      AND fs.academic_section_id = @academicSectionId
                      AND fs.school_year = @schoolYear AND fs.semester = @semester
                      AND fs.is_active = TRUE
                    LIMIT 1
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
            command.Parameters.AddWithValue("schoolYear", schoolYear);
            command.Parameters.AddWithValue("academicSectionId", sectionId);
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                    subjectRows.Add(new CurrentSubjectRow(
                        reader.GetString(0), reader.GetString(1), reader.GetDecimal(2),
                        reader.IsDBNull(3) ? "To be assigned" : reader.GetString(3),
                        reader.IsDBNull(4) ? "" : reader.GetString(4)));
            }

            var ledgerAvailable = true;
            var finalizedRecords = new List<AcademicRecord>();
            try
            {
                finalizedRecords = await LoadLedgerFinalizedRecordsAsync(email, studentNo);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                ledgerAvailable = false;
                _logger.LogWarning(exception,
                    "Fabric finalized-grade read is unavailable for student {StudentNo}; subject cards will report an unavailable state.",
                    studentNo);
            }
            if (ledgerAvailable)
            {
                try
                {
                    await ApplyAssignmentCycleMappingsAsync(connection, finalizedRecords, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception,
                        "Assignment-cycle mappings could not be loaded for student {StudentNo}; safe section/legacy matching will be used.",
                        studentNo);
                }
            }

            var subjects = subjectRows.Select(subject =>
            {
                var attempt = new StudentSubjectAttempt(
                    enrollmentId, email, studentNo, subject.SubjectCode, schoolYear, semester,
                    canonicalSection, subject.AssignmentCycleId);
                var resolved = StudentSubjectGradeResolver.Resolve(attempt, finalizedRecords, ledgerAvailable);
                var record = resolved.Record;
                var equivalent = resolved.FinalizedGrade.HasValue
                    ? GradeEquivalent(resolved.FinalizedGrade.Value).ToString("0.00", CultureInfo.InvariantCulture)
                    : null;
                var gradeStatus = resolved.Availability switch
                {
                    StudentSubjectGradeResolver.LedgerUnavailable => "Temporarily Unavailable",
                    StudentSubjectGradeResolver.Ambiguous => "Verification Required",
                    StudentSubjectGradeResolver.Finalized when equivalent == "5.00" => "Failed",
                    StudentSubjectGradeResolver.Finalized => "Completed",
                    _ => "In Progress"
                };

                _logger.LogInformation(
                    "Student subject grade resolution Student={StudentNo} Subject={SubjectCode} SchoolYear={SchoolYear} Semester={Semester} Section={Section} EnrollmentId={EnrollmentId} FacultySectionId={FacultySectionId} AssignmentCycleId={AssignmentCycleId} GradeRecordId={GradeRecordId} WorkflowStatus={WorkflowStatus} FabricRecordId={FabricRecordId} TransactionId={TransactionId} MatchBasis={MatchBasis}",
                    studentNo, subject.SubjectCode, schoolYear, semester, canonicalSection, enrollmentId,
                    subject.AssignmentCycleId, record?.AssignmentCycleId, record?.Id, record?.Status,
                    record?.Id, record?.TransactionId, resolved.MatchBasis);

                return new
                {
                    subjectCode = subject.SubjectCode,
                    subjectTitle = subject.SubjectTitle,
                    units = subject.Units,
                    schoolYear,
                    semester,
                    section = canonicalSection,
                    professor = subject.FacultyName,
                    facultyName = subject.FacultyName,
                    enrollmentId,
                    assignmentCycleId = string.IsNullOrWhiteSpace(subject.AssignmentCycleId) ? null : subject.AssignmentCycleId,
                    gradeAssignmentCycleId = string.IsNullOrWhiteSpace(record?.AssignmentCycleId) ? null : record.AssignmentCycleId,
                    gradeRecordId = record?.Id,
                    finalizedGrade = resolved.FinalizedGrade,
                    gradeEquivalent = equivalent,
                    gradeStatus,
                    isFinalized = resolved.IsFinalized,
                    gradeAvailability = resolved.Availability,
                    blockchainTransactionId = record?.TransactionId,
                    blockchainTransactionHash = string.IsNullOrWhiteSpace(record?.TransactionHash) ? record?.TransactionId : record.TransactionHash,
                    blockchainRecordId = record?.Id,
                    finalizedAt = string.IsNullOrWhiteSpace(record?.Timestamp) ? record?.Date : record.Timestamp,
                    matchBasis = resolved.MatchBasis,
                    status = gradeStatus
                };
            }).ToArray();

            return Ok(new { status = "Success", data = new {
                studentNo, schoolYear, semester, section = canonicalSection,
                enrollmentId, sectionId, yearLevel, department, programCode, programId, curriculumId,
                gradeLookupStatus = ledgerAvailable ? "Available" : "Unavailable",
                gradeLookupMessage = ledgerAvailable ? null : "Finalized grades are temporarily unavailable because the Fabric ledger could not be read.",
                subjects
            } });
        }

        [HttpGet("grades")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetHistoricalGrades(CancellationToken cancellationToken)
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrWhiteSpace(email)) return Unauthorized();

            List<AcademicRecord> records = new();
            Exception? ledgerReadException = null;
            var studentNo = await LoadStudentNumberAsync(email, cancellationToken);
            try
            {
                records = await LoadLedgerFinalizedRecordsAsync(email, studentNo);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                ledgerReadException = exception;
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
                               COALESCE(enrollment.year_level::text, '') AS year_level,
                               COALESCE(cycle.assignment_cycle_id, grade.assignment_cycle_id, 'legacy') AS assignment_cycle_id,
                               COALESCE(grade.transaction_id, '') AS transaction_id,
                               COALESCE(grade.transaction_hash, '') AS transaction_hash,
                               COALESCE(grade.recorded_at::text, '') AS recorded_at
                        FROM pending_grade_records grade
                        JOIN grade_releases release ON release.record_id = grade.id
                        JOIN users student ON LOWER(student.email) = LOWER(@email)
                          AND LOWER(student.role) = 'student'
                        JOIN studentprofiles sp ON sp.user_id = student.id
                        LEFT JOIN student_enrollments enrollment
                          ON enrollment.student_user_id = student.id
                         AND enrollment.school_year = grade.school_year
                         AND enrollment.semester = grade.semester
                        LEFT JOIN grade_assignment_cycles cycle ON cycle.record_id = grade.id
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
                            Id = reader["id"]?.ToString() ?? "",
                            SubjectCode = reader["subject_code"]?.ToString() ?? "",
                            SubjectTitle = reader["subject_title"]?.ToString() ?? "",
                            Grade = reader["grade"]?.ToString() ?? "",
                            Term = reader["term"]?.ToString() ?? "Final",
                            Status = reader["status"]?.ToString() ?? "",
                            Date = reader["date"]?.ToString() ?? "",
                            StudentHash = reader["student_hash"]?.ToString() ?? reader["student_no"]?.ToString(),
                            StudentNo = reader["student_no"]?.ToString() ?? "",
                            StudentId = reader["student_no"]?.ToString() ?? "",
                            Course = reader["course"]?.ToString() ?? "",
                            SchoolYear = reader["school_year"]?.ToString() ?? "",
                            Semester = reader["semester"]?.ToString() ?? "",
                            FacultyId = reader["faculty_id"]?.ToString() ?? "",
                            Units = reader["units"] != DBNull.Value ? Convert.ToInt32(reader["units"]) : 0,
                            Section = reader["section"]?.ToString() ?? "",
                            YearLevel = reader["year_level"]?.ToString() ?? "",
                            AssignmentCycleId = reader["assignment_cycle_id"]?.ToString() ?? "legacy",
                            TransactionId = reader["transaction_id"]?.ToString() ?? "",
                            TransactionHash = reader["transaction_hash"]?.ToString() ?? "",
                            Timestamp = reader["recorded_at"]?.ToString() ?? ""
                        });
                    }
                }
                catch (Exception dbEx)
                {
                    _logger.LogWarning(dbEx, "Database fallback failed for student {StudentEmail}", email);
                }
            }

            if (records.Count == 0 && ledgerReadException is not null)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    status = "Unavailable",
                    code = "FABRIC_UNAVAILABLE",
                    message = "Finalized grades are temporarily unavailable because the Fabric ledger could not be read."
                });
            }

            try
            {
                await using var mappingConnection = new NpgsqlConnection(_connectionString);
                await mappingConnection.OpenAsync(cancellationToken);
                try
                {
                    await ApplyAssignmentCycleMappingsAsync(mappingConnection, records, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception,
                        "Assignment-cycle mappings could not be loaded for student {StudentNo}; immutable ledger grade history will still be returned.",
                        studentNo);
                }
                var facultyNames = await LoadFacultyNamesAsync(records.Select(record => record.FacultyId), cancellationToken);
                var subjectMetadata = await LoadSubjectMetadataAsync(email, cancellationToken);
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
                            semester = record.Semester,
                            schoolYear = record.SchoolYear,
                            section = record.Section,
                            assignmentCycleId = string.IsNullOrWhiteSpace(record.AssignmentCycleId) ? null : record.AssignmentCycleId,
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
                    SELECT se.program_id, se.curriculum_id
                    FROM student_enrollments se
                    WHERE se.student_user_id = u.id
                    ORDER BY se.updated_at DESC, se.enrollment_id DESC LIMIT 1
                ) enrollment ON TRUE
                JOIN academic_programs p ON p.program_id = enrollment.program_id
                    OR (enrollment.program_id IS NULL AND
                        (LOWER(p.program_name) = LOWER(sp.department) OR LOWER(p.program_code) = LOWER(sp.department)))
                JOIN curriculums c ON c.curriculum_id = enrollment.curriculum_id
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
            var studentNo = await LoadStudentNumberAsync(email, CancellationToken.None);
            return await LoadLedgerFinalizedRecordsAsync(email, studentNo);
        }

        private async Task<List<AcademicRecord>> LoadLedgerFinalizedRecordsAsync(string email, string studentNo)
        {
            var responseJson = await _blockchain.GetAllGradesAsync(email);
            using var document = JsonDocument.Parse(responseJson);
            var data = document.RootElement.TryGetProperty("data", out var nested) ? nested : document.RootElement;
            var releasedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using (var connection = new NpgsqlConnection(_connectionString))
            {
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand(@"
                    SELECT record_id FROM grade_releases
                    WHERE LOWER(student_identifier) IN (LOWER(@email), LOWER(@studentNo));", connection);
                command.Parameters.AddWithValue("email", email);
                command.Parameters.AddWithValue("studentNo", studentNo);
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync()) releasedIds.Add(reader.GetString(0));
            }
            return (JsonSerializer.Deserialize<List<AcademicRecord>>(data.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? new List<AcademicRecord>())
                .Where(record => StudentSubjectGradeResolver.MatchesStudent(record, email, studentNo)
                    && string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase)
                    && releasedIds.Contains(record.Id))
                .ToList();
        }

        private async Task<string> LoadStudentNumberAsync(string email, CancellationToken cancellationToken)
        {
            await using var connection = new NpgsqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand(@"
                SELECT COALESCE(sp.student_no, '')
                FROM users u
                JOIN studentprofiles sp ON sp.user_id = u.id
                WHERE LOWER(u.email) = LOWER(@email)
                LIMIT 1;", connection);
            command.Parameters.AddWithValue("email", email);
            return (await command.ExecuteScalarAsync(cancellationToken))?.ToString() ?? "";
        }

        private static decimal? FinalNumericGrade(string? rawGrade) =>
            StudentSubjectGradeResolver.ParseFinalGrade(rawGrade);

        private static async Task ApplyAssignmentCycleMappingsAsync(
            NpgsqlConnection connection,
            IReadOnlyCollection<AcademicRecord> records,
            CancellationToken cancellationToken)
        {
            var recordIds = records.Select(record => record.Id?.Trim())
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Cast<string>()
                .ToArray();
            if (recordIds.Length == 0) return;

            var mappings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            await using var command = new NpgsqlCommand(@"
                SELECT record_id, assignment_cycle_id
                FROM grade_assignment_cycles
                WHERE record_id = ANY(@recordIds);", connection);
            command.Parameters.AddWithValue("recordIds", recordIds);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                mappings[reader.GetString(0)] = reader.GetString(1);

            foreach (var record in records)
                if (!string.IsNullOrWhiteSpace(record.Id) && mappings.TryGetValue(record.Id, out var cycleId))
                    record.AssignmentCycleId = cycleId;
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
                    SELECT se.program_id, se.curriculum_id
                    FROM student_enrollments se
                    WHERE se.student_user_id = u.id
                    ORDER BY se.updated_at DESC, se.enrollment_id DESC
                    LIMIT 1
                ) enrollment ON TRUE
                JOIN academic_programs p ON p.program_id = enrollment.program_id
                    OR (enrollment.program_id IS NULL AND
                        (LOWER(p.program_name) = LOWER(sp.department) OR LOWER(p.program_code) = LOWER(sp.department)))
                JOIN curriculums c ON c.curriculum_id = enrollment.curriculum_id
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

        private sealed record CurrentSubjectRow(
            string SubjectCode,
            string SubjectTitle,
            decimal Units,
            string FacultyName,
            string AssignmentCycleId);
    }

    public class UpdateProfileRequest
    {
        public string? Phone { get; set; }
        public string? Sex { get; set; }
        public string? MiddleName { get; set; }
    }
}
