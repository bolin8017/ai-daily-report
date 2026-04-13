import { describe, expect, it } from 'vitest';
import { stripControlChars } from '../src/lib/text-utils.js';

describe('stripControlChars', () => {
  it('preserves normal ASCII text', () => {
    expect(stripControlChars('Hello, World!')).toBe('Hello, World!');
  });

  it('preserves tabs, newlines, and carriage returns', () => {
    expect(stripControlChars('line1\n\tline2\r\n')).toBe('line1\n\tline2\r\n');
  });

  it('strips null bytes', () => {
    expect(stripControlChars('hello\x00world')).toBe('helloworld');
  });

  it('strips C0 control characters (0x01-0x08, 0x0E-0x1F)', () => {
    const input = 'a\x01b\x02c\x07d\x0Ee\x1Ff';
    expect(stripControlChars(input)).toBe('abcdef');
  });

  it('preserves Unicode / CJK characters', () => {
    expect(stripControlChars('台灣 AI 日報')).toBe('台灣 AI 日報');
  });

  it('handles empty string', () => {
    expect(stripControlChars('')).toBe('');
  });

  it('handles string that is entirely control characters', () => {
    expect(stripControlChars('\x00\x01\x02\x03')).toBe('');
  });
});
