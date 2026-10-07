using System.Text.RegularExpressions;
using Npgsql;

namespace Client_app.Services;

public static class FacultyCurriculumAuthorizationService
{
    public sealed record AcademicProgram(int Id, string Code, string Name);

    public static async Task<IReadOnlySet<int>> ResolveAuthorizedProgramIdsAsync(
        NpgsqlConnection connection,
        string facultyEmail,
        CancellationToken cancellationToken = default)
    {
        var programs = await LoadActiveProgramsAsync(connection, cancellationToken);
        var programsById = programs.ToDictionary(program => program.Id);
        var authorizedProgramIds = new HashSet<int>();

        await using var command = new NpgsqlCommand(@"
            SELECT fs.department, section.department, enrolled_program.program_id
            FROM users actor
            JOIN facultysections fs
              ON fs.user_id = actor.id
             AND fs.is_active = TRUE
            JOIN academicsections section
              ON section.id = fs.academic_section_id
             AND section.is_active = TRUE
            LEFT JOIN LATERAL (
                SELECT MIN(enrollment.program_id)::int AS program_id
                FROM student_enrollments enrollment
                JOIN academic_programs enrolled
                  ON enrolled.program_id = enrollment.program_id
                 AND enrolled.is_active = TRUE
                WHERE enrollment.academic_section_id = section.id
                  AND enrollment.school_year = fs.school_year
                  AND enrollment.semester = fs.semester
                  AND UPPER(BTRIM(enrollment.status)) = 'ENROLLED'
                HAVING COUNT(DISTINCT enrollment.program_id) = 1
            ) enrolled_program ON TRUE
            WHERE LOWER(actor.email) = LOWER(@actor)
              AND LOWER(actor.role) = 'faculty'
              AND LOWER(actor.status) = 'approved'
              AND actor.is_active = TRUE;", connection);
        command.Parameters.AddWithValue("actor", facultyEmail);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            if (!reader.IsDBNull(2))
            {
                var canonicalProgramId = reader.GetInt32(2);
                if (programsById.ContainsKey(canonicalProgramId))
                    authorizedProgramIds.Add(canonicalProgramId);
                continue;
            }

            var sectionProgramId = ResolveUniqueProgramId(reader.GetString(1), programs);
            var assignmentProgramId = ResolveUniqueProgramId(reader.GetString(0), programs);
            var resolvedIds = new[] { sectionProgramId, assignmentProgramId }
                .Where(id => id.HasValue)
                .Select(id => id!.Value)
                .Distinct()
                .ToArray();
            if (resolvedIds.Length == 1) authorizedProgramIds.Add(resolvedIds[0]);
        }

        return authorizedProgramIds;
    }

    public static int? ResolveUniqueProgramId(
        string? identifier,
        IReadOnlyCollection<AcademicProgram> programs)
    {
        var normalizedIdentifier = NormalizeAlias(identifier);
        if (normalizedIdentifier.Length == 0) return null;

        var matches = programs
            .Where(program => BuildAliases(program).Contains(normalizedIdentifier))
            .Select(program => program.Id)
            .Distinct()
            .Take(2)
            .ToArray();
        return matches.Length == 1 ? matches[0] : null;
    }

    private static async Task<IReadOnlyCollection<AcademicProgram>> LoadActiveProgramsAsync(
        NpgsqlConnection connection,
        CancellationToken cancellationToken)
    {
        var programs = new List<AcademicProgram>();
        await using var command = new NpgsqlCommand(@"
            SELECT program_id, program_code, program_name
            FROM academic_programs
            WHERE is_active = TRUE
            ORDER BY program_id;", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            programs.Add(new AcademicProgram(reader.GetInt32(0), reader.GetString(1), reader.GetString(2)));
        return programs;
    }

    private static HashSet<string> BuildAliases(AcademicProgram program)
    {
        var aliases = new HashSet<string>(StringComparer.Ordinal);
        AddAlias(aliases, program.Code);
        AddAlias(aliases, program.Name);

        var coreName = Regex.Replace(program.Name.Trim(),
            @"^Bachelor\s+of\s+(?:Science|Arts?)\s+in\s+|^Bachelor\s+of\s+",
            string.Empty, RegexOptions.IgnoreCase);
        AddAlias(aliases, coreName);

        var initials = string.Concat(Regex.Matches(coreName, @"[A-Za-z0-9]+")
            .Select(match => match.Value)
            .Where(word => word is not ("of" or "in" or "and" or "major") &&
                           word is not ("Of" or "In" or "And" or "Major"))
            .Select(word => char.ToUpperInvariant(word[0])));
        AddAlias(aliases, initials);
        return aliases;
    }

    private static void AddAlias(ISet<string> aliases, string? value)
    {
        var normalized = NormalizeAlias(value);
        if (normalized.Length > 0) aliases.Add(normalized);
    }

    private static string NormalizeAlias(string? value)
    {
        var withoutDescriptor = Regex.Replace((value ?? string.Empty).Trim(),
            @"\b(?:department|dept\.?|program|course)\b", string.Empty, RegexOptions.IgnoreCase);
        return Regex.Replace(withoutDescriptor.ToLowerInvariant(), @"[^a-z0-9]", string.Empty);
    }
}
