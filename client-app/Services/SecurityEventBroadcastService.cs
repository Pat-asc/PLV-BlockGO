using System.Threading.Channels;
using Client_app.Controllers;
using Microsoft.AspNetCore.SignalR;
using Npgsql;

namespace Client_app.Services;

public sealed class SecurityEventBroadcastService : BackgroundService
{
    private readonly string _connectionString;
    private readonly IHubContext<ChatHub> _hub;
    private readonly ILogger<SecurityEventBroadcastService> _logger;

    public SecurityEventBroadcastService(IConfiguration configuration, IHubContext<ChatHub> hub,
        ILogger<SecurityEventBroadcastService> logger)
    {
        _connectionString = configuration.GetConnectionString("MasterConnection")
            ?? configuration.GetConnectionString("PostgresConnection")
            ?? throw new InvalidOperationException("A PostgreSQL connection is required for security alerts.");
        _hub = hub;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ListenAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Security-event live listener disconnected; retrying.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        var events = Channel.CreateUnbounded<string>();
        await using var connection = new NpgsqlConnection(_connectionString);
        connection.Notification += (_, notification) => events.Writer.TryWrite(notification.Payload);
        await connection.OpenAsync(cancellationToken);
        await using (var command = new NpgsqlCommand("LISTEN blockgo_security_event;", connection))
            await command.ExecuteNonQueryAsync(cancellationToken);

        while (!cancellationToken.IsCancellationRequested)
        {
            await connection.WaitAsync(cancellationToken);
            while (events.Reader.TryRead(out var payload))
                await _hub.Clients.Group("role_system_admin").SendAsync("SecurityAlert", payload, cancellationToken);
        }
    }
}
