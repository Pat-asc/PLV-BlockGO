using Npgsql;

namespace Client_app.Services;

public static class AcademicSectionLifecycleService
{
    public sealed record Result(string Mode, string Department, int YearLevel, int SectionNumber);

    public static async Task<Result?> DeleteOrArchiveAsync(
        NpgsqlConnection connection, int sectionId, string actor,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            string department;
            int yearLevel;
            int sectionNumber;
            bool isActive;
            await using (var section = new NpgsqlCommand(@"
                SELECT department, year_level, section_num, is_active
                FROM academicsections
                WHERE id = @id
                FOR UPDATE;", connection, transaction))
            {
                section.Parameters.AddWithValue("id", sectionId);
                await using var reader = await section.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return null;
                }
                department = reader.GetString(0);
                yearLevel = reader.GetInt32(1);
                sectionNumber = reader.GetInt32(2);
                isActive = reader.GetBoolean(3);
            }

            if (!isActive)
            {
                await transaction.CommitAsync(cancellationToken);
                return new("archived", department, yearLevel, sectionNumber);
            }

            long enrollmentReferences;
            long facultyReferences;
            await using (var dependencies = new NpgsqlCommand(@"
                SELECT
                    (SELECT COUNT(*) FROM student_enrollments WHERE academic_section_id = @id),
                    (SELECT COUNT(*) FROM facultysections WHERE academic_section_id = @id);",
                connection, transaction))
            {
                dependencies.Parameters.AddWithValue("id", sectionId);
                await using var reader = await dependencies.ExecuteReaderAsync(cancellationToken);
                await reader.ReadAsync(cancellationToken);
                enrollmentReferences = reader.GetInt64(0);
                facultyReferences = reader.GetInt64(1);
            }

            if (enrollmentReferences == 0 && facultyReferences == 0)
            {
                await using var delete = new NpgsqlCommand(
                    "DELETE FROM academicsections WHERE id = @id;", connection, transaction);
                delete.Parameters.AddWithValue("id", sectionId);
                await delete.ExecuteNonQueryAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new("deleted", department, yearLevel, sectionNumber);
            }

            // Planning assignments are mutable and must not remain attached to a
            // section removed from current workflows. Finalized enrollment rows
            // remain linked so their historical section identity is preserved.
            await using (var unassignPlanning = new NpgsqlCommand(@"
                UPDATE student_enrollments
                SET academic_section_id = NULL, section = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE academic_section_id = @id AND enrollment_state = 'PLANNING';",
                connection, transaction))
            {
                unassignPlanning.Parameters.AddWithValue("id", sectionId);
                await unassignPlanning.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var deactivateAssignments = new NpgsqlCommand(@"
                UPDATE facultysections
                SET is_active = FALSE, deactivated_at = CURRENT_TIMESTAMP, deactivated_by = @actor
                WHERE academic_section_id = @id AND is_active = TRUE;", connection, transaction))
            {
                deactivateAssignments.Parameters.AddWithValue("id", sectionId);
                deactivateAssignments.Parameters.AddWithValue("actor", actor);
                await deactivateAssignments.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var archive = new NpgsqlCommand(@"
                UPDATE academicsections
                SET is_active = FALSE, archived_at = CURRENT_TIMESTAMP, archived_by = @actor
                WHERE id = @id;", connection, transaction))
            {
                archive.Parameters.AddWithValue("id", sectionId);
                archive.Parameters.AddWithValue("actor", actor);
                await archive.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return new("archived", department, yearLevel, sectionNumber);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
