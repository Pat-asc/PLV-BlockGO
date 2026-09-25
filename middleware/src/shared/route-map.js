const { serviceUrl } = require('./config');

const routeDefinitions = [
    { service: 'auth', paths: [/^\/api\/login$/, /^\/api\/crypto\/hash-password$/, /^\/api\/forgot-password$/, /^\/api\/reset-password$/, /^\/api\/password-reset-assistance$/, /^\/api\/bootstrap$/] },
    { service: 'identity', paths: [/^\/api\/fabric\/register-user$/, /^\/api\/(enroll|register|revoke)$/, /^\/api\/wallet\/[^/]+$/] },
    { service: 'ledger', paths: [/^\/api\/all-grades$/, /^\/api\/student-transactions$/, /^\/api\/admin\/ledger-transactions$/, /^\/api\/grade-history\/[^/]+$/, /^\/api\/fabric\/audit-event$/, /^\/api\/issue-grade$/, /^\/api\/get-grade\/[^/]+$/, /^\/api\/update-grade$/, /^\/api\/(approve-grade|finalize-grade|return-grade)\/[^/]+$/, /^\/api\/batch-issue-grade$/] },
    { service: 'upload', paths: [/^\/api\/(batch-upload|upload-grades)$/] },
    { service: 'settings', paths: [/^\/api\/SystemSettings(?:\/.*)?$/] }
];

const methodDefinitions = [
    { methods: ['GET'], paths: [/^\/api\/(health|ready|bootstrap)$/, /^\/metrics$/, /^\/api\/(all-grades|student-transactions|admin\/ledger-transactions)$/, /^\/api\/(grade-history|get-grade)\/[^/]+$/, /^\/api\/SystemSettings\/(?!reset-season$)[^/]+$/] },
    { methods: ['DELETE'], paths: [/^\/api\/wallet\/[^/]+$/] },
    { methods: ['POST'], paths: [/^\/api\/(login|forgot-password|reset-password|password-reset-assistance)$/, /^\/api\/crypto\/hash-password$/, /^\/api\/fabric\/(register-user|audit-event)$/, /^\/api\/(enroll|register|revoke)$/, /^\/api\/(issue-grade|update-grade|batch-issue-grade|batch-upload|upload-grades)$/, /^\/api\/(approve-grade|finalize-grade|return-grade)\/[^/]+$/, /^\/api\/SystemSettings(?:\/reset-season)?$/] }
];

function resolveRoute(pathname) {
    return routeDefinitions.find((definition) => definition.paths.some((pattern) => pattern.test(pathname)))?.service || null;
}

function allowedMethods(pathname) {
    return methodDefinitions.find((definition) => definition.paths.some((pattern) => pattern.test(pathname)))?.methods || [];
}

function serviceTargets() {
    return {
        auth: serviceUrl('AUTH_SERVICE_URL', 'auth-service', 4001),
        identity: serviceUrl('IDENTITY_SERVICE_URL', 'fabric-identity-service', 4002),
        ledger: serviceUrl('LEDGER_SERVICE_URL', 'ledger-service', 4003),
        upload: serviceUrl('UPLOAD_SERVICE_URL', 'grade-upload-service', 4004),
        settings: serviceUrl('SETTINGS_SERVICE_URL', 'settings-service', 4005)
    };
}

module.exports = { allowedMethods, resolveRoute, routeDefinitions, serviceTargets };
