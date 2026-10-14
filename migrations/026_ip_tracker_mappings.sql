-- Stable UI-safe identifiers for verified client IP addresses. The raw address
-- remains in security_events for authorized audit/security use and is never
-- returned as the System Monitoring tracker value.
CREATE TABLE IF NOT EXISTS ip_tracker_mappings (
    tracker_id BIGINT PRIMARY KEY,
    ip_address VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Preserve deterministic first-seen numbering for security events that existed
-- before this mapping table was introduced.
INSERT INTO ip_tracker_mappings (tracker_id, ip_address)
SELECT (SELECT COALESCE(MAX(tracker_id), 0) FROM ip_tracker_mappings)
       + ROW_NUMBER() OVER (ORDER BY MIN(security_event_id), ip_address),
       ip_address
  FROM security_events
 WHERE ip_address IS NOT NULL
   AND BTRIM(ip_address) <> ''
   AND NOT EXISTS (
       SELECT 1
         FROM ip_tracker_mappings existing
        WHERE existing.ip_address = security_events.ip_address
   )
 GROUP BY ip_address
 ORDER BY MIN(security_event_id), ip_address
ON CONFLICT (ip_address) DO NOTHING;
