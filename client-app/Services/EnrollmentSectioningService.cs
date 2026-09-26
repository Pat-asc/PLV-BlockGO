using Npgsql;
using NpgsqlTypes;

namespace Client_app.Services;

// Enrollment is period-specific. StudentProfiles is only a current-profile snapshot.
public static class EnrollmentSectioningService
{
    public sealed record EnrolledStudent(long EnrollmentId, int Id, string StudentNo,
        string FullName, string Email, string? StudentEmail, string Department,
        string YearLevel, string EnrollmentStatus, int? AcademicSectionId, string? Section,
        string? Sex, long? CurriculumId, int? BatchYear, string SchoolYear, string Semester,
        string EnrollmentState);

    public static async Task<List<EnrolledStudent>> GetUnassignedAsync(NpgsqlConnection connection,
        string? department, short? yearLevel, string? schoolYear, string? semester, string? departmentScope)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT e.enrollment_id, u.id, e.student_no, COALESCE(sp.full_name, ''), u.email,
                   sp.student_email, p.program_name, e.year_level::text, e.status,
                   e.academic_section_id, e.section, sp.sex, e.curriculum_id, e.batch_year,
                   e.school_year, e.semester, e.enrollment_state
            FROM student_enrollments e
            JOIN users u ON u.id = e.student_user_id
            JOIN studentprofiles sp ON sp.user_id = u.id
            JOIN academic_programs p ON p.program_id = e.program_id
            WHERE e.status = 'ENROLLED' AND (e.academic_section_id IS NULL OR NULLIF(TRIM(COALESCE(e.section, '')), '') IS NULL)
              AND LOWER(u.role) = 'student' AND LOWER(u.status) = 'approved' AND u.is_active
              AND (@department IS NULL OR LOWER(p.program_code) = LOWER(@department)
                   OR LOWER(p.program_name) = LOWER(@department))
              AND (@scope IS NULL OR LOWER(p.program_code) = LOWER(@scope)
                   OR LOWER(p.program_name) = LOWER(@scope))
              AND (@yearLevel IS NULL OR e.year_level = @yearLevel)
              AND (@schoolYear IS NULL OR e.school_year = @schoolYear)
              AND (@semester IS NULL OR e.semester = @semester)
            ORDER BY e.student_no, e.school_year, e.semester;", connection);
        command.Parameters.Add("department", NpgsqlDbType.Text).Value = (object?)department ?? DBNull.Value;
        command.Parameters.Add("scope", NpgsqlDbType.Text).Value = (object?)departmentScope ?? DBNull.Value;
        command.Parameters.Add("yearLevel", NpgsqlDbType.Smallint).Value = (object?)yearLevel ?? DBNull.Value;
        command.Parameters.Add("schoolYear", NpgsqlDbType.Text).Value = (object?)schoolYear ?? DBNull.Value;
        command.Parameters.Add("semester", NpgsqlDbType.Text).Value = (object?)semester ?? DBNull.Value;
        var result = new List<EnrolledStudent>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new(reader.GetInt64(0), reader.GetInt32(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6), reader.GetString(7), reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetInt32(9), reader.IsDBNull(10) ? null : reader.GetString(10),
                reader.IsDBNull(11) ? null : reader.GetString(11), reader.IsDBNull(12) ? null : reader.GetInt64(12),
                reader.IsDBNull(13) ? null : reader.GetInt32(13), reader.GetString(14), reader.GetString(15),
                reader.GetString(16)));
        return result;
    }

    public static async Task<List<EnrolledStudent>> GetSectionedAsync(NpgsqlConnection connection,
        string? department, short? yearLevel, string? schoolYear, string? semester, string? departmentScope)
    {
        await using var command = new NpgsqlCommand(@"
            SELECT e.enrollment_id, u.id, e.student_no, COALESCE(sp.full_name, ''), u.email,
                   sp.student_email, p.program_name, e.year_level::text, e.status,
                   e.academic_section_id,
                   CONCAT(section.year_level, '-', section.section_num),
                   sp.sex, e.curriculum_id, e.batch_year, e.school_year, e.semester, e.enrollment_state
            FROM student_enrollments e
            JOIN users u ON u.id = e.student_user_id
            JOIN studentprofiles sp ON sp.user_id = u.id
            JOIN academic_programs p ON p.program_id = e.program_id
            JOIN academicsections section ON section.id = e.academic_section_id AND section.is_active = TRUE
            WHERE e.status = 'ENROLLED'
              AND LOWER(u.role) = 'student' AND LOWER(u.status) = 'approved' AND u.is_active
              AND (@department IS NULL OR LOWER(p.program_code) = LOWER(@department)
                   OR LOWER(p.program_name) = LOWER(@department))
              AND (@scope IS NULL OR LOWER(p.program_code) = LOWER(@scope)
                   OR LOWER(p.program_name) = LOWER(@scope))
              AND (@yearLevel IS NULL OR e.year_level = @yearLevel)
              AND (@schoolYear IS NULL OR e.school_year = @schoolYear)
              AND (@semester IS NULL OR e.semester = @semester)
            ORDER BY section.year_level, section.section_num, e.student_no;", connection);
        command.Parameters.Add("department", NpgsqlDbType.Text).Value = (object?)department ?? DBNull.Value;
        command.Parameters.Add("scope", NpgsqlDbType.Text).Value = (object?)departmentScope ?? DBNull.Value;
        command.Parameters.Add("yearLevel", NpgsqlDbType.Smallint).Value = (object?)yearLevel ?? DBNull.Value;
        command.Parameters.Add("schoolYear", NpgsqlDbType.Text).Value = (object?)schoolYear ?? DBNull.Value;
        command.Parameters.Add("semester", NpgsqlDbType.Text).Value = (object?)semester ?? DBNull.Value;
        var result = new List<EnrolledStudent>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            result.Add(new(reader.GetInt64(0), reader.GetInt32(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetString(6), reader.GetString(7), reader.GetString(8), reader.GetInt32(9),
                reader.GetString(10), reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetInt64(12), reader.IsDBNull(13) ? null : reader.GetInt32(13),
                reader.GetString(14), reader.GetString(15), reader.GetString(16)));
        return result;
    }

    public static async Task<(int Count, string Department)> AssignAsync(NpgsqlConnection connection,
        int sectionId, IEnumerable<string> studentIds, string schoolYear, string semester, string? departmentScope,
        IReadOnlyDictionary<string, int>? expectedSectionIds = null)
    {
        var identifiers = studentIds.Select(value => value?.Trim() ?? "").ToArray();
        if (identifiers.Length == 0 || identifiers.Any(string.IsNullOrWhiteSpace))
            throw new ArgumentException("At least one nonblank student ID is required.");
        if (expectedSectionIds?.Any(pair => pair.Value <= 0 || !identifiers.Contains(pair.Key)) == true)
            throw new ArgumentException("Expected section IDs must be positive and refer to students in this request.");
        await using var transaction = await connection.BeginTransactionAsync();
        string department;
        int programId, yearLevel, sectionNumber, maxCapacity;
        await using (var section = new NpgsqlCommand(@"
            SELECT s.department, s.year_level, s.section_num, p.program_id, s.max_capacity
            FROM academicsections s
            JOIN academic_programs p ON LOWER(s.department) IN (LOWER(p.program_code), LOWER(p.program_name))
            WHERE s.id = @id AND s.is_active = TRUE
              AND (@scope IS NULL OR LOWER(@scope) IN (LOWER(p.program_code), LOWER(p.program_name)))
            FOR SHARE OF s;", connection, transaction))
        {
            section.Parameters.AddWithValue("id", sectionId);
            section.Parameters.Add("scope", NpgsqlDbType.Text).Value = (object?)departmentScope ?? DBNull.Value;
            await using var reader = await section.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) throw new KeyNotFoundException("Section not found in your academic program scope.");
            department = reader.GetString(0);
            yearLevel = reader.GetInt32(1);
            sectionNumber = reader.GetInt32(2);
            programId = reader.GetInt32(3);
            maxCapacity = reader.GetInt32(4);
        }

        await using var countCommand = new NpgsqlCommand(@"
            SELECT COUNT(*) FROM student_enrollments
            WHERE academic_section_id = @sectionId AND school_year = @schoolYear
              AND semester = @semester AND status = 'ENROLLED';", connection, transaction);
        countCommand.Parameters.AddWithValue("sectionId", sectionId);
        countCommand.Parameters.AddWithValue("schoolYear", schoolYear);
        countCommand.Parameters.AddWithValue("semester", semester);
        var occupied = Convert.ToInt32(await countCommand.ExecuteScalarAsync());

        var assignedUsers = new HashSet<int>();
        // Stable ordering and row locks serialize competing assignments. The entire request is atomic.
        foreach (var identifier in identifiers.Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase))
        {
            int userId;
            await using (var user = new NpgsqlCommand(@"
                SELECT u.id FROM users u JOIN studentprofiles sp ON sp.user_id = u.id
                WHERE LOWER(u.role) = 'student' AND LOWER(u.status) = 'approved' AND u.is_active
                  AND (u.id::text = @identifier OR LOWER(sp.student_no) = LOWER(@identifier)
                       OR LOWER(u.email) = LOWER(@identifier) OR LOWER(sp.student_email) = LOWER(@identifier))
                FOR UPDATE OF u;", connection, transaction))
            {
                user.Parameters.AddWithValue("identifier", identifier);
                await using var reader = await user.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) throw new InvalidOperationException($"Student '{identifier}' was not found or is inactive.");
                userId = reader.GetInt32(0);
                if (await reader.ReadAsync()) throw new InvalidOperationException($"Student identifier '{identifier}' is ambiguous. Use the student number.");
            }
            if (!assignedUsers.Add(userId)) continue;
            int? currentSectionId;
            string enrollmentState;
            await using (var current = new NpgsqlCommand(@"
                SELECT academic_section_id, enrollment_state
                FROM student_enrollments
                WHERE student_user_id = @userId AND school_year = @schoolYear AND semester = @semester
                  AND status = 'ENROLLED' AND program_id = @programId AND year_level = @yearLevel
                FOR UPDATE;", connection, transaction))
            {
                current.Parameters.AddWithValue("userId", userId);
                current.Parameters.AddWithValue("schoolYear", schoolYear);
                current.Parameters.AddWithValue("semester", semester);
                current.Parameters.AddWithValue("programId", programId);
                current.Parameters.AddWithValue("yearLevel", yearLevel);
                await using var reader = await current.ExecuteReaderAsync();
                if (!await reader.ReadAsync())
                    throw new InvalidOperationException($"Student '{identifier}' has no eligible enrollment for this program and period.");
                currentSectionId = reader.IsDBNull(0) ? null : reader.GetInt32(0);
                enrollmentState = reader.GetString(1);
            }
            if (!string.Equals(enrollmentState, "PLANNING", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Student '{identifier}' enrollment is finalized and locked.");
            if (currentSectionId != sectionId && occupied >= maxCapacity)
                throw new InvalidOperationException($"Section {yearLevel}-{sectionNumber} is full ({occupied}/{maxCapacity}).");
            await using var update = new NpgsqlCommand(@"
                UPDATE student_enrollments
                SET academic_section_id = @sectionId, section = @section, updated_at = CURRENT_TIMESTAMP
                WHERE student_user_id = @userId AND school_year = @schoolYear AND semester = @semester
                  AND status = 'ENROLLED' AND program_id = @programId AND year_level = @yearLevel
                  AND (academic_section_id = @sectionId
                       OR (@expectedSectionId IS NULL AND academic_section_id IS NULL)
                       OR academic_section_id = @expectedSectionId)
                RETURNING enrollment_id;", connection, transaction);
            update.Parameters.AddWithValue("sectionId", sectionId);
            update.Parameters.AddWithValue("section", $"{yearLevel}-{sectionNumber}");
            update.Parameters.AddWithValue("userId", userId);
            update.Parameters.AddWithValue("schoolYear", schoolYear);
            update.Parameters.AddWithValue("semester", semester);
            update.Parameters.AddWithValue("programId", programId);
            update.Parameters.AddWithValue("yearLevel", yearLevel);
            // An explicit move must name the previously saved section. A stale roster
            // cannot overwrite another registrar's intervening assignment.
            update.Parameters.Add("expectedSectionId", NpgsqlDbType.Integer).Value =
                expectedSectionIds != null && expectedSectionIds.TryGetValue(identifier, out var expectedSectionId)
                    ? expectedSectionId : DBNull.Value;
            var enrollmentId = await update.ExecuteScalarAsync();
            if (enrollmentId is null)
                throw new InvalidOperationException($"Student '{identifier}' needs an unassigned ENROLLED record for {schoolYear} {semester} in this program and year level. The student may already belong to another section.");
            if (currentSectionId != sectionId) occupied++;

            // Assigning an older period must not replace the current profile snapshot.
            await using var profile = new NpgsqlCommand(@"
                UPDATE studentprofiles sp SET section = e.section, year_level = e.year_level::text,
                    department = p.program_name, curriculum_id = e.curriculum_id, batch_year = e.batch_year,
                    assignment_status = 'Enrolled'
                FROM student_enrollments e JOIN academic_programs p ON p.program_id = e.program_id
                WHERE e.enrollment_id = @enrollmentId AND sp.user_id = e.student_user_id
                  AND e.enrollment_id = (
                    SELECT latest.enrollment_id FROM student_enrollments latest
                    WHERE latest.student_user_id = e.student_user_id
                    ORDER BY latest.school_year DESC,
                        CASE latest.semester WHEN 'MIDYEAR' THEN 3 WHEN 'SECOND' THEN 2 ELSE 1 END DESC
                    LIMIT 1);", connection, transaction);
            profile.Parameters.AddWithValue("enrollmentId", Convert.ToInt64(enrollmentId));
            await profile.ExecuteNonQueryAsync();
        }
        await transaction.CommitAsync();
        return (assignedUsers.Count, department);
    }

    public static async Task UnassignAsync(NpgsqlConnection connection, int sectionId, string studentId,
        string schoolYear, string semester)
    {
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand(@"
            UPDATE student_enrollments enrollment
            SET academic_section_id = NULL, section = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE enrollment.academic_section_id = @sectionId
              AND enrollment.school_year = @schoolYear AND enrollment.semester = @semester
              AND enrollment.status = 'ENROLLED' AND enrollment.enrollment_state = 'PLANNING'
              AND EXISTS (
                  SELECT 1 FROM studentprofiles profile
                  WHERE profile.user_id = enrollment.student_user_id
                    AND (LOWER(profile.student_no) = LOWER(@studentId)
                         OR profile.user_id::text = @studentId))
            RETURNING enrollment.student_user_id;", connection, transaction);
        command.Parameters.AddWithValue("sectionId", sectionId);
        command.Parameters.AddWithValue("schoolYear", schoolYear);
        command.Parameters.AddWithValue("semester", semester);
        command.Parameters.AddWithValue("studentId", studentId.Trim());
        var userId = await command.ExecuteScalarAsync();
        if (userId is null)
            throw new InvalidOperationException("The planning enrollment was not found in that section or is already finalized.");

        await using var profile = new NpgsqlCommand(@"
            UPDATE studentprofiles SET section = NULL, assignment_status = 'Unassigned'
            WHERE user_id = @userId AND NOT EXISTS (
                SELECT 1 FROM student_enrollments newer
                WHERE newer.student_user_id = @userId
                  AND (newer.school_year > @schoolYear OR
                       (newer.school_year = @schoolYear AND newer.semester <> @semester)));", connection, transaction);
        profile.Parameters.AddWithValue("userId", Convert.ToInt32(userId));
        profile.Parameters.AddWithValue("schoolYear", schoolYear);
        profile.Parameters.AddWithValue("semester", semester);
        await profile.ExecuteNonQueryAsync();
        await transaction.CommitAsync();
    }

    public static async Task<int> FinalizeAsync(NpgsqlConnection connection, int programId,
        string schoolYear, string semester, int actorId)
    {
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var incomplete = new NpgsqlCommand(@"
            SELECT COUNT(*) FROM student_enrollments
            WHERE program_id = @programId AND school_year = @schoolYear AND semester = @semester
              AND status = 'ENROLLED' AND enrollment_state = 'PLANNING'
              AND academic_section_id IS NULL;", connection, transaction))
        {
            incomplete.Parameters.AddWithValue("programId", programId);
            incomplete.Parameters.AddWithValue("schoolYear", schoolYear);
            incomplete.Parameters.AddWithValue("semester", semester);
            if (Convert.ToInt32(await incomplete.ExecuteScalarAsync()) > 0)
                throw new InvalidOperationException("Every planning enrollment must have a section before finalization.");
        }

        await using var command = new NpgsqlCommand(@"
            UPDATE student_enrollments
            SET enrollment_state = 'FINALIZED', finalized_at = CURRENT_TIMESTAMP,
                finalized_by = @actorId, updated_at = CURRENT_TIMESTAMP
            WHERE program_id = @programId AND school_year = @schoolYear AND semester = @semester
              AND status = 'ENROLLED' AND enrollment_state = 'PLANNING';", connection, transaction);
        command.Parameters.AddWithValue("programId", programId);
        command.Parameters.AddWithValue("schoolYear", schoolYear);
        command.Parameters.AddWithValue("semester", semester);
        command.Parameters.AddWithValue("actorId", actorId);
        var count = await command.ExecuteNonQueryAsync();
        await transaction.CommitAsync();
        return count;
    }
}
