// Per-section sub-schemas for Stage 2 Curate output.
//
// Each curator (shipped/pulse/market/tech) writes a JSON file at
// data/staging/curated/<section>.json validated against the matching schema
// before Stage 3 reads it. These schemas are strict on sub-group names
// (templates iterate them) — item shapes are passthrough.

import { z } from 'zod';
import { MarketItem, PulseItem, ShippedItem, TechItem } from './items.js';

export const ShippedCuratedSchema = z.object({
  trending: z.array(ShippedItem),
  topic_discovery: z.array(ShippedItem),
  dev_watch_taiwan: z.array(ShippedItem),
  dev_watch_global: z.array(ShippedItem),
});

export const PulseCuratedSchema = z.object({
  hn: z.array(PulseItem),
  lobsters: z.array(PulseItem),
  chinese_community: z.array(PulseItem),
  ai_bloggers: z.array(PulseItem),
});

export const MarketCuratedSchema = z.object({
  ma: z.array(MarketItem),
  funding: z.array(MarketItem),
  taiwan: z.array(MarketItem),
});

export const TechCuratedSchema = z.object({
  vendor: z.array(TechItem),
  models: z.array(TechItem),
  benchmarks: z.array(TechItem),
  aidaptiv: z.array(TechItem),
});
