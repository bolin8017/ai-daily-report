// Schema tests for PhisonLensReportSchema — the phison-aidaptiv lens output shape.

import { describe, expect, it } from 'vitest';
import { PhisonLensReportSchema } from '../src/schemas/lens-report.js';

describe('PhisonLensReportSchema', () => {
  const minimalValid = {
    date: '2026-05-16',
    lens_id: 'phison-aidaptiv',
    focus_idea: {
      title: '法律事務所離線契約 redline tool',
      path: 'isv-vertical',
      description:
        '法律 ISV 把客戶舊版契約跟我方建議版本透過 Llama-70B 本機比對、自動標差異 — 全程資料不出筆電。針對台灣事務所 NDA 嚴格場景設計、無雲端 API 月費、無外傳風險。',
      ingredient: {
        source: 'github-trending',
        url: 'https://github.com/some-org/contract-diff',
      },
    },
    oss_pulse: [
      {
        name: 'contract-diff',
        url: 'https://github.com/some-org/contract-diff',
      },
    ],
  };

  it('accepts minimal valid report', () => {
    const result = PhisonLensReportSchema.safeParse(minimalValid);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  it('rejects focus_idea missing required title', () => {
    const broken = structuredClone(minimalValid);
    delete broken.focus_idea.title;
    const result = PhisonLensReportSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects focus_idea with invalid path enum', () => {
    const broken = structuredClone(minimalValid);
    broken.focus_idea.path = 'datacenter';
    const result = PhisonLensReportSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects focus_idea description shorter than 50 chars', () => {
    const broken = structuredClone(minimalValid);
    broken.focus_idea.description = '太短了';
    const result = PhisonLensReportSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects focus_idea.ingredient.url not a URL', () => {
    const broken = structuredClone(minimalValid);
    broken.focus_idea.ingredient.url = 'not-a-url';
    const result = PhisonLensReportSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects lens_id mismatch', () => {
    const broken = structuredClone(minimalValid);
    broken.lens_id = 'wrong-lens';
    const result = PhisonLensReportSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('accepts adjacent_ideas with partial fields and short description', () => {
    const withAdjacent = { ...minimalValid };
    withAdjacent.adjacent_ideas = [
      { title: 'Lighter side dish', description: 'partial detail only fine here too' },
    ];
    const result = PhisonLensReportSchema.safeParse(withAdjacent);
    expect(result.success).toBe(true);
  });

  it('accepts radar items', () => {
    const withRadar = { ...minimalValid };
    withRadar.radar = [
      {
        title: 'Samsung KV Cache Offloading 白皮書',
        url: 'https://download.semiconductor.samsung.com/resources/white-paper/scaling_ai_inference_with_kv_cache_offloading.pdf',
        relevance_axis: 'competition',
        impact_window: 'this quarter',
      },
    ];
    const result = PhisonLensReportSchema.safeParse(withRadar);
    expect(result.success).toBe(true);
  });
});
