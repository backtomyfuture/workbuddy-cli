// Account routing for a logged-in WorkBuddy session.
// Enterprise hosts come from the sign-in itself. The User-Agent is the one
// WorkBuddy's own CLI sends: copilot.tencent.com answers 10085 to anything else.

const CLIENT_APP_VERSION = '5.9.3';
const CLIENT_CLI_VERSION = '2.165.0';

// WorkBuddy/<app> <appName>/<app> CLI/<cli>, read from WorkBuddy 5.9.3.
// WORKBUDDY_USER_AGENT replaces the whole value when a newer build is required.
export function clientUserAgent() {
  const override = process.env.WORKBUDDY_USER_AGENT?.trim();
  if (override) return override;
  const app = CLIENT_APP_VERSION;
  return `WorkBuddy/${app} WorkBuddy/${app} CLI/${CLIENT_CLI_VERSION}`;
}

const DEFAULT_ENDPOINT = 'https://www.workbuddy.cn';

const ENTERPRISE_HOST = /^(?:[a-z0-9-]+\.sso\.copilot\.tencent\.com|[a-z0-9-]+\.copilot\.qq\.com|[a-z0-9-]+\.sso\.codebuddy\.cn)$/i;
const IOA_HOSTS = new Set([
  'tencent.sso.copilot.tencent.com',
  'tencent.sso.codebuddy.cn'
]);

export function enterpriseHost(domain) {
  const host = String(domain || '').trim().toLowerCase();
  if (!host || IOA_HOSTS.has(host) || !ENTERPRISE_HOST.test(host)) return null;
  return host;
}

export function apiOrigin(session, fallback = DEFAULT_ENDPOINT) {
  const host = enterpriseHost(session?.auth?.domain);
  if (host) return `https://${host}`;
  return String(session?.endpoint || fallback).replace(/\/+$/, '');
}

export function isApiKeySession(session) {
  return session?.auth?.source === 'api-key';
}

export function apiAuthHeaders(session, { accept } = {}) {
  const headers = { 'User-Agent': clientUserAgent() };
  if (accept) headers.Accept = accept;
  const token = session?.auth?.accessToken;
  if (!token) return headers;
  headers.Authorization = `Bearer ${token}`;
  if (isApiKeySession(session)) {
    headers['X-API-Key'] = token;
    headers['X-User-Id'] = session.account?.uid || `anonymous_${token.slice(-8)}`;
    return headers;
  }
  if (session.auth?.domain) headers['X-Domain'] = session.auth.domain;
  if (session.account?.uid) headers['X-User-Id'] = session.account.uid;
  if (session.account?.enterpriseId) {
    headers['X-Enterprise-Id'] = session.account.enterpriseId;
    headers['X-Tenant-Id'] = session.account.enterpriseId;
  }
  return headers;
}

const RENEW_AGE_MS = 24 * 60 * 60 * 1000;
const RENEW_LEAD_MS = 60 * 1000;

// Refresh shortly before the access token ends, and also once it is a day
// old. A refresh token that is itself about to end is left alone.
export function accessShouldRenew(session, now = Date.now()) {
  if (!session?.auth?.refreshToken || isApiKeySession(session)) return false;
  if (session.auth.refreshExpiresAt && now >= session.auth.refreshExpiresAt - RENEW_LEAD_MS) return false;
  if (session.auth.expiresAt && now >= session.auth.expiresAt - RENEW_LEAD_MS) return true;
  if (typeof session.auth.lastRefreshTime !== 'number') return true;
  return now - session.auth.lastRefreshTime >= RENEW_AGE_MS;
}

// A 401 refreshes the access token only when the body does not name some
// other product error. One refresh is shared by the caller.
export function shouldRefreshAccessToken(status, wwwAuthenticate, raw) {
  if (status !== 401) return false;
  if (/invalid_token/i.test(wwwAuthenticate || '')) return true;
  const text = String(raw || '');
  if (/invalid_token/i.test(text)) return true;
  if (!text.trim()) return true;
  let code;
  try {
    const body = JSON.parse(text);
    code = body?.code ?? body?.error?.code;
  } catch {
    return true;
  }
  if (code === undefined || code === null || code === '') return true;
  return Number(code) === 401;
}
