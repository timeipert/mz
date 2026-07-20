export const COMMENT_COLORS: string[] = [
  '#2563eb', '#16a34a', '#f59e0b', '#a855f7',
  '#ec4899', '#0891b2', '#dc2626', '#84cc16',
];

export function commentColor(index: number): string {
  if (index < 0) return '#94a3b8';
  return COMMENT_COLORS[index % COMMENT_COLORS.length];
}
