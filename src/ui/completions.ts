import type { CompileResult, Line } from '../compiler/index.ts';
import { network } from '../compiler/index.ts';
import { normalize } from '../compiler/network.ts';

export interface Completion {
  /** Text to insert in place of the partial word(s). */
  text: string;
  label: string;
  color?: string;
  /** Start offset of the text being replaced; it ends at the caret. */
  from: number;
}

const COMMANDS = ['board', 'ride', 'change', 'exit'];
const LIMIT = 6;

function rank<T>(items: T[], name: (t: T) => string, partial: string, preferred?: (t: T) => boolean): T[] {
  const q = normalize(partial);
  const scored = items.flatMap((item) => {
    const key = normalize(name(item));
    const wordStart = name(item).toLowerCase().split(/[\s\-.()]+/).some((w) => w.startsWith(partial.trim().toLowerCase()));
    const score = key.startsWith(q) ? 0 : wordStart ? 1 : key.includes(q) ? 2 : -1;
    return score < 0 ? [] : [{ item, score: score - (preferred?.(item) ? 3 : 0) }];
  });
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item);
}

/** What can be typed at the caret, based on the statement it's in. */
export function completionsAt(source: string, caret: number, result: CompileResult): Completion[] {
  const stmtStart = Math.max(source.lastIndexOf(';', caret - 1), source.lastIndexOf('\n', caret - 1)) + 1;
  const before = source.slice(stmtStart, caret);
  if (before.includes('#')) return [];

  const stations = (partial: string, onLine?: Line) => {
    if (!partial.trim() && !onLine) return [];
    const from = caret - partial.length;
    // Interchanges first so equally good matches favour the stations people change at.
    const pool = (onLine && !partial.trim() ? onLine.stations : network.stations)
      .slice()
      .sort((a, b) => b.lines.length - a.lines.length);
    return rank(pool, (s) => s.name, partial, onLine ? (s) => s.lines.includes(onLine) : undefined)
      .filter((s) => normalize(s.name) !== normalize(partial))
      .slice(0, LIMIT)
      .map((s) => ({ text: s.name, label: s.name, from }));
  };
  const lines = (partial: string) =>
    rank(network.lines, (l) => l.name, partial)
      .filter((l) => normalize(l.name) !== normalize(partial))
      .map((l) => ({ text: l.name, label: l.name, color: l.color, from: caret - partial.length }));

  let m: RegExpMatchArray | null;
  if ((m = before.match(/^\s*board\s+(.*)$/i))) return stations(m[1]);
  if ((m = before.match(/^\s*ride\s+(.*?)\bto\s+(.*)$/i))) {
    const stmt = result.program.statements.find((s) => s.kind === 'ride' && s.span.start >= stmtStart && s.span.start <= caret);
    const onLine = stmt?.kind === 'ride' ? result.check.rideLines.get(stmt) : undefined;
    return stations(m[2], onLine);
  }
  if ((m = before.match(/^\s*(?:ride|change)\s+([^]*)$/i))) {
    if (network.line(m[1].trim())) return [];
    return lines(m[1]);
  }
  if ((m = before.match(/^\s*([a-z]*)$/i)) && m[1]) {
    return COMMANDS.filter((c) => c.startsWith(m![1].toLowerCase()) && c !== m![1].toLowerCase())
      .map((c) => ({ text: c === 'exit' ? c : `${c} `, label: c, from: caret - m![1].length }));
  }
  return [];
}
