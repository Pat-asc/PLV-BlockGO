using BlockGo.Models;
using BlockGo.Services;
using Npgsql;

namespace Client_app.Services;

public static class TrustedMidtermGradeService
{
    public sealed record Context(
        string AssignmentCycleId,
        string StudentNumber,
        string StudentHash,
        string SubjectCode,
        string Section,
        string SchoolYear,
        string Semester);

    public sealed record Snapshot(string Payload, string Source, string? RecordId = null, string? Status = null);

    public static async Task<Snapshot?> FindPostgresSnapshotAsync(
        NpgsqlConnection connection, Context context, CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT id, grade, status
            FROM pending_grade_records
            WHERE assignment_cycle_id = @assignmentCycleId
              AND LOWER(BTRIM(subject_code)) = LOWER(BTRIM(@subjectCode))
              AND LOWER(BTRIM(section)) = LOWER(BTRIM(@section))
              AND LOWER(BTRIM(school_year)) = LOWER(BTRIM(@schoolYear))
              AND LOWER(BTRIM(semester)) = LOWER(BTRIM(@semester))
              AND LOWER(BTRIM(COALESCE(term, ''))) = 'midterm'
              AND (
                    LOWER(BTRIM(COALESCE(student_no, ''))) = LOWER(BTRIM(@studentNumber))
                    OR (
                        NULLIF(BTRIM(COALESCE(student_no, '')), '') IS NULL
                        AND LOWER(BTRIM(student_hash)) = LOWER(BTRIM(@studentHash))
                    )
                  )
            ORDER BY date DESC NULLS LAST, id
            LIMIT 1;", connection);
        command.Parameters.AddWithValue("assignmentCycleId", context.AssignmentCycleId);
        command.Parameters.AddWithValue("studentNumber", context.StudentNumber);
        command.Parameters.AddWithValue("studentHash", context.StudentHash);
        command.Parameters.AddWithValue("subjectCode", context.SubjectCode);
        command.Parameters.AddWithValue("section", context.Section);
        command.Parameters.AddWithValue("schoolYear", context.SchoolYear);
        command.Parameters.AddWithValue("semester", context.Semester);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var payload = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
        return GradeUploadValuePolicy.HasValueForTerm(payload, GradeAcademicTerm.Midterm)
            ? new Snapshot(payload, "POSTGRESQL_MIDTERM", reader.GetString(0), reader.GetString(2))
            : null;
    }

    public static Snapshot? FindFinalizedLedgerSnapshot(
        IEnumerable<AcademicRecord> records, Context context)
    {
        var match = records
            .Where(record => Matches(record, context))
            .OrderByDescending(record => record.GradeVersion)
            .ThenByDescending(record => record.Version)
            .ThenByDescending(record => record.FinalizedAt ?? record.Timestamp, StringComparer.Ordinal)
            .FirstOrDefault(record => GradeUploadValuePolicy.HasValueForTerm(
                record.Grade, GradeAcademicTerm.Midterm));
        return match is null ? null : new Snapshot(match.Grade, "FABRIC_FINALIZED_MIDTERM", match.Id, match.Status);
    }

    public static bool Matches(AcademicRecord record, Context context)
    {
        var recordStudentNumber = GradeUploadValuePolicy.NormalizeStudentIdentifier(
            string.IsNullOrWhiteSpace(record.StudentNo) ? record.StudentId : record.StudentNo);
        var expectedStudentNumber = GradeUploadValuePolicy.NormalizeStudentIdentifier(context.StudentNumber);
        var studentMatches = !string.IsNullOrWhiteSpace(recordStudentNumber)
            ? string.Equals(recordStudentNumber, expectedStudentNumber, StringComparison.OrdinalIgnoreCase)
            : string.Equals(record.StudentHash?.Trim(), context.StudentHash.Trim(), StringComparison.OrdinalIgnoreCase);

        return studentMatches
            && string.Equals(record.AssignmentCycleId?.Trim(), context.AssignmentCycleId.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(record.SubjectCode?.Trim(), context.SubjectCode.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(record.Section?.Trim(), context.Section.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(record.SchoolYear?.Trim(), context.SchoolYear.Trim(), StringComparison.OrdinalIgnoreCase)
            && string.Equals(GradeAcademicPeriod.Semester(record.Semester), GradeAcademicPeriod.Semester(context.Semester), StringComparison.OrdinalIgnoreCase)
            && GradeAcademicTerm.Normalize(record.Term, string.Empty) == GradeAcademicTerm.Midterm
            && string.Equals(record.Status?.Trim(), "Finalized", StringComparison.OrdinalIgnoreCase);
    }
}
