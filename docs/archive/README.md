# Archived docs

Historical and superseded documents, kept for reference only. **They are frozen
snapshots — do not treat them as current.** For the live system design, flow, and
operations, see [docs/architecture.md](../architecture.md) and [CLAUDE.md](../../CLAUDE.md).

| File | What it was | Superseded by |
|---|---|---|
| `hermes-production-runner.md` | Migration guide for moving the production cron to the repo-owned runner (wrapper scripts, state contract, monitor rendering) + the aggregator dependency note. | The runner is `src/ops/production-run.js`; system design + the aggregator dependency now live in [architecture.md](../architecture.md) and the Environment section of [CLAUDE.md](../../CLAUDE.md). |
| `hermes-cron-migration.md` | The original (1200-line) Hermes cron takeover design doc — the last migration's working artifact. | [architecture.md](../architecture.md) (current "Hermes + CI Architecture" + "Scheduled deployment via Hermes cron"). |
| `firewall-allowlist.md` | Hostnames to whitelist when running the pipeline behind a corporate firewall. | Not actively maintained; kept for reference if a firewalled deploy is needed again. |
