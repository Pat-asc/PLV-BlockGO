using BlockGo.Models;
using BlockGo.Services;
using Npgsql;

namespace Client_app.Services;

public static class GradeSubmissionSnapshotService
{
    private static readonly string[] FinalizableStatuses = ["submittedtoregistrar", "departmentapproved"];

    public static async Task<List<AcademicRecord>> LoadStagedAsync(
        NpgsqlConnection connection,
        IReadOnlyCollection<string> recordIds,
        NpgsqlTransaction? transaction = null,
        CancellationToken cancellationToken = default)
    {
        if (recordIds.Count == 0)
            return [];

        await using var command = new NpgsqlCommand(@"
            SELECT pgr.id,
                   COALESCE(pgr.student_hash, ''),
                   COALESCE(NULLIF(BTRIM(pgr.student_no), ''), pgr.student_hash, ''),
                   COALESCE(pgr.student_name, ''),
                   COALESCE(pgr.section, ''),
                   COALESCE(pgr.course, ''),
                   COALESCE(pgr.program, ''),
                   COALESCE(pgr.subject_code, ''),
                   COALESCE(pgr.subject_title, ''),
                   COALESCE(pgr.grade, ''),
                   COALESCE(pgr.semester, ''),
                   COALESCE(pgr.school_year, ''),
                   COALESCE(pgr.term, ''),
                   COALESCE(pgr.faculty_id, ''),
                   COALESCE(pgr.professor_name, ''),
                   COALESCE(pgr.status, ''),
                   COALESCE(pgr.assignment_cycle_id, ''),
                   GREATEST(COALESCE(pgr.submission_version, 1), 1),
                   COALESCE(NULLIF(BTRIM(academic_section.year_level::text), ''),
                            NULLIF(BTRIM(fs.year_level), ''), ''),
                   fs.academic_section_id,
                   COALESCE(NULLIF(pgr.before_submission_grade, ''), pgr.grade, ''),
                   COALESCE(NULLIF(pgr.submitted_grade_snapshot, ''), pgr.grade, ''),
                   COALESCE(pgr.submitted_at, pgr.recorded_at, CURRENT_TIMESTAMP),
                   pgr.returned_at,
                   COALESCE(pgr.return_reason, pgr.note),
                   COALESCE(pgr.units, 0),
                   COALESCE(pgr.submitted_by, '')
            FROM pending_grade_records pgr
            LEFT JOIN facultysections fs
              ON fs.id::text = pgr.assignment_cycle_id
            LEFT JOIN academicsections academic_section
              ON academic_section.id = fs.academic_section_id
            WHERE pgr.id = ANY(@recordIds)
              AND LOWER(TRIM(pgr.status)) = ANY(@statuses)
            ORDER BY pgr.id
            FOR UPDATE OF pgr;", connection, transaction);
        command.Parameters.AddWithValue("recordIds", recordIds.ToArray());
        command.Parameters.AddWithValue("statuses", FinalizableStatuses);

        var records = new List<AcademicRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var course = reader.GetString(5);
            var program = reader.GetString(6);
            var submittedAt = reader.GetFieldValue<DateTimeOffset>(22);
            records.Add(new AcademicRecord
            {
                Id = reader.GetString(0),
                StudentHash = reader.GetString(1),
                StudentId = reader.GetString(2),
                StudentNo = reader.GetString(2),
                StudentName = reader.GetString(3),
                Section = reader.GetString(4),
                Course = course,
                Program = string.IsNullOrWhiteSpace(program) ? course : program,
                SubjectCode = reader.GetString(7),
                SubjectTitle = reader.GetString(8),
                Grade = reader.GetString(9),
                Semester = reader.GetString(10),
                SchoolYear = reader.GetString(11),
                Term = reader.GetString(12),
                FacultyId = reader.GetString(13),
                ProfessorName = reader.GetString(14),
                Status = reader.GetString(15),
                AssignmentCycleId = reader.GetString(16),
                SubmissionVersion = reader.GetInt32(17),
                YearLevel = reader.GetString(18),
                AcademicSectionId = reader.IsDBNull(19) ? null : reader.GetInt32(19),
                BeforeGrade = reader.GetString(20),
                SubmittedGrade = reader.GetString(21),
                SubmittedAt = submittedAt.ToString("O"),
                Timestamp = submittedAt.ToString("O"),
                ReturnedAt = reader.IsDBNull(23)
                    ? null
                    : reader.GetFieldValue<DateTimeOffset>(23).ToString("O"),
                ReturnReason = reader.IsDBNull(24) ? null : reader.GetString(24),
                Units = reader.GetDecimal(25),
                SubmittedBy = reader.GetString(26),
                University = "PLV",
                Version = 1
            });
        }

        return records;
    }

