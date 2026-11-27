import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessShouldRenew,
  apiAuthHeaders,
  apiOrigin,
  clientUserAgent,
  enterpriseHost,
  isApiKeySession,
  shouldRefreshAccessToken
} from '../bin/session-auth.mjs';

test('enterprise sign-in uses the host named by the token', () => {
  const session = {
    endpoint: 'https://www.workbuddy.cn',
    auth: { domain: 'acme.sso.copilot.tencent.com', accessToken: 'access' }
  };
  assert.equal(enterpriseHost(session.auth.domain), 'acme.sso.copilot.tencent.com');
  assert.equal(apiOrigin(session), 'https://acme.sso.copilot.tencent.com');
});

test('personal and iOA sign-ins stay on the saved endpoint', () => {
  assert.equal(enterpriseHost('www.workbuddy.cn'), null);
  assert.equal(enterpriseHost('tencent.sso.copilot.tencent.com'), null);
  assert.equal(apiOrigin({ endpoint: 'https://www.workbuddy.cn', auth: { domain: 'www.workbuddy.cn' } }), 'https://www.workbuddy.cn');
});

test('browser auth sends the account domain and enterprise ids', () => {
  const headers = apiAuthHeaders({
    auth: { accessToken: 'access', domain: 'acme.sso.copilot.tencent.com' },
    account: { uid: 'u1', enterpriseId: 'ent-1' }
  }, { accept: 'application/json' });
  assert.equal(headers.Authorization, 'Bearer access');
  assert.equal(headers['X-Domain'], 'acme.sso.copilot.tencent.com');
  assert.equal(headers['X-Enterprise-Id'], 'ent-1');
  assert.equal(headers['X-Tenant-Id'], 'ent-1');
  assert.equal(headers['User-Agent'], 'WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0');
  assert.equal(headers['X-IDE-Name'], undefined);
});

test('an API key is sent as the caller key and is not refreshed', () => {
  const session = {
    auth: { source: 'api-key', accessToken: 'ck_example_key_12345678' },
    account: { uid: 'anonymous_12345678' }
  };
  assert.equal(isApiKeySession(session), true);
  const headers = apiAuthHeaders(session);
  assert.equal(headers['X-API-Key'], 'ck_example_key_12345678');
  assert.equal(headers['X-User-Id'], 'anonymous_12345678');
  assert.equal(headers['X-Domain'], undefined);
  assert.equal(headers['User-Agent'], clientUserAgent());
  const previous = process.env.WORKBUDDY_USER_AGENT;
  process.env.WORKBUDDY_USER_AGENT = 'WorkBuddy/9.9.9 WorkBuddy/9.9.9 CLI/9.9.9';
  try {
    assert.equal(clientUserAgent(), 'WorkBuddy/9.9.9 WorkBuddy/9.9.9 CLI/9.9.9');
  } finally {
    if (previous === undefined) delete process.env.WORKBUDDY_USER_AGENT;
    else process.env.WORKBUDDY_USER_AGENT = previous;
  }
  assert.equal(shouldRefreshAccessToken(401, '', '{"code":14018,"msg":"credits"}'), false);
});

test('a day-old browser sign-in renews, an API key does not', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const browser = {
    auth: {
      refreshToken: 'refresh',
      accessToken: 'access',
      expiresAt: now + 20 * day,
      refreshExpiresAt: now + 21 * day,
      lastRefreshTime: now - day - 1000
    }
  };
  assert.equal(accessShouldRenew(browser, now), true);
  assert.equal(accessShouldRenew({
    ...browser,
    auth: { ...browser.auth, lastRefreshTime: now - 1000 }
  }, now), false);
  assert.equal(accessShouldRenew({
    auth: { source: 'api-key', accessToken: 'ck_example', refreshToken: 'nope', lastRefreshTime: 0 }
  }, now), false);
});

test('token expiry refreshes, a named product error does not', () => {
  assert.equal(shouldRefreshAccessToken(401, 'Bearer error="invalid_token"', ''), true);
  assert.equal(shouldRefreshAccessToken(401, '', ''), true);
  assert.equal(shouldRefreshAccessToken(401, '', '{"code":11128,"msg":"refused"}'), false);
  assert.equal(shouldRefreshAccessToken(403, '', ''), false);
});
