import { describe, expect, it } from 'vitest';
import { canonicalRepoKey } from '../src/lib/repo-key.js';

describe('canonicalRepoKey', () => {
  it('uses full_name when it is already owner/repo', () => {
    expect(canonicalRepoKey({ full_name: 'vllm-project/vllm' })).toBe('vllm-project/vllm');
  });

  it('parses owner/repo out of a github url when name is a bare slug', () => {
    expect(
      canonicalRepoKey({ name: 'superpowers', url: 'https://github.com/obra/superpowers' }),
    ).toBe('obra/superpowers');
  });

  it('falls back to name when it already looks like owner/repo', () => {
    expect(canonicalRepoKey({ name: 'audreyt/cool-repo' })).toBe('audreyt/cool-repo');
  });

  it('strips a trailing .git and slash', () => {
    expect(canonicalRepoKey({ url: 'https://github.com/a/b.git' })).toBe('a/b');
    expect(canonicalRepoKey({ url: 'https://github.com/a/b/' })).toBe('a/b');
  });

  it('returns null when no owner/repo can be derived', () => {
    expect(canonicalRepoKey({ name: 'superpowers' })).toBeNull();
    expect(canonicalRepoKey({})).toBeNull();
    expect(canonicalRepoKey(null)).toBeNull();
  });
});
