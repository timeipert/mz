import * as M from '../types/model';
import { lemmaText } from './lemma-utils';
import { COMMENT_CATEGORIES } from './comment-categories';

/**
 * Reconstructs a scholarly critical apparatus entry line for a comment.
 */
export function apparatusPreviewLine(comment: M.Comment, original: M.ZeileContainer | undefined): string {
  let result = '';

  // 1. Category prefix
  if (comment.category) {
    const cat = COMMENT_CATEGORIES.find(c => c.key === comment.category);
    if (cat) {
      result += `[${cat.label}] `;
    }
  }

  // 2. Lemma
  const lemma = lemmaText(original);
  if (lemma) {
    result += `${lemma}] `;
  }

  // 3. Body content
  if (comment.commentType === 'lines') {
    const readings: string[] = [];
    if (comment.lines) {
      for (let j = 0; j < comment.lines.length; j++) {
        const line = comment.lines[j];
        const siglum = comment.readingWitnesses?.[j] || `reading ${j + 1}`;
        let readingText = '';
        if (line.kind === M.ContainerKind.ZeileContainer) {
          readingText = lemmaText(line);
        } else if (line.kind === M.ContainerKind.ParatextContainer) {
          readingText = line.text || '';
        }
        readings.push(`${siglum}: ${readingText}`);
      }
    }
    result += readings.join('; ');
  } else if (comment.commentType === 'tree') {
    result += '(structured comparison)';
  } else {
    // Default to 'text' type
    const text = comment.text || '';
    if (text.length > 80) {
      result += text.substring(0, 80) + '...';
    } else {
      result += text;
    }
  }

  // 4. Emendation suffix
  if (comment.emendation) {
    result += ' ⟨em.⟩';
  }

  return result;
}
