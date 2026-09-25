using System.Data;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.SignalR;
using Client_app.Controllers;
using Npgsql;

namespace Client_app.Services
{
    public sealed class AuditLogService : IAuditLogService
    {
        private readonly string _connectionString;
        private readonly IHubContext<ChatHub> _chatHubContext;
        private readonly ILogger<AuditLogService> _logger;

        public AuditLogService(IConfiguration configuration, IHubContext<ChatHub> chatHubContext, ILogger<AuditLogService> logger)
        {
            _connectionString = configuration.GetConnectionString("MasterConnection")
                ?? configuration.GetConnectionString("PostgresConnection")
                ?? throw new InvalidOperationException("A PostgreSQL write connection is required.");
            _chatHubContext = chatHubContext;
            _logger = logger;
        }

        public async Task LogAsync(
            string actorEmail,
            string actorRole,
            string action,
            string entityType,
            string entityId,
            object? oldValues = null,
            object? newValues = null,
            string? description = null,
            string? ipAddress = null,
            NpgsqlConnection? connection = null,
            NpgsqlTransaction? transaction = null,
            CancellationToken cancellationToken = default)
        {
            var ownsConnection = connection is null;
            connection ??= new NpgsqlConnection(_connectionString);
            if (connection.State != ConnectionState.Open)
            {
                await connection.OpenAsync(cancellationToken);
            }

            try
            {
                await using var command = new NpgsqlCommand(@"
                    INSERT INTO audit_logs
                        (user_id, actor_role, action, entity_type, entity_id, old_values, new_values, description, ip_address, timestamp)
                    VALUES
                        ((SELECT id FROM users WHERE LOWER(email) = LOWER(@actorEmail) LIMIT 1),
                         @actorRole, @action, @entityType, @entityId, @oldValues, @newValues,
                         @description, @ipAddress, CURRENT_TIMESTAMP)
                    RETURNING audit_id, timestamp;", connection, transaction);
                command.Parameters.AddWithValue("actorEmail", actorEmail);
                command.Parameters.AddWithValue("actorRole", actorRole);
                command.Parameters.AddWithValue("action", action);
                command.Parameters.AddWithValue("entityType", entityType);
                command.Parameters.AddWithValue("entityId", entityId);
                command.Parameters.AddWithValue("oldValues", oldValues is null ? DBNull.Value : JsonSerializer.Serialize(oldValues));
                command.Parameters.AddWithValue("newValues", newValues is null ? DBNull.Value : JsonSerializer.Serialize(newValues));
                command.Parameters.AddWithValue("description", (object?)description ?? DBNull.Value);
                command.Parameters.AddWithValue("ipAddress", (object?)ipAddress ?? DBNull.Value);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                await reader.ReadAsync(cancellationToken);
                var auditId = reader.GetInt64(0);
                var occurredAt = reader.GetDateTime(1);
                await reader.DisposeAsync();

                try
                {
                    await _chatHubContext.Clients.Group("role_system_admin").SendAsync("TransactionRecorded", new
                    {
                        auditId,
                        action,
                        entityType,
                        entityId,
                        actorRole,
                        actor = actorEmail,
                        description,
                        occurredAt
                    }, cancellationToken);
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception, "Audit transaction {AuditId} was stored but its live update could not be broadcast.", auditId);
                }
            }
            finally
            {
                if (ownsConnection)
                {
                    await connection.DisposeAsync();
                }
            }
        }
    }
}
