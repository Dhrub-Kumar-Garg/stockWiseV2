import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardAccess, dashboardDTO} from '../scripts/v2/dashboard.mjs';
import {notify, checkCommands} from '../scripts/v2/telegram.mjs';
test('private dashboard fails closed and accepts only configured bearer token', () => {
  const secret = 'test-only-shared-token-of-at-least-32-characters';
  assert.equal(dashboardAccess(new Headers(), {}).status, 503);
  assert.equal(dashboardAccess(new Headers(), {STOCKWISE_DASHBOARD_TOKEN: secret}).status, 401);
  assert.equal(dashboardAccess(new Headers({authorization: 'Bearer wrong'}), {STOCKWISE_DASHBOARD_TOKEN: secret}).status, 401);
  assert.equal(dashboardAccess(new Headers({authorization: `Bearer ${secret}`}), {STOCKWISE_DASHBOARD_TOKEN: secret}).ok, true);
});
test('DTO cannot leak config, raw state or unknown nested fields', () => {
  const secret = 'FAKE_SECRET_SENTINEL';
  const body = dashboardDTO({config: {key: secret}, state: {key: secret}, signals: {equity: 125, apiKey: secret, positions: [{symbol: 'BTC-USD', key: secret}]}, strategies: [{id: 'test', key: secret, learned: {n: 1, key: secret}}]});
  assert.equal(body.v2.signals.equity, 125); assert.ok(!JSON.stringify(body).includes(secret));
  assert.ok(!('config' in body.v2) && !('state' in body.v2));
});
test('optional Telegram has no network activity unless explicitly enabled', async () => {
  let calls = 0; const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('must not send'); };
  try { await notify('fixture'); await checkCommands({}); assert.equal(calls, 0); } finally { globalThis.fetch = oldFetch; }
});
