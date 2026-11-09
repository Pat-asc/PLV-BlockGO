using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using BlockGo.Models;
using Client_app.Models;
using Npgsql;

namespace Client_app.Services;

public sealed record CompletedSubjectGrade(
    string SubjectCode,
    decimal? FinalGrade,
    string? RecordId,
    string? TransactionId,
    bool IsPassing = true,
    string? SubjectTitle = null,
    decimal Units = 0m,
    string? SourceProgramCode = null,
    string? SourceProgramName = null,
    string? SourceSchoolYear = null,
    string? SourceSemester = null,
    int? SourceYearLevel = null,
    string? RawGrade = null,
    DateTimeOffset? RecordedAt = null);

public sealed record StudentSubjectAttempt(
    long EnrollmentId,
    string StudentEmail,
    string StudentNo,
    string SubjectCode,
    string SchoolYear,
    string Semester,
    string Section,
    string AssignmentCycleId,
    string? PreferredGradeRecordId = null);

public sealed record StudentSubjectGradeResolution(
    AcademicRecord? Record,
    decimal? FinalizedGrade,
    string Availability,
    string MatchBasis)
{
    public bool IsFinalized => Record is not null;
}

public static class StudentSubjectGradeResolver
{
    public const string Finalized = "Finalized";
    public const string NotFinalized = "NotFinalized";
    public const string Ambiguous = "Ambiguous";
    public const string LedgerUnavailable = "LedgerUnavailable";

    public static StudentSubjectGradeResolution Resolve(
        StudentSubjectAttempt attempt,
        IEnumerable<AcademicRecord> records,
        bool ledgerAvailable = true)
    {
        if (!ledgerAvailable)
            return new(null, null, LedgerUnavailable, "ledger-unavailable");

        var candidates = records
            .Where(record => string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase))
            .Where(record => MatchesStudent(record, attempt.StudentEmail, attempt.StudentNo))
            .Where(record => Same(record.SubjectCode, attempt.SubjectCode))
            .Where(record => SamePeriod(record.SchoolYear, record.Semester, attempt.SchoolYear, attempt.Semester))
            .GroupBy(record => record.Id?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(RecordTimestamp).ThenByDescending(record => record.Id, StringComparer.OrdinalIgnoreCase).First())
            .ToList();

        if (candidates.Count == 0)
            return new(null, null, NotFinalized, "no-finalized-record");

        if (!string.IsNullOrWhiteSpace(attempt.PreferredGradeRecordId))
        {
            var exactRecord = candidates.Where(record => Same(record.Id, attempt.PreferredGradeRecordId)).ToList();
            if (exactRecord.Count == 1) return Matched(exactRecord[0], "record-id");
            if (exactRecord.Count > 1) return new(null, null, Ambiguous, "record-id-ambiguous");
        }

        if (!IsLegacyCycle(attempt.AssignmentCycleId))
        {
            var exactCycle = candidates.Where(record =>
                !IsLegacyCycle(record.AssignmentCycleId) && Same(record.AssignmentCycleId, attempt.AssignmentCycleId)).ToList();
            if (exactCycle.Count == 1) return Matched(exactCycle[0], "assignment-cycle");
            if (exactCycle.Count > 1) return new(null, null, Ambiguous, "assignment-cycle-ambiguous");
        }

        var sameSection = candidates.Where(record => SectionsMatch(record.Section, attempt.Section)).ToList();
        if (sameSection.Count == 1) return Matched(sameSection[0], "section");
        if (sameSection.Count > 1) return new(null, null, Ambiguous, "section-ambiguous");

        var legacy = candidates.Where(record => IsLegacyCycle(record.AssignmentCycleId)).ToList();
        if (candidates.Count == 1 && legacy.Count == 1)
            return Matched(candidates[0], "legacy-unambiguous");

