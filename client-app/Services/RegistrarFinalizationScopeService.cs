using BlockGo.Models;
using Npgsql;

namespace Client_app.Services;

public static class RegistrarFinalizationScopeService
{
    public static async Task<List<AcademicRecord>> GetCurrentApprovedAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT pgr.id, pgr.student_hash, COALESCE(pgr.student_no, ''),
                   COALESCE(pgr.student_name, ''), pgr.section, pgr.course,
                   pgr.subject_code, pgr.grade, pgr.semester, pgr.school_year,
                   pgr.faculty_id, pgr.date, COALESCE(pgr.ipfs_cid, ''),
                   pgr.status, COALESCE(pgr.term, ''), pgr.assignment_cycle_id
            FROM pending_grade_records pgr
            JOIN facultysections fs
              ON fs.id::text = pgr.assignment_cycle_id
             AND fs.is_active = TRUE
             AND LOWER(TRIM(fs.school_year)) = LOWER(TRIM(pgr.school_year))
             AND LOWER(TRIM(fs.semester)) = LOWER(TRIM(pgr.semester))
             AND LOWER(TRIM(fs.subject)) = LOWER(TRIM(pgr.subject_code))
            WHERE LOWER(TRIM(pgr.status)) = 'departmentapproved'
            ORDER BY pgr.school_year, pgr.semester, pgr.course, pgr.section,
                     pgr.subject_code, pgr.student_no, pgr.id;", connection);

        var records = new List<AcademicRecord>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            records.Add(new AcademicRecord
            {
                Id = reader.GetString(0),
                StudentHash = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                StudentId = reader.GetString(2),
                StudentNo = reader.GetString(2),
                StudentName = reader.GetString(3),
                Section = reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
                Course = reader.IsDBNull(5) ? string.Empty : reader.GetString(5),
                Program = reader.IsDBNull(5) ? string.Empty : reader.GetString(5),
                SubjectCode = reader.IsDBNull(6) ? string.Empty : reader.GetString(6),
                Grade = reader.IsDBNull(7) ? string.Empty : reader.GetString(7),
                Semester = reader.IsDBNull(8) ? string.Empty : reader.GetString(8),
                SchoolYear = reader.IsDBNull(9) ? string.Empty : reader.GetString(9),
                FacultyId = reader.IsDBNull(10) ? string.Empty : reader.GetString(10),
                Date = reader.IsDBNull(11) ? string.Empty : reader.GetString(11),
                IpfsCid = reader.GetString(12),
                Status = reader.IsDBNull(13) ? string.Empty : reader.GetString(13),
                Term = reader.GetString(14),
                AssignmentCycleId = reader.IsDBNull(15) ? string.Empty : reader.GetString(15),
                University = "PLV",
                Version = 1
            });
        }

        return records;
    }
}
