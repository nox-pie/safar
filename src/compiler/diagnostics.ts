export interface Span {
  start: number;
  end: number;
}

export type Severity = 'error' | 'warning' | 'info';

/** A machine-applicable edit: replace `span` in the source with `text`. */
export interface Fix {
  label: string;
  span: Span;
  text: string;
}

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  span: Span;
  help?: string;
  fix?: Fix;
}

export function lineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

export function applyFix(source: string, fix: Fix): string {
  return source.slice(0, fix.span.start) + fix.text + source.slice(fix.span.end);
}

/** Rust-style rendering with a caret under the offending text. */
const ANSI = { red: 31, yellow: 33, cyan: 36, blue: 34, bold: 1, dim: 2 } as const;
const SEVERITY_COLOR = { error: 'red', warning: 'yellow', info: 'cyan' } as const;

export function formatDiagnostic(
  source: string,
  d: Diagnostic,
  { file = 'journey.safar', color = false }: { file?: string; color?: boolean } = {},
): string {
  const paint = (style: keyof typeof ANSI, s: string) => (color ? `\x1b[${ANSI[style]}m${s}\x1b[0m` : s);
  const sev = SEVERITY_COLOR[d.severity];
  const { line, col } = lineCol(source, d.span.start);
  const lineText = source.split('\n')[line - 1] ?? '';
  const width = Math.max(1, Math.min(d.span.end, d.span.start + lineText.length - col + 1) - d.span.start);
  const gutter = ' '.repeat(String(line).length);
  const bar = paint('blue', '|');
  const out = [
    `${paint(sev, paint('bold', `${d.severity}[${d.code}]`))}${paint('bold', `: ${d.message}`)}`,
    `${gutter}${paint('blue', '-->')} ${file}:${line}:${col}`,
    `${gutter} ${bar}`,
    `${paint('blue', String(line))} ${bar} ${lineText}`,
    `${gutter} ${bar} ${' '.repeat(col - 1)}${paint(sev, '^'.repeat(width))}`,
  ];
  if (d.help) out.push(`${gutter} ${paint('blue', '=')} ${paint('bold', 'help')}: ${d.help}`);
  return out.join('\n');
}
