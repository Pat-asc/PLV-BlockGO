namespace Client_app.Services;

public sealed record CouchDbApplicationDatabase(string Name, string Label);

public static class CouchDbBrowserPolicy
{
    private const string ApplicationWorldStateDatabase = "registrar-channel_registrar";

    private static readonly IReadOnlyDictionary<string, string> TargetLabels =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["registrar"] = "Student Grade Records (Registrar Peer)",
            ["faculty"] = "Student Grade Records (Faculty Peer)",
            ["department"] = "Student Grade Records (Department Peer)"
        };

    public static IReadOnlyList<CouchDbApplicationDatabase> FilterApplicationDatabases(
        string? target,
        IEnumerable<string> databaseNames)
    {
        if (!TargetLabels.TryGetValue(target ?? string.Empty, out var label))
            return Array.Empty<CouchDbApplicationDatabase>();

        return databaseNames
            .Where(name => IsBrowsableDatabase(target, name))
            .Distinct(StringComparer.Ordinal)
            .Select(name => new CouchDbApplicationDatabase(name, label))
            .ToArray();
    }

    public static bool IsBrowsableDatabase(string? target, string? database) =>
        TargetLabels.ContainsKey(target ?? string.Empty)
        && string.Equals(database, ApplicationWorldStateDatabase, StringComparison.Ordinal);
}
