export const PASSWORD_POLICY_MESSAGE = 'Password must be 8-128 characters and include an uppercase letter, lowercase letter, number, and special character.';

export const passwordRequirements = (password = '') => ({
  length: password.length >= 8 && password.length <= 128,
  uppercase: /[A-Z]/.test(password),
  lowercase: /[a-z]/.test(password),
  number: /[0-9]/.test(password),
  special: /[^A-Za-z0-9\s]/.test(password),
  notObvious: !/^(?:password|password123|admin|admin123|qwerty|letmein|changeme)[!@#$%^&*]?$/i.test(password),
});

export const isPasswordValid = (password) => Object.values(passwordRequirements(password)).every(Boolean);

export const passwordStrength = (password = '') => {
  if (!password) return { label: 'Weak', score: 0, color: 'bg-red-500' };
  const requirements = passwordRequirements(password);
  const score = Object.values(requirements).filter(Boolean).length;
  if (score <= 2) return { label: 'Weak', score: 1, color: 'bg-red-500' };
  if (score <= 4) return { label: 'Fair', score: 2, color: 'bg-amber-500' };
  if (score === 5) return { label: 'Good', score: 3, color: 'bg-blue-500' };
  return { label: 'Strong', score: 4, color: 'bg-emerald-600' };
};
