import { diffWordsWithSpace } from 'diff';
export interface ReviewChange { id: number; before: string; after: string; changed: boolean; decision: 'pending' | 'accepted' | 'rejected' }
export function compareText(before: string, after: string): ReviewChange[] {
  const diff = diffWordsWithSpace(before, after, { timeout: 3000, maxEditLength: 30000 }), changes: ReviewChange[] = [];
  if (!diff) throw new Error('These documents differ too much for a responsive word comparison. Compare smaller sections.');
  for (let i = 0; i < diff.length; i++) {
    const part = diff[i];
    if (part.removed && diff[i + 1]?.added) { changes.push({ id: changes.length, before: part.value, after: diff[++i].value, changed: true, decision: 'pending' }); }
    else changes.push({ id: changes.length, before: part.added ? '' : part.value, after: part.removed ? '' : part.value, changed: !!(part.added || part.removed), decision: 'pending' });
  }
  return changes;
}
export const reviewedText = (changes: ReviewChange[]) => changes.map(change => change.changed && change.decision !== 'accepted' ? change.before : change.after).join('');
