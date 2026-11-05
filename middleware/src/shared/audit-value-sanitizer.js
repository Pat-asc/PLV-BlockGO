const SECURITY_EVENT_LIMITS = Object.freeze({
    eventType: 80,
    severity: 20,
    attemptedIdentity: 255,
    ipAddress: 100,
    requestPath: 500,
    requestMethod: 20,
    // `details` is TEXT, but cap hostile fuzz payloads to prevent audit/log amplification.
    details: 8192
});

const SINGLE_LINE_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const REPLACEMENT_CHARACTER = '\uFFFD';

function printableString(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    try {
        if (typeof value === 'object') {
            const serialized = JSON.stringify(value);
            if (serialized !== undefined) return serialized;
        }
        return String(value);
    } catch {
        return '[unprintable value]';
    }
}

function truncateCodePoints(value, maxLength) {
    if (value.length <= maxLength) return value;
    // PostgreSQL VARCHAR limits count characters. Limit the UTF-16 prefix first so
    // hostile multi-megabyte values cannot amplify memory use during normalization.
    return Array.from(value.slice(0, maxLength * 2)).slice(0, maxLength).join('');
}

function sanitizeAuditValue(value, maxLength, { multiline = false } = {}) {
    const printable = printableString(value);
    if (printable === null) return null;
    const controlPattern = multiline ? MULTILINE_CONTROL_CHARACTERS : SINGLE_LINE_CONTROL_CHARACTERS;
    return truncateCodePoints(printable.replace(controlPattern, REPLACEMENT_CHARACTER), maxLength);
}

function sanitizeSecurityEvent({
    eventType,
    severity,
    attemptedIdentity,
    ipAddress,
    requestPath,
    requestMethod,
    details
}) {
    return {
        eventType: sanitizeAuditValue(eventType, SECURITY_EVENT_LIMITS.eventType),
        severity: sanitizeAuditValue(severity, SECURITY_EVENT_LIMITS.severity),
        attemptedIdentity: sanitizeAuditValue(attemptedIdentity, SECURITY_EVENT_LIMITS.attemptedIdentity),
        ipAddress: sanitizeAuditValue(ipAddress, SECURITY_EVENT_LIMITS.ipAddress),
        requestPath: sanitizeAuditValue(requestPath, SECURITY_EVENT_LIMITS.requestPath),
        requestMethod: sanitizeAuditValue(requestMethod, SECURITY_EVENT_LIMITS.requestMethod),
        details: sanitizeAuditValue(details, SECURITY_EVENT_LIMITS.details, { multiline: true })
    };
}

module.exports = { SECURITY_EVENT_LIMITS, sanitizeAuditValue, sanitizeSecurityEvent };
