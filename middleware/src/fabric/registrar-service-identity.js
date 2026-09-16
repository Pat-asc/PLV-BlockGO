const { adminUser, enrollIdentity, ensureAdminEnrolled, registrationPayload } = require('./ca-manager');
const { getWallet } = require('./wallet-manager');

const REGISTRAR_SERVICE_LABEL = 'system-admin-registrar';
const REGISTRAR_MSP_ID = 'RegistrarMSP';

function createRegistrarServiceBootstrap(dependencies = {}) {
    const operations = { adminUser, enrollIdentity, ensureAdminEnrolled, getWallet, registrationPayload, ...dependencies };
    return async function ensureRegistrarServiceIdentity(secret) {
        const wallet = await operations.getWallet('registrar');
        const existing = await wallet.get(REGISTRAR_SERVICE_LABEL);
        if (existing) {
            if (existing.mspId !== REGISTRAR_MSP_ID || existing.type !== 'X.509') {
                throw new Error(`Registrar Fabric service identity '${REGISTRAR_SERVICE_LABEL}' has an unexpected MSP or identity type; do not overwrite it.`);
            }
            return { created: false, mspId: existing.mspId };
        }
        if (!secret) {
            throw new Error(`Registrar Fabric service identity '${REGISTRAR_SERVICE_LABEL}' is missing and BOOTSTRAP_REGISTRAR_PASS is unavailable.`);
        }

        // A CA registration may already exist even when this wallet copy is missing.
        // First try the known enrollment secret; never reset an existing CA secret.
        try {
            const enrolled = await operations.enrollIdentity(REGISTRAR_SERVICE_LABEL, secret, 'registrar');
            return { created: true, mspId: enrolled.identity.mspId };
        } catch {
            let alreadyRegistered = false;
            try {
                const config = await operations.ensureAdminEnrolled('registrar');
                const admin = await operations.adminUser(config, wallet);
                await config.client.register(
                    operations.registrationPayload(REGISTRAR_SERVICE_LABEL, secret, 'registrar'), admin);
            } catch (registrationError) {
                if (/already registered/i.test(String(registrationError?.message || registrationError)))
                    alreadyRegistered = true;
                else {
                    throw new Error(`Registrar Fabric service identity '${REGISTRAR_SERVICE_LABEL}' could not be registered or restored; verify Registrar CA and wallet availability.`, { cause: registrationError });
                }
            }
            const restoredByPeer = await wallet.get(REGISTRAR_SERVICE_LABEL);
            if (restoredByPeer) {
                if (restoredByPeer.mspId !== REGISTRAR_MSP_ID || restoredByPeer.type !== 'X.509')
                    throw new Error(`Registrar Fabric service identity '${REGISTRAR_SERVICE_LABEL}' has an unexpected MSP or identity type; do not overwrite it.`);
                return { created: false, mspId: restoredByPeer.mspId, restored: true };
            }
            try {
                const enrolled = await operations.enrollIdentity(REGISTRAR_SERVICE_LABEL, secret, 'registrar');
                return { created: true, mspId: enrolled.identity.mspId, restored: alreadyRegistered };
            } catch (enrollmentError) {
                throw new Error(`Registrar Fabric service identity '${REGISTRAR_SERVICE_LABEL}' cannot be enrolled with the configured secret; verify its CA registration without resetting it.`, { cause: enrollmentError });
            }
        }
    };
}

module.exports = {
    REGISTRAR_MSP_ID, REGISTRAR_SERVICE_LABEL,
    createRegistrarServiceBootstrap,
    ensureRegistrarServiceIdentity: createRegistrarServiceBootstrap()
};
