import { describe, expect, it } from 'vitest';
import { _internals } from '../src/lib/commit.js';

const { tokenizedRemoteUrl } = _internals;

describe('tokenizedRemoteUrl', () => {
  it('embeds token in GitHub HTTPS URL', () => {
    const url = tokenizedRemoteUrl('ghp_abc123');
    expect(url).toBe('https://x-access-token:ghp_abc123@github.com/bolin8017/ai-daily-report.git');
  });
});
