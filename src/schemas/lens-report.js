// Schemas for per-lens report output files.
//
// Unlike the existing ReportSchema (which is heavily .passthrough() to
// tolerate LLM output drift), the new lens-report schemas keep core
// quality fields strict — title, path, description (min 50 chars),
// ingredient.url (valid URL). Secondary fields remain optional +
// passthrough to absorb minor prompt drift without blocking deploy.

import { z } from 'zod';

const IngredientSchema = z
  .object({
    source: z.string(),
    url: z.string().url(),
    name: z.string().optional(),
    stars: z.number().nullable().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const FeasibilityEvidenceSchema = z
  .object({
    source_url: z.string().url().optional(),
    readme_excerpt: z.string().optional(),
    release_or_version_note: z.string().optional(),
    claimed_capability: z.string().optional(),
  })
  .passthrough();

const MustHaveTestSchema = z
  .object({
    seasoning_indispensable_check: z.string().optional(),
    demo_able_check: z.string().optional(),
    buyer_commits_check: z.string().optional(),
  })
  .passthrough();

const FocusIdeaSchema = z
  .object({
    // Required core fields — schema validation hard fail if missing
    title: z.string().min(1),
    path: z.enum(['oem', 'isv-vertical', 'isv-consumer', 'isv-dev-oss']),
    description: z.string().min(50),
    ingredient: IngredientSchema,
    // Optional secondary fields
    seasoning_use: z.string().optional(),
    customer_scenario: z.string().optional(),
    demo_path: z.string().optional(),
    feasibility_evidence: FeasibilityEvidenceSchema.optional(),
    effort_estimate: z.string().optional(),
    must_have_test: MustHaveTestSchema.optional(),
  })
  .passthrough();

// adjacent_ideas: same shape but lighter — all top-level fields optional,
// and description drops the focus_idea min(50) length constraint
// (副菜可以淺 per spec §5.4.3).
const AdjacentIdeaSchema = FocusIdeaSchema.partial().extend({
  description: z.string().optional(),
});

const OssPulseItemSchema = z
  .object({
    name: z.string(),
    url: z.string().url(),
    source: z.string().optional(),
    stars: z.number().nullable().optional(),
    description: z.string().optional(),
    fits: z.array(z.string()).optional(),
    fit_reason: z.string().optional(),
  })
  .passthrough();

const RadarItemSchema = z
  .object({
    title: z.string(),
    summary: z.string().optional(),
    url: z.string().url().optional(),
    relevance_axis: z.string().optional(),
    impact_window: z.string().optional(),
  })
  .passthrough();

export const PhisonLensReportSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lens_id: z.literal('phison-aidaptiv'),
    focus_idea: FocusIdeaSchema,
    oss_pulse: z.array(OssPulseItemSchema).min(1),
    adjacent_ideas: z.array(AdjacentIdeaSchema).optional(),
    radar: z.array(RadarItemSchema).optional(),
    meta: z.object({}).passthrough().optional(),
  })
  .passthrough();
