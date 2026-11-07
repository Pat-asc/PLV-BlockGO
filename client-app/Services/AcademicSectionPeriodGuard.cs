using Npgsql;

namespace Client_app.Services;

public static class AcademicSectionPeriodGuard
{
    public static async Task ThrowIfConflictingFacultyAssignmentAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, int sectionId,
        string schoolYear, string semester, CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT school_year, semester
            FROM facultysections
            WHERE academic_section_id = @sectionId AND is_active = TRUE
              AND school_year IS NOT NULL AND semester IS NOT NULL
              AND (school_year <> @schoolYear OR semester <> @semester)
            LIMIT 1
            FOR SHARE;", connection, transaction);
        command.Parameters.AddWithValue("sectionId", sectionId);
        command.Parameters.AddWithValue("schoolYear", schoolYear);
        command.Parameters.AddWithValue("semester", semester);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (await reader.ReadAsync(cancellationToken))
            throw new InvalidOperationException(
                $"Section has an active Faculty assignment for {reader.GetString(0)} {reader.GetString(1)}. " +
                $"Student enrollment for {schoolYear} {semester} cannot be placed in this section.");
    }
}
