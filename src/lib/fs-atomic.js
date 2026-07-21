import { renameSync, writeFileSync } from 'node:fs';

// Same-dir temp + rename so a mid-write crash can never leave a truncated
// file at `path` (rename(2) is atomic on POSIX). Used by the cross-day
// ledgers, where a truncated file reads as "corrupt" on the next run.
export function atomicWriteFileSync(path, content) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
