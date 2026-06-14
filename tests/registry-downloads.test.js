import { describe, expect, it } from 'vitest';
import { fetchPackageDownloads } from '../src/lib/registry-downloads.js';

const okFetch = (body) => async () => ({ ok: true, json: async () => body });

describe('fetchPackageDownloads', () => {
  it('reads npm last-week downloads', async () => {
    const n = await fetchPackageDownloads('pkg', { fetchImpl: okFetch({ downloads: 12345 }) });
    expect(n).toBe(12345);
  });
  it('returns null on a failed request (fail-soft)', async () => {
    const n = await fetchPackageDownloads('pkg', { fetchImpl: async () => ({ ok: false }) });
    expect(n).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    const n = await fetchPackageDownloads('pkg', {
      fetchImpl: async () => {
        throw new Error('net');
      },
    });
    expect(n).toBeNull();
  });
});
