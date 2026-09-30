using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace Client_app.Services;

public static class EncodingPeriodSettingService
{
    public sealed record AcademicPeriodContext(
        long AcademicPeriodId,
        string SchoolYear,
        string Semester,
        string Term,
        DateOnly? StartDate,
        DateOnly? EndDate);

    public sealed record EncodingSeasonResetResult(
        AcademicPeriodContext AcademicContext,
        int DeactivatedAssignmentCount,
        string EncodingPeriod);

    public sealed class NoActiveAcademicPeriodException : Exception
    {
        public NoActiveAcademicPeriodException()
            : base("No active academic period exists. Use Reset Encoding Season to open an academic period before saving the schedule.") { }
    }

    public static async Task<string> SaveAsync(
        NpgsqlConnection connection, string value, CancellationToken cancellationToken = default)
    {
        JsonObject setting;
        try
        {
            setting = JsonNode.Parse(value) as JsonObject
                ?? throw new ArgumentException("Encoding period setting must be a valid JSON object.");
        }
        catch (JsonException)
        {
            throw new ArgumentException("Encoding period setting contains invalid JSON.");
        }

        var term = ReadString(setting, "term", "Encoding term").ToLowerInvariant();
        if (term is not ("midterm" or "finals"))
            throw new ArgumentException("Encoding term must be either midterm or finals.");

        var startDate = NormalizeDate(setting, "startDate", "Start date");
        var endDate = NormalizeDate(setting, "endDate", "End date");
        if (startDate.HasValue && endDate.HasValue && endDate < startDate)
            throw new ArgumentException("End date cannot be before start date.");

        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        string? schoolYear = null;
        string? semester = null;
        await using (var authority = new NpgsqlCommand(@"
            SELECT school_year, semester
            FROM academic_periods
            WHERE UPPER(status) = 'ACTIVE'
            ORDER BY opened_at DESC
            LIMIT 1
            FOR SHARE;", connection, transaction))
        await using (var reader = await authority.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                schoolYear = reader.GetString(0).Trim();
                semester = reader.GetString(1).Trim().ToUpperInvariant();
            }
        }

        if (schoolYear is null || semester is null)
            throw new NoActiveAcademicPeriodException();

        setting["schoolYear"] = schoolYear;
        setting["semester"] = semester switch
        {
            "FIRST" => "1st Semester",
            "SECOND" => "2nd Semester",
            "MIDYEAR" => "Summer",
            _ => throw new InvalidOperationException("The active academic period has an unsupported semester.")
        };
        setting["term"] = term;
        setting["startDate"] = startDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty;
        setting["endDate"] = endDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty;
        var normalizedValue = setting.ToJsonString();

        await using (var save = new NpgsqlCommand(@"
            INSERT INTO SystemSettings (key, value) VALUES ('encoding_period', @value)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;", connection, transaction))
        {
            save.Parameters.AddWithValue("value", normalizedValue);
            await save.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return normalizedValue;
    }

    private static string ReadString(JsonObject setting, string propertyName, string displayName)
    {
        if (!setting.TryGetPropertyValue(propertyName, out var node) ||
            node is not JsonValue value ||
            !value.TryGetValue<string>(out var text))
            throw new ArgumentException($"{displayName} is required.");

        return text.Trim();
    }

    private static DateOnly? NormalizeDate(JsonObject setting, string propertyName, string displayName)
    {
        if (!setting.TryGetPropertyValue(propertyName, out var node) || node is null)
            return null;
        if (node is not JsonValue value || !value.TryGetValue<string>(out var rawValue))
            throw new ArgumentException($"{displayName} is invalid.");
        rawValue = rawValue.Trim();
        if (rawValue.Length == 0) return null;
        if (!DateOnly.TryParseExact(rawValue, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var parsed))
            throw new ArgumentException($"{displayName} is invalid.");
        return parsed;
    }

    public static async Task<EncodingSeasonResetResult> ResetAsync(
        NpgsqlConnection connection,
        string schoolYear,
        string semester,
        string term,
        DateOnly? startDate,
        DateOnly? endDate,
        string actor,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            // Serialize reset operations, including the no-active-row case, so the
            // partial unique index cannot be raced by two concurrent resets.
            await using (var lockPeriods = new NpgsqlCommand(
                "LOCK TABLE academic_periods IN SHARE ROW EXCLUSIVE MODE;", connection, transaction))
                await lockPeriods.ExecuteNonQueryAsync(cancellationToken);

            await using (var activePeriod = new NpgsqlCommand(@"
                SELECT academic_period_id
                FROM academic_periods
                WHERE status = 'ACTIVE'
                ORDER BY opened_at DESC
                LIMIT 1
                FOR UPDATE;", connection, transaction))
                await activePeriod.ExecuteScalarAsync(cancellationToken);

            long? targetAcademicPeriodId = null;
            string? targetStatus = null;
            await using (var targetPeriod = new NpgsqlCommand(@"
                SELECT academic_period_id, status
                FROM academic_periods
                WHERE school_year = @schoolYear
                  AND semester = @semester
                  AND term = @term
                FOR UPDATE;", connection, transaction))
            {
                targetPeriod.Parameters.AddWithValue("schoolYear", schoolYear);
                targetPeriod.Parameters.AddWithValue("semester", semester);
                targetPeriod.Parameters.AddWithValue("term", term);
                await using var reader = await targetPeriod.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    targetAcademicPeriodId = reader.GetInt64(0);
                    targetStatus = reader.GetString(1);
                }
            }

            AcademicPeriodContext academicContext;
            if (!targetAcademicPeriodId.HasValue)
            {
                await CloseOtherActivePeriodsAsync(connection, transaction, null, cancellationToken);
                await using var insertTarget = new NpgsqlCommand(@"
                    INSERT INTO academic_periods
                        (school_year, semester, term, start_date, end_date, status,
                         opened_by, opened_at, closed_at)
                    VALUES
                        (@schoolYear, @semester, @term, @startDate, @endDate, 'ACTIVE',
                         (SELECT id FROM users WHERE LOWER(email) = LOWER(@actor) LIMIT 1),
                         CURRENT_TIMESTAMP, NULL)
                    RETURNING academic_period_id, school_year, semester, term, start_date, end_date;",
                    connection, transaction);
                AddPeriodParameters(insertTarget, schoolYear, semester, term, startDate, endDate, actor);
                academicContext = await ReadAcademicContextAsync(insertTarget, cancellationToken);
            }
            else
            {
                await CloseOtherActivePeriodsAsync(
                    connection, transaction, targetAcademicPeriodId, cancellationToken);

                var reopeningClosedPeriod = !string.Equals(targetStatus, "ACTIVE", StringComparison.OrdinalIgnoreCase);
                await using var updateTarget = new NpgsqlCommand($@"
                    UPDATE academic_periods
                    SET start_date = @startDate,
                        end_date = @endDate,
                        status = 'ACTIVE',
                        closed_at = NULL
                        {(reopeningClosedPeriod ? ", opened_at = CURRENT_TIMESTAMP, opened_by = (SELECT id FROM users WHERE LOWER(email) = LOWER(@actor) LIMIT 1)" : string.Empty)}
                    WHERE academic_period_id = @academicPeriodId
                    RETURNING academic_period_id, school_year, semester, term, start_date, end_date;",
                    connection, transaction);
                updateTarget.Parameters.AddWithValue("academicPeriodId", targetAcademicPeriodId.Value);
                updateTarget.Parameters.AddWithValue("startDate", (object?)startDate ?? DBNull.Value);
                updateTarget.Parameters.AddWithValue("endDate", (object?)endDate ?? DBNull.Value);
                if (reopeningClosedPeriod)
                    updateTarget.Parameters.AddWithValue("actor", actor);
                academicContext = await ReadAcademicContextAsync(updateTarget, cancellationToken);
            }

            await using var deactivateAssignments = new NpgsqlCommand(@"
                UPDATE FacultySections
                SET is_active = FALSE,
                    deactivated_at = CURRENT_TIMESTAMP,
                    deactivated_by = @actor
                WHERE is_active = TRUE;", connection, transaction);
            deactivateAssignments.Parameters.AddWithValue("actor", actor);
            var deactivatedAssignmentCount = await deactivateAssignments.ExecuteNonQueryAsync(cancellationToken);

            var displaySemester = academicContext.Semester switch
            {
                "FIRST" => "1st Semester",
                "SECOND" => "2nd Semester",
                "MIDYEAR" => "Summer",
                _ => throw new InvalidOperationException("The active academic period has an unsupported semester.")
            };
            var encodingPeriod = JsonSerializer.Serialize(new
            {
                schoolYear = academicContext.SchoolYear,
                semester = displaySemester,
                startDate = academicContext.StartDate?.ToString("yyyy-MM-dd") ?? "",
                endDate = academicContext.EndDate?.ToString("yyyy-MM-dd") ?? "",
                term = academicContext.Term
            });

            await using (var saveSetting = new NpgsqlCommand(@"
                INSERT INTO SystemSettings (key, value) VALUES ('encoding_period', @value)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;", connection, transaction))
            {
                saveSetting.Parameters.AddWithValue("value", encodingPeriod);
                await saveSetting.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return new EncodingSeasonResetResult(
                academicContext, deactivatedAssignmentCount, encodingPeriod);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task CloseOtherActivePeriodsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        long? targetAcademicPeriodId,
        CancellationToken cancellationToken)
    {
        var sql = targetAcademicPeriodId.HasValue
            ? @"UPDATE academic_periods
                SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP
                WHERE status = 'ACTIVE' AND academic_period_id <> @targetAcademicPeriodId;"
            : @"UPDATE academic_periods
                SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP
                WHERE status = 'ACTIVE';";
        await using var closePeriods = new NpgsqlCommand(sql, connection, transaction);
        if (targetAcademicPeriodId.HasValue)
            closePeriods.Parameters.AddWithValue("targetAcademicPeriodId", targetAcademicPeriodId.Value);
        await closePeriods.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddPeriodParameters(
        NpgsqlCommand command,
        string schoolYear,
        string semester,
        string term,
        DateOnly? startDate,
        DateOnly? endDate,
        string actor)
    {
        command.Parameters.AddWithValue("schoolYear", schoolYear);
        command.Parameters.AddWithValue("semester", semester);
        command.Parameters.AddWithValue("term", term);
        command.Parameters.AddWithValue("startDate", (object?)startDate ?? DBNull.Value);
        command.Parameters.AddWithValue("endDate", (object?)endDate ?? DBNull.Value);
        command.Parameters.AddWithValue("actor", actor);
    }

    private static async Task<AcademicPeriodContext> ReadAcademicContextAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            throw new InvalidOperationException("The requested academic period could not be activated.");

        return new AcademicPeriodContext(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
            reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5));
    }
}
