export interface CommentCategory {
  key: 'variant' | 'scribal' | 'liturgical' | 'commentary' | 'bibliography' | 'second_voice';
  label: string;
  short: string;
  icon: string;
  color: string;
}

export const COMMENT_CATEGORIES: CommentCategory[] = [
  { key: 'variant', label: 'Variant reading', short: 'Variant', icon: 'bi-shuffle', color: '#2563eb' },
  { key: 'scribal', label: 'Scribal feature', short: 'Scribal', icon: 'bi-vector-pen', color: '#9333ea' },
  { key: 'liturgical', label: 'Liturgical note', short: 'Liturgical', icon: 'bi-book', color: '#0d9488' },
  { key: 'commentary', label: 'Commentary', short: 'Commentary', icon: 'bi-chat-left-text', color: '#64748b' },
  { key: 'bibliography', label: 'Bibliography', short: 'Biblio.', icon: 'bi-journal-text', color: '#b45309' },
  { key: 'second_voice', label: 'Second Voice', short: '2nd Voice', icon: 'bi-music-note-beamed', color: '#e11d48' }
];

export function getCategoryDetails(key: string): CommentCategory | undefined {
  return COMMENT_CATEGORIES.find(c => c.key === key);
}
