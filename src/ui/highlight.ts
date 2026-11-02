import type { CompileResult } from '../compiler/index.ts';
import { network } from '../compiler/index.ts';
import { esc } from './html.ts';

const SEVERITY_RANK = { info: 1, warning: 2, error: 3 } as const;

/**
 * Renders the source as HTML for the overlay behind the textarea. Each character gets
 * a token class, an optional line colour and a diagnostic severity; runs of identical
 * characters are then merged into spans, which keeps overlapping ranges simple.
 */
export function renderHighlight(source: string, result: CompileResult): string {
  const n = source.length;
  const cls: string[] = new Array(n).fill('');
  const color: string[] = new Array(n).fill('');
  const diag: number[] = new Array(n).fill(0);

  const paint = (start: number, end: number, c: string, col = '') => {
    for (let i = start; i < end; i++) {
      cls[i] = c;
      color[i] = col;
    }
  };

  for (const t of result.tokens) {
    if (t.type === 'keyword') paint(t.span.start, t.span.end, 'tk-kw');
    else if (t.type === 'comment') paint(t.span.start, t.span.end, 'tk-com');
    else if (t.type === 'separator' && t.value === ';') paint(t.span.start, t.span.end, 'tk-sep');
  }
  for (const s of result.program.statements) {
    const lineName = s.kind === 'ride' || s.kind === 'change' ? s.line : null;
    if (lineName) paint(lineName.span.start, lineName.span.end, 'tk-line', network.line(lineName.text)?.color ?? '');
    const station = s.kind === 'board' ? s.station : s.kind === 'ride' ? s.dest : null;
    if (station) paint(station.span.start, station.span.end, 'tk-st');
  }
  for (const d of result.diagnostics) {
    let { start, end } = d.span;
    if (start === end) {
      // Zero-width (e.g. missing 'exit' at end of file): mark the previous character.
      if (start === 0) continue;
      start -= 1;
    }
    const rank = SEVERITY_RANK[d.severity];
    for (let i = start; i < Math.min(end, n); i++) diag[i] = Math.max(diag[i], rank);
  }

  const diagClass = ['', 'dg-info', 'dg-warning', 'dg-error'];
  let html = '';
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && cls[j] === cls[i] && color[j] === color[i] && diag[j] === diag[i] && source[j] !== '\n' && source[i] !== '\n') j++;
    const text = esc(source.slice(i, j));
    const classes = [cls[i], diagClass[diag[i]]].filter(Boolean).join(' ');
    html += classes ? `<span class="${classes}"${color[i] ? ` style="--c:${color[i]}"` : ''}>${text}</span>` : text;
    i = j;
  }
  // A trailing newline needs content after it or the overlay ends up one line short.
  return html + '\n ';
}
