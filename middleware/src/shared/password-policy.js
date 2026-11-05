const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 128;
const PASSWORD_POLICY_MESSAGE = 'Password must be 8-128 characters and include an uppercase letter, lowercase letter, number, and special character.';

function passwordRequirements(password) {
    const value = String(password || '');
    return {
        length: value.length >= MINIMUM_PASSWORD_LENGTH && value.length <= MAXIMUM_PASSWORD_LENGTH,
        uppercase: /[A-Z]/.test(value),
        lowercase: /[a-z]/.test(value),
        number: /\d/.test(value),
        special: /[^A-Za-z0-9\s]/.test(value),
        notObvious: !/^(?:password|password123|admin|admin123|qwerty|letmein|changeme)[!@#$%^&*]?$/i.test(value)
    };
}

function validatePassword(password) {
    const requirements = passwordRequirements(password);
    return Object.values(requirements).every(Boolean) ? null : PASSWORD_POLICY_MESSAGE;
}

module.exports = {
    MAXIMUM_PASSWORD_LENGTH,
    MINIMUM_PASSWORD_LENGTH,
    PASSWORD_POLICY_MESSAGE,
    passwordRequirements,
    validatePassword
};
