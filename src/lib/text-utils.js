// Shared text utilities used by multiple fetchers.

/**
 * Strip C0 control characters except tab/LF/CR. Defends against pathological
 * READMEs that contain null bytes or other control bytes which break JSON
 * encoders downstream. Implemented as a charCodeAt loop instead of a regex
 * to keep the linter happy without needing biome-ignore pragmas on every
 * char-class entry.
 * @param {string} s
 * @returns {string}
 */
export function stripControlChars(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      out += s[i];
    }
  }
  return out;
}
