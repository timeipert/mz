import * as M from '../types/model';

/**
 * Reconstructs the lemma text from a ZeileContainer.
 * Syllables are joined with spaces when they don't end in a hyphen.
 * Trailing hyphens are kept and no space is added after them.
 */
export function lemmaText(zeile: M.ZeileContainer | undefined): string {
  if (!zeile) return '';
  const syllables = M.getSyllables(zeile);
  if (!syllables || syllables.length === 0) return '';

  let result = '';
  for (let i = 0; i < syllables.length; i++) {
    const syl = syllables[i];
    const text = (syl.text || '').trim();
    if (!text) continue;

    if (result.length > 0 && !result.endsWith('-') && !result.endsWith(' ')) {
      result += ' ';
    }
    result += text;
  }
  return result;
}
