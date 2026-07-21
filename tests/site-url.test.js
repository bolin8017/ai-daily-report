// Review findings site-2 (URL scheme allowlist — before this, a javascript:
// url from a poisoned RSS→LLM chain was blocked ONLY by the page CSP) and
// site-3 (RSS 2.0 requires RFC-822 pubDate; ISO-8601 gets dropped/rejected
// by strict aggregators).

import { describe, expect, it } from 'vitest';
import { rfc822Date, safeHttpUrl, scrubUrls } from '../src/lib/site-url.js';

describe('safeHttpUrl', () => {
  it('passes http and https URLs through', () => {
    expect(safeHttpUrl('https://github.com/o/r')).toBe('https://github.com/o/r');
    expect(safeHttpUrl('http://localhost:1200/x')).toBe('http://localhost:1200/x');
  });

  it('rejects javascript:, data:, and other non-http schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    // eslint-disable-next-line no-script-url
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>1</script>')).toBeNull();
    expect(safeHttpUrl('vbscript:x')).toBeNull();
  });

  it('rejects non-strings and unparseable values', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
});

describe('scrubUrls', () => {
  it('removes non-http url-named fields anywhere in the report tree', () => {
    const report = {
      discoveries: {
        rising: [
          { id: 'x', url: 'javascript:alert(1)', name: 'evil' },
          { id: 'y', url: 'https://github.com/o/r', name: 'fine' },
        ],
      },
      pulse: { hn: [{ title: 't', url: 'https://ok', hn_url: 'data:text/html,x' }] },
    };
    scrubUrls(report);
    expect(report.discoveries.rising[0].url).toBeUndefined();
    expect(report.discoveries.rising[1].url).toBe('https://github.com/o/r');
    expect(report.pulse.hn[0].url).toBe('https://ok');
    expect(report.pulse.hn[0].hn_url).toBeUndefined();
    expect(report.discoveries.rising[0].name).toBe('evil');
  });
});

describe('rfc822Date', () => {
  it('formats a report date as RFC-822 at 08:00 +0800 with the right weekday', () => {
    // 2026-07-21 is a Tuesday
    expect(rfc822Date('2026-07-21')).toBe('Tue, 21 Jul 2026 08:00:00 +0800');
    // 2026-01-01 is a Thursday
    expect(rfc822Date('2026-01-01')).toBe('Thu, 01 Jan 2026 08:00:00 +0800');
  });
});
