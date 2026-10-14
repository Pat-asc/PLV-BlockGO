const SESSION_TOKEN_KEY = 'blockgo.auth.token';
const SESSION_ROLE_KEY = 'blockgo.auth.role';
const LEGACY_TOKEN_KEY = 'token';
const LEGACY_ROLE_KEY = 'userRole';
const SESSION_EVENT_KEY = 'blockgo.auth.event';
const SESSION_CHANNEL_NAME = 'blockgo.auth';

const ROLE_ROUTES = Object.freeze({
  system_admin: '/system-admin',
  registrar: '/registrar',
  department_admin: '/department-admin',
  faculty: '/faculty',
  student: '/student',
});

export const normalizeSessionRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['system_admin', 'systemadmin', 'system_administrator', 'systemadministrator'].includes(normalized)) return 'system_admin';
  if (['dept_admin', 'deptadmin', 'department_admin', 'departmentadmin', 'department', 'chairperson', 'department_head', 'admin', 'departmentmsp'].includes(normalized)) return 'department_admin';
  if (normalized === 'facultymsp') return 'faculty';
  if (normalized === 'registrarmsp') return 'registrar';
  return normalized;
};

export const decodeAuthToken = (token) => {
  const encodedPayload = String(token || '').split('.')[1];
  if (!encodedPayload) throw new Error('Invalid authentication token.');
  const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
  const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
  return JSON.parse(atob(paddedPayload));
};

export const roleFromToken = (token) => {
  const payload = decodeAuthToken(token);
  return normalizeSessionRole(
    payload.dbRole || payload.role || payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']
  );
};

export const accountFromToken = (token) => {
  try {
    const payload = decodeAuthToken(token);
    return String(payload.username || payload.email || '').trim().toLowerCase();
  } catch {
    return '';
  }
};

export const isAuthTokenExpired = (token, now = Date.now()) => {
  try {
    const expiresAt = Number(decodeAuthToken(token).exp || 0) * 1000;
    return expiresAt > 0 && expiresAt <= now;
  } catch {
    return true;
  }
};

export const routeForRole = (role) => ROLE_ROUTES[normalizeSessionRole(role)] || '/login';

export const roleForRoute = (pathname) => {
  const normalizedPath = `/${String(pathname || '').split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '')}`;
  if (normalizedPath === '/dept-admin') return 'department_admin';
  return Object.entries(ROLE_ROUTES).find(([, route]) => route === normalizedPath)?.[0] || null;
};

export const getAuthToken = () => sessionStorage.getItem(SESSION_TOKEN_KEY);

export const setAuthSession = (token, role) => {
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  sessionStorage.setItem(SESSION_ROLE_KEY, normalizeSessionRole(role));
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_ROLE_KEY);
};

const publishSessionEvent = (payload) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT_KEY, { detail: payload }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  }
  localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify(payload));
  localStorage.removeItem(SESSION_EVENT_KEY);
};

export const broadcastAuthInvalidation = (account, reason = 'password_changed') => {
  const normalizedAccount = String(account || '').trim().toLowerCase();
  if (!normalizedAccount) return;
  publishSessionEvent({
    type: 'logout',
    account: normalizedAccount,
    reason,
    nonce: `${Date.now()}-${Math.random()}`,
  });
};

export const clearAuthSession = ({ broadcast = false, reason = 'logout' } = {}) => {
  const account = accountFromToken(getAuthToken());
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_ROLE_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_ROLE_KEY);
  if (broadcast) publishSessionEvent({ type: 'logout', account, reason, nonce: `${Date.now()}-${Math.random()}` });
};

export const expireAuthSession = (reason = 'expired') => clearAuthSession({ broadcast: true, reason });

export const subscribeToAuthSessionEvents = (listener) => {
  if (typeof window === 'undefined') return () => {};
  const receive = (payload) => {
    if (!payload || payload.type !== 'logout') return;
    const currentAccount = accountFromToken(getAuthToken());
    if (payload.account && currentAccount && payload.account !== currentAccount) return;
    listener(payload);
  };
  const localHandler = (event) => receive(event.detail);
  const storageHandler = (event) => {
    if (event.key !== SESSION_EVENT_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed cross-tab data. */ }
  };
  window.addEventListener(SESSION_EVENT_KEY, localHandler);
  window.addEventListener('storage', storageHandler);
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SESSION_CHANNEL_NAME) : null;
  if (channel) channel.onmessage = (event) => receive(event.data);
  return () => {
    window.removeEventListener(SESSION_EVENT_KEY, localHandler);
    window.removeEventListener('storage', storageHandler);
    channel?.close();
  };
};

export const migrateLegacyAuthSession = () => {
  const currentToken = getAuthToken();
  if (currentToken) return currentToken;

  const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacyToken) return null;

  setAuthSession(legacyToken, roleFromToken(legacyToken));
  return legacyToken;
};
