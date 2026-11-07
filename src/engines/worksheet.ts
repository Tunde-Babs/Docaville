/** Positions and sizes are fractions of the source image, so zoom never moves an answer. */
export interface WorksheetAnnotation {
  id: string;
  kind: 'text' | 'cross';
  x: number;
  y: number;
  width: number;
  size: number; // font em as a fraction of image width
  color: string;
  text: string;
}

export function worksheetLines(note: WorksheetAnnotation): string[] {
  if (note.kind === 'cross') return ['×'];
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = '100px Arial';
  const limit = note.width / note.size * 100;
  const lines: string[] = [];
  for (const paragraph of note.text.split('\n')) {
    let rest = [...paragraph];
    if (!rest.length) lines.push('');
    while (rest.length) {
      let count = 1;
      while (count < rest.length && context.measureText(rest.slice(0, count + 1).join('')).width <= limit) count++;
      if (count < rest.length) {
        const space = rest.slice(0, count).lastIndexOf(' ');
        if (space > 0) count = space + 1;
      }
      lines.push(rest.slice(0, count).join(''));
      rest = rest.slice(count);
    }
  }
  return lines;
}

/** Clamp an answer to the visible image, including wrapped text height. */
export function fitWorksheetAnnotation(note: WorksheetAnnotation, aspect: number): WorksheetAnnotation {
  if (![note.x, note.y, note.width, note.size, aspect].every(Number.isFinite) || aspect <= 0) throw new Error('Invalid worksheet answer position.');
  if (!/^#[0-9a-f]{6}$/i.test(note.color)) throw new Error('Choose a valid answer colour.');
  const size = Math.max(0.012, Math.min(0.06, note.size));
  const width = note.kind === 'cross' ? size * 1.3 : Math.max(size * 3, Math.min(0.9, note.width));
  const fitted = { ...note, size, width };
  const height = worksheetHeight(fitted, aspect);
  if (height > 1) throw new Error('This answer is too long to fit on the page. Shorten it or use smaller text.');
  return { ...fitted, x: Math.max(0, Math.min(1 - width, note.x)), y: Math.max(0, Math.min(1 - height, note.y)) };
}

export function worksheetHeight(note: WorksheetAnnotation, aspect: number) {
  return Math.max(1, worksheetLines(note).length) * note.size * 1.3 * aspect;
}
