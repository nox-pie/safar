import type { Name, Program, Stmt } from './ast.ts';
import type { Diagnostic, Span } from './diagnostics.ts';
import type { Token } from './lexer.ts';
import { levenshtein } from './network.ts';

// Grammar:
//   program = stmt { SEP stmt } [ SEP ]
//   stmt    = "board" NAME | "ride" [ NAME ] "to" NAME | "change" NAME | "exit"
//   NAME    = WORD { WORD }

const COMMAND_SYNONYMS: Record<string, string> = {
  enter: 'board', start: 'board', from: 'board', take: 'ride', go: 'ride', travel: 'ride',
  switch: 'change', transfer: 'change', interchange: 'change', alight: 'exit', leave: 'exit', end: 'exit', stop: 'exit',
};

function suggestCommand(word: string): string | undefined {
  const w = word.toLowerCase();
  if (COMMAND_SYNONYMS[w]) return COMMAND_SYNONYMS[w];
  return ['board', 'ride', 'change', 'exit'].find((c) => levenshtein(w, c) <= 2);
}

export interface ParseOptions {
  /** Recognizes line names, so `ride Yellow` isn't "fixed" into a ride to a station called Yellow. */
  isLine?: (name: string) => boolean;
}

export function parse(allTokens: Token[], { isLine = () => false }: ParseOptions = {}): { program: Program; diagnostics: Diagnostic[] } {
  const tokens = allTokens.filter((t) => t.type !== 'comment');
  const diagnostics: Diagnostic[] = [];
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const atStmtEnd = () => peek().type === 'separator' || peek().type === 'eof';
  const error = (code: string, message: string, span: Span, extra: Partial<Diagnostic> = {}) =>
    diagnostics.push({ severity: 'error', code, message, span, ...extra });

  function parseName(): Name | null {
    if (peek().type !== 'word') return null;
    const first = peek();
    let last = first;
    const words: string[] = [];
    while (peek().type === 'word') {
      last = next();
      words.push(last.value);
    }
    return { text: words.join(' '), span: { start: first.span.start, end: last.span.end } };
  }

  function skipToStmtEnd(): Span {
    const start = peek().span.start;
    let end = start;
    while (!atStmtEnd()) end = next().span.end;
    return { start, end };
  }

  function parseStatement(): Stmt | null {
    const kw = next();
    const start = kw.span.start;
    const spanTo = (end: number): Span => ({ start, end: Math.max(end, kw.span.end) });

    if (kw.type === 'word') {
      const cmd = suggestCommand(kw.value);
      const rest = skipToStmtEnd();
      error('E106', `Unknown command '${kw.value}'`, { start, end: Math.max(rest.end, kw.span.end) }, {
        help: cmd ? `Did you mean '${cmd}'? Commands are: board, ride, change, exit.` : 'Commands are: board, ride, change, exit.',
        fix: cmd ? { label: `Replace with '${cmd}'`, span: kw.span, text: cmd } : undefined,
      });
      return null;
    }

    switch (kw.value) {
      case 'board': {
        const station = parseName();
        if (!station) error('E101', "Expected a station name after 'board'", kw.span, { help: 'Example: board Rajiv Chowk' });
        return { kind: 'board', span: spanTo(station?.span.end ?? kw.span.end), keyword: kw.span, station };
      }
      case 'ride': {
        const line = parseName();
        if (peek().type === 'keyword' && peek().value === 'to') {
          const to = next();
          const dest = parseName();
          if (!dest) error('E104', "Expected a station name after 'to'", to.span, { help: 'Example: ride Yellow to Hauz Khas' });
          return { kind: 'ride', span: spanTo(dest?.span.end ?? to.span.end), keyword: kw.span, line, dest };
        }
        const named = line && isLine(line.text) ? line : null;
        error('E103', "Expected 'to' in ride", line?.span ?? kw.span, {
          help: named
            ? `Say where to ride: 'ride ${named.text} to <station>'.`
            : line ? `A ride needs a destination: 'ride <line> to <station>' or 'ride to <station>'.` : "Write 'ride <line> to <station>'.",
          fix: line && !named ? { label: `Change to 'ride to ${line.text}'`, span: line.span, text: `to ${line.text}` } : undefined,
        });
        return { kind: 'ride', span: spanTo(line?.span.end ?? kw.span.end), keyword: kw.span, line: null, dest: null };
      }
      case 'change': {
        const line = parseName();
        if (!line) error('E105', "Expected a line name after 'change'", kw.span, { help: 'Example: change Magenta' });
        return { kind: 'change', span: spanTo(line?.span.end ?? kw.span.end), keyword: kw.span, line };
      }
      case 'exit': {
        if (peek().type === 'word') {
          const extra = skipToStmtEnd();
          error('E107', "'exit' takes no arguments", extra, {
            help: 'You exit at the station your last ride ended at.',
            fix: { label: 'Remove', span: { start: kw.span.end, end: extra.end }, text: '' },
          });
        }
        return { kind: 'exit', span: kw.span, keyword: kw.span };
      }
      default: {
        // A stray 'to'.
        const rest = skipToStmtEnd();
        error('E107', `Unexpected '${kw.value}'`, { start, end: Math.max(rest.end, kw.span.end) }, {
          help: "Statements start with board, ride, change or exit.",
        });
        return null;
      }
    }
  }

  const statements: Stmt[] = [];
  const skipSeparators = () => {
    while (peek().type === 'separator') next();
  };

  skipSeparators();
  while (peek().type !== 'eof') {
    const stmt = parseStatement();
    if (stmt) statements.push(stmt);
    if (!atStmtEnd()) {
      const t = peek();
      if (t.type === 'keyword' && t.value !== 'to') {
        // Two statements run together: report and keep parsing from the keyword.
        error('E102', `Missing ';' before '${t.value}'`, t.span, {
          help: 'Separate statements with a semicolon or a new line.',
          fix: { label: "Insert ';'", span: { start: t.span.start, end: t.span.start }, text: '; ' },
        });
        continue;
      }
      error('E107', `Unexpected '${t.value}'`, skipToStmtEnd());
    }
    skipSeparators();
  }

  const eof = tokens.at(-1)!.span.end;
  return { program: { statements, span: { start: 0, end: eof } }, diagnostics };
}
