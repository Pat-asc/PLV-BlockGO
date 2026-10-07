import {
  broadcastAuthInvalidation,
  clearAuthSession,
  decodeAuthToken,
  getAuthToken,
  migrateLegacyAuthSession,
  normalizeSessionRole,
  roleForRoute,
  routeForRole,
  setAuthSession,
  subscribeToAuthSessionEvents,
} from './authSession';

const tokenFor = (role, username = `${role}@plv.edu.ph`) => {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ dbRole: role, username })}.signature`;
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

test.each([
  ['registrar', '/registrar'],
  ['department_admin', '/department-admin'],
  ['faculty', '/faculty'],
  ['student', '/student'],
  ['system_admin', '/system-admin'],
])('maps %s sessions to %s', (role, route) => {
  expect(routeForRole(role)).toBe(route);
  expect(roleForRoute(route)).toBe(role);
});

test('normalizes department role aliases', () => {
  expect(normalizeSessionRole('Dept Admin')).toBe('department_admin');
  expect(roleForRoute('/dept-admin')).toBe('department_admin');
});

test('stores authentication only in this tab session', () => {
  const token = tokenFor('faculty');
  setAuthSession(token, 'faculty');
  expect(getAuthToken()).toBe(token);
  expect(localStorage.getItem('token')).toBeNull();
  clearAuthSession();
  expect(getAuthToken()).toBeNull();
});

test('migrates and removes a legacy shared token', () => {
  const token = tokenFor('registrar');
  localStorage.setItem('token', token);
  expect(migrateLegacyAuthSession()).toBe(token);
  expect(getAuthToken()).toBe(token);
  expect(localStorage.getItem('token')).toBeNull();
  expect(decodeAuthToken(token).dbRole).toBe('registrar');
});

test('manual logout notifies this tab and clears the session without an event loop', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeToAuthSessionEvents(listener);
  setAuthSession(tokenFor('student'), 'student');
  clearAuthSession({ broadcast: true, reason: 'manual_logout' });
  expect(getAuthToken()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0][0].reason).toBe('manual_logout');
  unsubscribe();
});

test('ignores a logout event for a different signed-in account', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeToAuthSessionEvents(listener);
  setAuthSession(tokenFor('faculty', 'faculty-a@plv.edu.ph'), 'faculty');
  window.dispatchEvent(new CustomEvent('blockgo.auth.event', {
    detail: { type: 'logout', account: 'faculty-b@plv.edu.ph', reason: 'manual_logout' },
  }));
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test('a matching cross-tab storage logout clears this tab session', () => {
  const token = tokenFor('faculty', 'faculty-a@plv.edu.ph');
  setAuthSession(token, 'faculty');
  const unsubscribe = subscribeToAuthSessionEvents(() => clearAuthSession());

  window.dispatchEvent(new StorageEvent('storage', {
    key: 'blockgo.auth.event',
    newValue: JSON.stringify({
      type: 'logout', account: 'faculty-a@plv.edu.ph', reason: 'password_changed', nonce: 'test',
    }),
  }));

  expect(getAuthToken()).toBeNull();
  unsubscribe();
});

test('password invalidation broadcasts only to tabs using the affected account', () => {
  const listener = jest.fn(() => clearAuthSession());
  setAuthSession(tokenFor('student', 'student@plv.edu.ph'), 'student');
  const unsubscribe = subscribeToAuthSessionEvents(listener);

  broadcastAuthInvalidation('student@plv.edu.ph', 'password_reset');

  expect(listener).toHaveBeenCalledWith(expect.objectContaining({
    account: 'student@plv.edu.ph', reason: 'password_reset',
  }));
  expect(getAuthToken()).toBeNull();
  unsubscribe();
});