        return new(null, null, Ambiguous, "finalized-records-ambiguous");
    }

    public static bool MatchesStudent(AcademicRecord record, string? studentEmail, string? studentNo)
    {
        var email = studentEmail?.Trim() ?? "";
        var emailAccount = email.Split('@')[0];
        var number = studentNo?.Trim() ?? "";
        var recordIdentities = new[] { record.StudentHash, record.StudentId, record.StudentNo }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim());
        var expected = new[] { email, emailAccount, number }
            .Where(value => !string.IsNullOrWhiteSpace(value));
        return recordIdentities.Any(identity => expected.Any(value => Same(identity, value)));
    }

    public static decimal? ParseFinalGrade(string? rawGrade)
    {
        if (string.IsNullOrWhiteSpace(rawGrade)) return null;
        if (decimal.TryParse(rawGrade, NumberStyles.Number, CultureInfo.InvariantCulture, out var direct)) return direct;
        try
        {
            using var document = JsonDocument.Parse(rawGrade);
            foreach (var property in new[] { "finalAverage", "finals", "midterm" })
            {
                if (document.RootElement.TryGetProperty(property, out var value) &&
                    decimal.TryParse(value.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed))
                    return parsed;
            }
        }
        catch (JsonException) { }
        return null;
    }

    public static bool IsPassingFinalizedGrade(string? rawGrade, out decimal? numericGrade)
    {
        numericGrade = null;
        if (string.IsNullOrWhiteSpace(rawGrade)) return false;
        var trimmed = rawGrade.Trim();
        if (trimmed.Contains("dropped", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Contains("incomplete", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "INC", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(trimmed, "DRP", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (trimmed.StartsWith("{", StringComparison.Ordinal))
        {
            try
            {
                using var document = JsonDocument.Parse(trimmed);
                if (document.RootElement.TryGetProperty("standing", out var standingProp))
                {
                    var standing = standingProp.ToString().Trim();
                    if (!string.IsNullOrWhiteSpace(standing) &&
                        !string.Equals(standing, "Active", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(standing, "Passed", StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(standing, "Completed", StringComparison.OrdinalIgnoreCase))
                    {
                        return false;
                    }
                }
            }
            catch (JsonException) { }
        }

        numericGrade = ParseFinalGrade(trimmed);
        if (!numericGrade.HasValue || numericGrade.Value <= 0m) return false;
        var equivalent = numericGrade.Value <= 5m
            ? numericGrade.Value
            : (numericGrade.Value >= 75m ? 3m : 5m);
        return equivalent < 5m;
    }

    public static int SemesterSortOrder(string? semester) => (semester ?? string.Empty).Trim().ToUpperInvariant() switch
    {
        "FIRST" or "1" or "1ST" or "FIRST SEMESTER" or "1ST SEMESTER" => 1,
        "SECOND" or "2" or "2ND" or "SECOND SEMESTER" or "2ND SEMESTER" => 2,
        "MIDYEAR" or "MID-YEAR" or "SUMMER" => 3,
        _ => 99
    };

    public static IReadOnlyList<CurriculumSubjectDto> OrderCurriculumSubjects(IEnumerable<CurriculumSubjectDto> subjects) =>
        subjects
            .OrderBy(subject => subject.IsCrossAssigned || subject.IsNonRegular || subject.IsCrossDepartmentAssigned || subject.Priority == 0 ? 0 : 1)
            .ThenBy(subject => subject.YearLevel)
            .ThenBy(subject => SemesterSortOrder(subject.Semester))
            .ThenBy(subject => subject.SubjectCode, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    public static async Task<Dictionary<string, CompletedSubjectGrade>> LoadDatabaseCompletedSubjectGradesAsync(
        NpgsqlConnection connection,
        string studentEmail,
        CancellationToken cancellationToken = default)
    {
        var completed = new Dictionary<string, CompletedSubjectGrade>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(studentEmail)) return completed;

        string studentNo = string.Empty;
        try
        {
            await using var studentCmd = new NpgsqlCommand(@"
                SELECT COALESCE(sp.student_no, se.student_no, '')
                FROM users u
                LEFT JOIN studentprofiles sp ON sp.user_id = u.id
                LEFT JOIN LATERAL (
                    SELECT student_no
                    FROM student_enrollments
                    WHERE student_user_id = u.id
                    ORDER BY enrollment_id DESC
                    LIMIT 1
                ) se ON TRUE
                WHERE LOWER(u.email) = LOWER(@email)
                LIMIT 1;", connection);
            studentCmd.Parameters.AddWithValue("email", studentEmail.Trim());
            studentNo = (await studentCmd.ExecuteScalarAsync(cancellationToken))?.ToString()?.Trim() ?? string.Empty;
        }
        catch (PostgresException) { }

        try
        {
            await using var gradeCmd = new NpgsqlCommand(@"
                SELECT subject_code, grade, id
                FROM pending_grade_records
                WHERE UPPER(BTRIM(COALESCE(status, ''))) = 'FINALIZED'
                  AND (
                      LOWER(BTRIM(COALESCE(student_hash, ''))) = LOWER(@email)
                      OR (@studentNo <> '' AND LOWER(BTRIM(COALESCE(student_no, ''))) = LOWER(@studentNo))
                  );", connection);
            gradeCmd.Parameters.AddWithValue("email", studentEmail.Trim());
            gradeCmd.Parameters.AddWithValue("studentNo", studentNo);
            await using var reader = await gradeCmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var subjectCode = reader.IsDBNull(0) ? string.Empty : reader.GetString(0).Trim();
                var rawGrade = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
                var recordId = reader.IsDBNull(2) ? null : reader.GetString(2);
                if (!string.IsNullOrWhiteSpace(subjectCode) && IsPassingFinalizedGrade(rawGrade, out var numericGrade) && numericGrade.HasValue)
                {
                    completed[subjectCode] = new CompletedSubjectGrade(subjectCode, numericGrade.Value, recordId, recordId);
                }
            }
        }
        catch (PostgresException) { }

        return completed;
    }

    public static async Task ApplyStudentCurriculumStateAsync(
        NpgsqlConnection connection,
        string studentEmail,
        CurriculumDto curriculum,
        IReadOnlyDictionary<string, CompletedSubjectGrade>? additionalCompleted = null,
        CancellationToken cancellationToken = default)
    {
        // Student Curriculum Checklist uses the version-released Fabric records supplied by
        // CurriculumsController. The database lookup remains a compatibility fallback for
        // callers that do not have ledger data, but it must never override a ledger result.
        var finalized = additionalCompleted is null
            ? await LoadDatabaseCompletedSubjectGradesAsync(connection, studentEmail, cancellationToken)
            : new Dictionary<string, CompletedSubjectGrade>(additionalCompleted, StringComparer.OrdinalIgnoreCase);

        var subjectList = curriculum.Subjects.ToList();
        var byCode = new Dictionary<string, CurriculumSubjectDto>(StringComparer.OrdinalIgnoreCase);
        foreach (var subject in subjectList)
        {
            subject.Priority = subject.IsCrossAssigned || subject.IsNonRegular || subject.IsCrossDepartmentAssigned ? 0 : 1;
            var code = (subject.SubjectCode ?? string.Empty).Trim();
            if (finalized.TryGetValue(code, out var finalizedGrade))
            {
                var fromPreviousProgram = IsDifferentProgram(
                    finalizedGrade.SourceProgramCode,
                    finalizedGrade.SourceProgramName,
                    curriculum.ProgramCode,
                    curriculum.ProgramName);
                subject.FinalGrade = finalizedGrade.FinalGrade;
                subject.TransactionId = finalizedGrade.TransactionId ?? finalizedGrade.RecordId;
                subject.SourceProgramCode = fromPreviousProgram ? finalizedGrade.SourceProgramCode : subject.SourceProgramCode;
                subject.SourceProgramName = fromPreviousProgram ? finalizedGrade.SourceProgramName : subject.SourceProgramName;
                subject.SourceSchoolYear = finalizedGrade.SourceSchoolYear;
                subject.SourceSemester = finalizedGrade.SourceSemester;
                subject.SourceYearLevel = finalizedGrade.SourceYearLevel;
                subject.IsCompleted = finalizedGrade.IsPassing;
                subject.IsCredited = finalizedGrade.IsPassing;
                subject.IsShifterCredit = finalizedGrade.IsPassing && fromPreviousProgram;
                subject.NeedsRetake = !finalizedGrade.IsPassing;
                subject.CompletionStatus = finalizedGrade.IsPassing ? "COMPLETED" : "NEEDS_RETAKE";
                subject.DisplayStatus = finalizedGrade.IsPassing ? "Completed" : "Needs Retake";
            }
            else
            {
                subject.IsCompleted = false;
                subject.IsCredited = false;
                subject.IsShifterCredit = false;
                subject.NeedsRetake = false;
                subject.CompletionStatus = "REMAINING";
                subject.DisplayStatus = "Not Yet Taken";
            }

            if (!string.IsNullOrWhiteSpace(code) && !byCode.ContainsKey(code))
            {
                byCode[code] = subject;
            }
        }

        // Passing subjects from a previous program remain part of the student's academic
        // record even when they do not satisfy a requirement in the current curriculum.
        // They are display-only historical rows and never add to current-program units.
        foreach (var finalizedGrade in finalized.Values
                     .Where(grade => grade.IsPassing)
                     .OrderBy(grade => grade.SourceYearLevel ?? int.MaxValue)
                     .ThenBy(grade => SemesterSortOrder(grade.SourceSemester))
                     .ThenBy(grade => grade.SubjectCode, StringComparer.OrdinalIgnoreCase))
        {
            var code = finalizedGrade.SubjectCode.Trim();
            if (string.IsNullOrWhiteSpace(code) || byCode.ContainsKey(code) ||
                !IsDifferentProgram(finalizedGrade.SourceProgramCode, finalizedGrade.SourceProgramName,
                    curriculum.ProgramCode, curriculum.ProgramName))
            {
                continue;
            }

            var historicalMetadata = await LoadHistoricalSubjectMetadataAsync(
                connection, finalizedGrade, cancellationToken);
            var historical = new CurriculumSubjectDto
            {
                SubjectId = historicalMetadata?.SubjectId ?? 0,
                SubjectCode = code,
                SubjectTitle = FirstNonBlank(finalizedGrade.SubjectTitle, historicalMetadata?.SubjectTitle, code),
                Units = finalizedGrade.Units > 0 ? finalizedGrade.Units : historicalMetadata?.Units ?? 0m,
                LectureHours = historicalMetadata?.LectureHours ?? 0m,
                LaboratoryHours = historicalMetadata?.LaboratoryHours ?? 0m,
                Prerequisite = historicalMetadata?.Prerequisite,
                YearLevel = finalizedGrade.SourceYearLevel ?? historicalMetadata?.YearLevel ?? 1,
                Semester = FirstNonBlank(finalizedGrade.SourceSemester, historicalMetadata?.Semester, CurriculumSemesters.First),
                SubjectType = historicalMetadata?.SubjectType,
                Priority = 1,
                SourceProgramCode = finalizedGrade.SourceProgramCode,
                SourceProgramName = finalizedGrade.SourceProgramName,
                SourceSchoolYear = finalizedGrade.SourceSchoolYear,
                SourceSemester = finalizedGrade.SourceSemester,
                SourceYearLevel = finalizedGrade.SourceYearLevel,
                IsCompleted = true,
                IsCredited = false,
                IsHistorical = true,
                CountsTowardCurriculum = false,
                CompletionStatus = "COMPLETED",
                DisplayStatus = "Completed",
                FinalGrade = finalizedGrade.FinalGrade,
                TransactionId = finalizedGrade.TransactionId ?? finalizedGrade.RecordId
            };
            subjectList.Add(historical);
            byCode[code] = historical;
        }

        try
        {
            await using var crossCmd = new NpgsqlCommand(@"
                SELECT cs.subject_id, cs.subject_code, cs.subject_title, cs.units,
                       COALESCE(cs.lecture_hours, 0), COALESCE(cs.laboratory_hours, 0),
                       cs.prerequisite, cs.year_level, cs.semester, cs.subject_type,
                       p.program_code, p.program_name,
                       COALESCE(NULLIF(TRIM(fs.section), ''), CASE WHEN asec.id IS NOT NULL THEN CONCAT(p.program_code, ' ', asec.year_level, '-', asec.section_num) ELSE NULL END) AS assigned_section,
                       COALESCE(fp.full_name, fu.email) AS assigned_faculty
                FROM users u
                JOIN student_non_regular_subjects nrs ON nrs.student_user_id = u.id
                JOIN curriculum_subjects cs ON cs.subject_id = nrs.subject_id
                LEFT JOIN academic_programs p ON p.program_id = nrs.source_program_id
                LEFT JOIN facultysections fs ON fs.id = nrs.faculty_section_id AND fs.is_active = TRUE
                LEFT JOIN academicsections asec ON asec.id = fs.academic_section_id
                LEFT JOIN users fu ON fu.id = fs.user_id
                LEFT JOIN facultyprofiles fp ON fp.user_id = fu.id
                WHERE LOWER(u.email) = LOWER(@email)
                  AND UPPER(BTRIM(COALESCE(nrs.status, 'ACTIVE'))) = 'ACTIVE'
                ORDER BY cs.year_level,
                         CASE cs.semester WHEN 'FIRST' THEN 1 WHEN 'SECOND' THEN 2 ELSE 3 END,
                         cs.subject_code;", connection);
            crossCmd.Parameters.AddWithValue("email", studentEmail.Trim());
            await using var reader = await crossCmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var subjectId = reader.GetInt64(0);
                var subjectCode = reader.GetString(1).Trim();
                var subjectTitle = reader.GetString(2);
                var units = reader.GetDecimal(3);
                var lectureHours = reader.GetDecimal(4);
                var labHours = reader.GetDecimal(5);
                var prerequisite = reader.IsDBNull(6) ? null : reader.GetString(6);
                var yearLevel = Convert.ToInt32(reader.GetValue(7), CultureInfo.InvariantCulture);
                var semester = reader.GetString(8);
                var subjectType = reader.IsDBNull(9) ? null : reader.GetString(9);
                var sourceProgramCode = reader.IsDBNull(10) ? null : reader.GetString(10);
                var sourceProgramName = reader.IsDBNull(11) ? null : reader.GetString(11);
                var assignedSection = reader.IsDBNull(12) ? null : reader.GetString(12);
                var assignedFaculty = reader.IsDBNull(13) ? null : reader.GetString(13);

                if (byCode.TryGetValue(subjectCode, out var existing))
                {
                    existing.IsCrossAssigned = true;
                    existing.IsNonRegular = true;
                    existing.IsCrossDepartmentAssigned = true;
                    existing.Priority = 0;
                    existing.SourceProgramCode = sourceProgramCode;
                    existing.SourceProgramName = sourceProgramName;
                    existing.AssignedSection = assignedSection;
                    existing.AssignedFaculty = assignedFaculty;
                }
                else
                {
                    var hasFinalizedGrade = finalized.TryGetValue(subjectCode, out var completedGrade);
                    var isCompleted = hasFinalizedGrade && completedGrade!.IsPassing;
                    var crossDto = new CurriculumSubjectDto
                    {
                        SubjectId = subjectId,
                        SubjectCode = subjectCode,
                        SubjectTitle = subjectTitle,
                        Units = units,
                        LectureHours = lectureHours,
                        LaboratoryHours = labHours,
                        Prerequisite = prerequisite,
                        YearLevel = yearLevel,
                        Semester = semester,
                        SubjectType = subjectType,
                        IsCrossDepartmentAssigned = true,
                        IsCrossAssigned = true,
                        IsNonRegular = true,
                        Priority = 0,
                        SourceProgramCode = sourceProgramCode,
                        SourceProgramName = sourceProgramName,
                        AssignedSection = assignedSection,
                        AssignedFaculty = assignedFaculty,
                        IsCompleted = isCompleted,
                        IsCredited = isCompleted,
                        NeedsRetake = hasFinalizedGrade && !completedGrade!.IsPassing,
                        CompletionStatus = isCompleted ? "COMPLETED" : hasFinalizedGrade ? "NEEDS_RETAKE" : "REMAINING",
                        DisplayStatus = isCompleted ? "Completed" : hasFinalizedGrade ? "Needs Retake" : "Not Yet Taken",
                        FinalGrade = isCompleted ? completedGrade!.FinalGrade : null,
                        TransactionId = isCompleted ? (completedGrade!.TransactionId ?? completedGrade.RecordId) : null
                    };
                    subjectList.Add(crossDto);
                    byCode[subjectCode] = crossDto;
                }
            }
        }
        catch (PostgresException) { }

        var ordered = OrderCurriculumSubjects(subjectList);
        curriculum.Subjects = ordered;
        curriculum.RemainingSubjects = ordered.Where(subject => !subject.IsCompleted).ToArray();
        curriculum.CompletedSubjects = ordered.Where(subject => subject.IsCompleted).ToArray();
    }

    private static bool IsDifferentProgram(
        string? sourceCode,
        string? sourceName,
        string? currentCode,
        string? currentName)
    {
        var sourceValues = new[] { sourceCode, sourceName }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim())
            .ToArray();
        if (sourceValues.Length == 0) return false;
        var currentValues = new[] { currentCode, currentName }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim())
            .ToArray();
        return !sourceValues.Any(source => currentValues.Any(current => Same(source, current)));
    }

    private static async Task<CurriculumSubjectDto?> LoadHistoricalSubjectMetadataAsync(
        NpgsqlConnection connection,
        CompletedSubjectGrade grade,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT cs.subject_id, cs.subject_code, cs.subject_title, cs.units,
                   COALESCE(cs.lecture_hours, 0), COALESCE(cs.laboratory_hours, 0),
                   cs.prerequisite, cs.year_level, cs.semester, cs.subject_type
            FROM curriculum_subjects cs
            JOIN curriculums c ON c.curriculum_id = cs.curriculum_id
            JOIN academic_programs p ON p.program_id = c.program_id
            WHERE LOWER(TRIM(cs.subject_code)) = LOWER(TRIM(@subjectCode))
              AND (
                    (@programCode <> '' AND LOWER(TRIM(p.program_code)) = LOWER(TRIM(@programCode)))
                    OR (@programName <> '' AND LOWER(TRIM(p.program_name)) = LOWER(TRIM(@programName)))
                  )
              AND c.status IN ('PUBLISHED', 'ARCHIVED')
            ORDER BY CASE c.status WHEN 'PUBLISHED' THEN 0 ELSE 1 END,
                     c.published_at DESC NULLS LAST,
                     c.curriculum_id DESC
            LIMIT 1;", connection);
        command.Parameters.AddWithValue("subjectCode", grade.SubjectCode.Trim());
        command.Parameters.AddWithValue("programCode", grade.SourceProgramCode?.Trim() ?? string.Empty);
        command.Parameters.AddWithValue("programName", grade.SourceProgramName?.Trim() ?? string.Empty);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new CurriculumSubjectDto
        {
            SubjectId = reader.GetInt64(0),
            SubjectCode = reader.GetString(1),
            SubjectTitle = reader.GetString(2),
            Units = reader.GetDecimal(3),
            LectureHours = reader.GetDecimal(4),
            LaboratoryHours = reader.GetDecimal(5),
            Prerequisite = reader.IsDBNull(6) ? null : reader.GetString(6),
            YearLevel = Convert.ToInt32(reader.GetValue(7), CultureInfo.InvariantCulture),
            Semester = reader.GetString(8),
            SubjectType = reader.IsDBNull(9) ? null : reader.GetString(9)
        };
    }

    private static string FirstNonBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    public static bool SectionsMatch(string? left, string? right)
    {
        static string Token(string? value)
        {
            var normalized = Regex.Replace(value ?? "", @"\s+", " ").Trim();
            var match = Regex.Match(normalized, @"\b([1-4])\s*-\s*(\d+)\b", RegexOptions.IgnoreCase);
            return match.Success ? $"{match.Groups[1].Value}-{int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture)}" : normalized;
        }

        var first = Token(left);
        var second = Token(right);
        return first.Length > 0 && second.Length > 0 && Same(first, second);
    }

    private static StudentSubjectGradeResolution Matched(AcademicRecord record, string basis) =>
        new(record, ParseFinalGrade(record.Grade), Finalized, basis);

    private static bool SamePeriod(string? recordYear, string? recordSemester, string? attemptYear, string? attemptSemester) =>
        string.Equals(GradeAcademicPeriod.SchoolYear(recordYear), GradeAcademicPeriod.SchoolYear(attemptYear), StringComparison.Ordinal) &&
        string.Equals(GradeAcademicPeriod.Semester(recordSemester), GradeAcademicPeriod.Semester(attemptSemester), StringComparison.Ordinal);

    private static bool IsLegacyCycle(string? value) =>
        string.IsNullOrWhiteSpace(value) || Same(value, "legacy");

    private static DateTimeOffset RecordTimestamp(AcademicRecord record) =>
        DateTimeOffset.TryParse(record.Timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var timestamp)
            ? timestamp
            : DateTimeOffset.MinValue;

    private static bool Same(string? left, string? right) =>
        string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);
}
