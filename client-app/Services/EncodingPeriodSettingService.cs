using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace Client_app.Services;

public static class EncodingPeriodSettingService
{
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
}
