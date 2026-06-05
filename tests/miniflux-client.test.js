import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { minifluxAuthHeaders } from '../src/lib/miniflux-client.js';

const ENV_KEYS = ['MINIFLUX_TOKEN', 'MINIFLUX_USERNAME', 'MINIFLUX_PASSWORD'];
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
beforeEach(clearEnv);
afterEach(clearEnv);

describe('minifluxAuthHeaders', () => {
  it('uses X-Auth-Token when MINIFLUX_TOKEN is set', () => {
    process.env.MINIFLUX_TOKEN = 'tok';
    expect(minifluxAuthHeaders()).toEqual({ 'X-Auth-Token': 'tok' });
  });

  it('falls back to HTTP Basic auth from username/password', () => {
    process.env.MINIFLUX_USERNAME = 'admin';
    process.env.MINIFLUX_PASSWORD = 'pw';
    const expected = `Basic ${Buffer.from('admin:pw').toString('base64')}`;
    expect(minifluxAuthHeaders()).toEqual({ Authorization: expected });
  });

  it('prefers token over basic when both are set', () => {
    process.env.MINIFLUX_TOKEN = 'tok';
    process.env.MINIFLUX_USERNAME = 'admin';
    process.env.MINIFLUX_PASSWORD = 'pw';
    expect(minifluxAuthHeaders()).toEqual({ 'X-Auth-Token': 'tok' });
  });

  it('returns null when nothing is configured', () => {
    expect(minifluxAuthHeaders()).toBeNull();
  });
});
