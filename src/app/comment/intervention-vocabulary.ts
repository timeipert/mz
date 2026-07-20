export interface InterventionItem {
  key: 'correction' | 'unclear' | 'supplied' | 'addition' | 'deletion' | 'damage';
  label: string;
  icon: string;
}

export const INTERVENTIONS: InterventionItem[] = [
  { key: 'correction', label: 'Correction', icon: 'bi-pencil' },
  { key: 'unclear', label: 'Unclear', icon: 'bi-question-circle' },
  { key: 'supplied', label: 'Supplied', icon: 'bi-plus-square-dotted' },
  { key: 'addition', label: 'Addition', icon: 'bi-node-plus' },
  { key: 'deletion', label: 'Deletion', icon: 'bi-eraser' },
  { key: 'damage', label: 'Damage', icon: 'bi-bandaid' }
];

export function getInterventionLabel(key: string): string {
  const found = INTERVENTIONS.find(i => i.key === key);
  return found ? found.label : '';
}
