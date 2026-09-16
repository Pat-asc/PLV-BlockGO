function safeFabricReason(error) {
    return String(error?.message || error || 'Unknown Fabric error')
        .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[redacted PEM]')
        .replace(/ENC:[0-9a-f:]+/gi, '[redacted encrypted value]')
        .replace(/(https?:\/\/)[^@\s/]+@/gi, '$1[redacted]@')
        .replace(/((?:password|secret|token|authorization|privatekey|enrollmentSecret)\s*[:=]\s*)[^,\s}]+/gi, '$1[redacted]')
        .slice(0, 500);
}

function classifyLedgerError(error, functionName = '') {
    const reason = safeFabricReason(error);
    const lower = reason.toLowerCase();
    if (/wallet identity .* not found/i.test(reason))
        return { code: 'WALLET_IDENTITY_MISSING', status: 503, reason: reason.replace('Access Denied: ', '') };
    if (/wallet identity .* exists but could not be read/i.test(reason))
        return { code: 'WALLET_UNREADABLE', status: 503, reason: 'A Fabric wallet identity exists but could not be read; preserve the wallet and inspect CouchDB access.' };
    if (/couchdb|wallet.*(?:unavailable|timed out|connection|refused)/i.test(reason))
        return { code: 'WALLET_UNAVAILABLE', status: 503, reason: 'Fabric wallet storage is unavailable.' };
    if (/(?:discoveryservice|channel).*access denied|access denied.*(?:discoveryservice|channel)/i.test(reason))
        return { code: 'CHANNEL_ACCESS_DENIED', status: 503, reason: 'Fabric channel discovery or access was denied.' };
    if (functionName === 'ReadGrade' && /\brecord (?:not found|does not exist)\b/i.test(reason))
        return { code: 'GRADE_NOT_FOUND', status: 404, reason: 'Record not found on the Fabric ledger.' };
    if (functionName === 'IssueGrade' && /\brecord already exists\b/i.test(reason))
        return { code: 'LEDGER_RECORD_EXISTS', status: 409, reason: 'Grade UUID already exists on the Fabric ledger.' };
    if (/endorse|commit|validation|mvcc/i.test(reason))
        return { code: 'FABRIC_COMMIT_FAILED', status: 503, reason: 'Fabric endorsement or commit did not succeed.' };
    if (/abac denied|obac\/abac denied|invalid grade transition/i.test(reason))
        return { code: 'CHAINCODE_DENIED', status: 403, reason: 'Fabric chaincode rejected the role or grade transition.' };
    return { code: 'FABRIC_OPERATION_FAILED', status: 503, reason: 'Fabric operation failed; inspect the ledger-service log for the safe underlying reason.' };
}

module.exports = { classifyLedgerError, safeFabricReason };