    public static IReadOnlyList<string> MissingRequiredMetadata(AcademicRecord record)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(record.AssignmentCycleId)) missing.Add("assignment_cycle_id");
        if (string.IsNullOrWhiteSpace(record.YearLevel)) missing.Add("year_level");
        if (string.IsNullOrWhiteSpace(record.Section)) missing.Add("section");
        if (string.IsNullOrWhiteSpace(record.SchoolYear)) missing.Add("school_year");
        if (string.IsNullOrWhiteSpace(record.Semester)) missing.Add("semester");
        if (string.IsNullOrWhiteSpace(record.Term)) missing.Add("term");
        if (string.IsNullOrWhiteSpace(record.SubjectCode)) missing.Add("subject_code");
        return missing;
    }

    public static async Task PersistVerifiedFinalizationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        IReadOnlyCollection<AcademicRecord> stagedRecords,
        IReadOnlyCollection<AcademicRecord> finalizedRecords,
        CancellationToken cancellationToken = default)
    {
        var finalizedById = finalizedRecords
            .Where(record => !string.IsNullOrWhiteSpace(record.Id))
            .ToDictionary(record => record.Id, StringComparer.OrdinalIgnoreCase);
        var stagedIdsForRepair = stagedRecords
            .Select(record => record.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var staged in stagedRecords)
        {
            var missing = MissingRequiredMetadata(staged);
            if (missing.Count > 0)
                throw new InvalidOperationException(
                    $"Staged grade {staged.Id} is missing required snapshot metadata: {string.Join(", ", missing)}.");
            if (!finalizedById.TryGetValue(staged.Id, out var finalized) ||
                !string.Equals(finalized.Status, "Finalized", StringComparison.OrdinalIgnoreCase) ||
                !GradeLedgerMatch.IsSameGrade(staged, finalized))
            {
                throw new InvalidOperationException(
                    $"Finalized grade {staged.Id} did not match its approved staging snapshot.");
            }

            var submittedAt = DateTimeOffset.TryParse(staged.SubmittedAt, out var parsedSubmittedAt)
                ? parsedSubmittedAt
                : DateTimeOffset.UtcNow;
            DateTimeOffset? returnedAt = DateTimeOffset.TryParse(staged.ReturnedAt, out var parsedReturnedAt)
                ? parsedReturnedAt
                : null;

            await using var upsert = new NpgsqlCommand(@"
                INSERT INTO grade_submission_snapshots (
                    record_id, assignment_cycle_id, submission_version,
                    student_id, student_name, course, subject_code, subject_name,
                    school_year, semester, term, year_level, section, academic_section_id,
                    faculty_id, before_grade, submitted_grade, status,
                    submitted_at, returned_at, return_reason, finalized_at, transaction_id
                ) VALUES (
                    @recordId, @assignmentCycleId, @submissionVersion,
                    @studentId, @studentName, @course, @subjectCode, @subjectName,
                    @schoolYear, @semester, @term, @yearLevel, @section, @academicSectionId,
                    @facultyId, @beforeGrade, @submittedGrade, 'Finalized',
                    @submittedAt, @returnedAt, @returnReason, CURRENT_TIMESTAMP, @transactionId
                )
                ON CONFLICT (record_id, submission_version) DO UPDATE
                SET assignment_cycle_id = EXCLUDED.assignment_cycle_id,
                    student_id = EXCLUDED.student_id,
                    student_name = EXCLUDED.student_name,
                    course = EXCLUDED.course,
                    subject_code = EXCLUDED.subject_code,
                    subject_name = EXCLUDED.subject_name,
                    school_year = EXCLUDED.school_year,
                    semester = EXCLUDED.semester,
                    term = EXCLUDED.term,
                    year_level = EXCLUDED.year_level,
                    section = EXCLUDED.section,
                    academic_section_id = COALESCE(EXCLUDED.academic_section_id, grade_submission_snapshots.academic_section_id),
                    faculty_id = EXCLUDED.faculty_id,
                    before_grade = EXCLUDED.before_grade,
                    submitted_grade = EXCLUDED.submitted_grade,
                    status = 'Finalized',
                    submitted_at = EXCLUDED.submitted_at,
                    returned_at = EXCLUDED.returned_at,
                    return_reason = EXCLUDED.return_reason,
                    finalized_at = CURRENT_TIMESTAMP,
                    transaction_id = COALESCE(NULLIF(EXCLUDED.transaction_id, ''), grade_submission_snapshots.transaction_id);",
                connection,
                transaction);
            upsert.Parameters.AddWithValue("recordId", staged.Id);
            upsert.Parameters.AddWithValue("assignmentCycleId", staged.AssignmentCycleId);
            upsert.Parameters.AddWithValue("submissionVersion", Math.Max(staged.SubmissionVersion, 1));
            upsert.Parameters.AddWithValue("studentId", FirstNotBlank(staged.StudentNo, staged.StudentId, staged.StudentHash));
            upsert.Parameters.AddWithValue("studentName", staged.StudentName ?? string.Empty);
            upsert.Parameters.AddWithValue("course", FirstNotBlank(staged.Course, staged.Program));
            upsert.Parameters.AddWithValue("subjectCode", staged.SubjectCode);
            upsert.Parameters.AddWithValue("subjectName", staged.SubjectTitle ?? string.Empty);
            upsert.Parameters.AddWithValue("schoolYear", staged.SchoolYear);
            upsert.Parameters.AddWithValue("semester", staged.Semester);
            upsert.Parameters.AddWithValue("term", staged.Term);
            upsert.Parameters.AddWithValue("yearLevel", staged.YearLevel);
            upsert.Parameters.AddWithValue("section", staged.Section);
            upsert.Parameters.AddWithValue(
                "academicSectionId",
                staged.AcademicSectionId.GetValueOrDefault() > 0
                    ? staged.AcademicSectionId.GetValueOrDefault()
                    : DBNull.Value);
            upsert.Parameters.AddWithValue("facultyId", staged.FacultyId ?? string.Empty);
            upsert.Parameters.AddWithValue("beforeGrade", staged.BeforeGrade ?? staged.Grade ?? string.Empty);
            upsert.Parameters.AddWithValue("submittedGrade", staged.SubmittedGrade ?? staged.Grade ?? string.Empty);
            upsert.Parameters.AddWithValue("submittedAt", submittedAt);
            upsert.Parameters.AddWithValue("returnedAt", returnedAt.HasValue ? returnedAt.Value : DBNull.Value);
            upsert.Parameters.AddWithValue("returnReason", string.IsNullOrWhiteSpace(staged.ReturnReason) ? DBNull.Value : staged.ReturnReason);
            upsert.Parameters.AddWithValue("transactionId", finalized.TransactionId ?? string.Empty);
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var finalized in finalizedRecords)
        {
            await using var repair = new NpgsqlCommand(@"
                UPDATE grade_submission_snapshots
                SET status = 'Finalized',
                    finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP),
                    transaction_id = COALESCE(NULLIF(@transactionId, ''), transaction_id)
                WHERE record_id = @recordId;", connection, transaction);
            repair.Parameters.AddWithValue("recordId", finalized.Id);
            repair.Parameters.AddWithValue("transactionId", finalized.TransactionId ?? string.Empty);
            var repaired = await repair.ExecuteNonQueryAsync(cancellationToken);
            if (repaired == 0 && !stagedIdsForRepair.Contains(finalized.Id))
            {
                throw new InvalidOperationException(
                    $"Finalized grade {finalized.Id} has neither approved staging nor an existing submission snapshot to reconcile.");
            }
        }

        if (stagedRecords.Count == 0)
            return;

        var stagedIds = stagedRecords.Select(record => record.Id).ToArray();
        await using var cleanup = new NpgsqlCommand(@"
            DELETE FROM pending_grade_records
            WHERE id = ANY(@recordIds)
              AND LOWER(TRIM(status)) = ANY(@statuses);", connection, transaction);
        cleanup.Parameters.AddWithValue("recordIds", stagedIds);
        cleanup.Parameters.AddWithValue("statuses", FinalizableStatuses);
        var deleted = await cleanup.ExecuteNonQueryAsync(cancellationToken);
        if (deleted != stagedIds.Length)
            throw new InvalidOperationException(
                $"Approved staging changed during finalization cleanup. Expected {stagedIds.Length} rows but deleted {deleted}.");
    }

    private static string FirstNotBlank(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}
