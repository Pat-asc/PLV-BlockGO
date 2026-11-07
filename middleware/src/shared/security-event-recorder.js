const { clientIp } = require('./client-ip');
const { sanitizeSecurityEvent } = require('./audit-value-sanitizer');

function createSecurityEventRecorder({ dbWrite, logger }) {
    return async function recordSecurityEvent(req, eventType, severity, attemptedIdentity, details) {
        const event = sanitizeSecurityEvent({
            eventType,
            severity,
            attemptedIdentity: attemptedIdentity || null,
            ipAddress: clientIp(req),
            requestPath: req.originalUrl || req.path,
            requestMethod: req.method,
            details
        });
        let client;
        let committed = false;
        try {
            client = await dbWrite.connect();
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(2026100702)');
            if (event.ipAddress) {
                await client.query(
                    `INSERT INTO ip_tracker_mappings (tracker_id, ip_address)
                     SELECT COALESCE(MAX(tracker_id), 0) + 1, $1::VARCHAR(100)
                       FROM ip_tracker_mappings
                     HAVING NOT EXISTS (
                         SELECT 1 FROM ip_tracker_mappings WHERE ip_address = $1::VARCHAR(100)
                     )`,
                    [event.ipAddress]
                );
            }
            await client.query(
                `WITH inserted AS (
                 INSERT INTO security_events
                    (event_type, severity, attempted_identity, ip_address, request_path, request_method, details)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING security_event_id, event_type, severity, attempted_identity, created_at
                 )
                 SELECT pg_notify('blockgo_security_event', json_build_object(
                    'eventId', security_event_id,
                    'eventType', event_type,
                    'severity', severity,
                    'attemptedIdentity', attempted_identity,
                    'createdAt', created_at
                 )::text) FROM inserted`,
                [event.eventType, event.severity, event.attemptedIdentity, event.ipAddress,
                    event.requestPath, event.requestMethod, event.details]
            );
            await client.query('COMMIT');
            committed = true;
        } catch (error) {
            if (client && !committed) await client.query('ROLLBACK').catch(() => {});
            logger.warn({ err: error, eventType: event.eventType }, 'Security event could not be persisted');
        } finally {
            client?.release();
        }
    };
}

module.exports = { createSecurityEventRecorder };
