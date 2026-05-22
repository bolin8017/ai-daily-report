import { describe, expect, it } from 'vitest';
import { normalizeDisclosure, rocToIso, TRACKED_TICKERS } from '../src/fetchers/mops.js';

describe('TRACKED_TICKERS', () => {
  it('contains Phison upstream/downstream', () => {
    expect(TRACKED_TICKERS).toContain('8299'); // Phison
    expect(TRACKED_TICKERS).toContain('2454'); // MediaTek
    expect(TRACKED_TICKERS).toContain('2330'); // TSMC
    expect(TRACKED_TICKERS).toContain('3711'); // ASE
  });
});

describe('rocToIso', () => {
  it('converts ROC 1150521 to 2026-05-21', () => {
    expect(rocToIso('1150521')).toBe('2026-05-21');
  });
  it('converts ROC 1130101 to 2024-01-01', () => {
    expect(rocToIso('1130101')).toBe('2024-01-01');
  });
  it('returns null for empty input', () => {
    expect(rocToIso('')).toBeNull();
    expect(rocToIso(undefined)).toBeNull();
  });
});

describe('normalizeDisclosure', () => {
  it('normalizes a TWSE OpenAPI row (trailing-space 主旨 quirk)', () => {
    const row = {
      出表日期: '1150521',
      發言日期: '1150520',
      發言時間: '92635',
      公司代號: '8299',
      公司名稱: '群聯',
      '主旨 ': '本公司公告與 SK Hynix 簽署 AI 記憶體合作備忘錄',
      符合條款: '第18款',
      事實發生日: '1150519',
      說明: '1. 合作項目: AI 記憶體開發...',
    };
    const norm = normalizeDisclosure(row);
    expect(norm.ticker).toBe('8299');
    expect(norm.ticker_name).toBe('群聯');
    expect(norm.disclosure_date).toBe('2026-05-21');
    expect(norm.statement_date).toBe('2026-05-20');
    expect(norm.headline).toContain('SK Hynix');
    expect(norm.url).toContain('co_id=8299');
  });

  it('decodes &#NN; HTML entities in headline', () => {
    const row = {
      出表日期: '1150521',
      發言日期: '1150521',
      公司代號: '6669',
      公司名稱: '緯穎',
      // &#12070; = U+2F26 (KangXi Radical CHILD ⼦), occurs in TWSE feed as a
      // placeholder when the proper CJK char isn't available.
      '主旨 ': '代&#12070;公司公告',
    };
    const headline = normalizeDisclosure(row).headline;
    expect(headline).toBe(`代${String.fromCharCode(12070)}公司公告`);
    expect(headline).not.toContain('&#');
  });
});
