import type { Span } from './diagnostics.ts';

export type TokenType = 'keyword' | 'word' | 'separator' | 'comment' | 'eof';

export interface Token {
  type: TokenType;
  /** Source text; for keywords, lower-cased. */
  value: string;
  span: Span;
}

export const KEYWORDS = ['board', 'ride', 'to', 'change', 'exit'] as const;
export type Keyword = (typeof KEYWORDS)[number];

const isKeyword = (w: string): w is Keyword => (KEYWORDS as readonly string[]).includes(w);

/**
 * Statements end at `;` or a newline. Everything else that isn't whitespace or a
 * `#` comment is a word, so station names can contain digits, dots, hyphens and
 * parentheses ("R.K. Puram", "Rohini Sector 18-19"). The parser joins runs of words
 * into multi-word names.
 */
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ';' || ch === '\n') {
      tokens.push({ type: 'separator', value: ch, span: { start: i, end: i + 1 } });
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === '#') {
      const end = source.indexOf('\n', i);
      const j = end < 0 ? source.length : end;
      tokens.push({ type: 'comment', value: source.slice(i, j), span: { start: i, end: j } });
      i = j;
    } else {
      let j = i;
      while (j < source.length && !/[\s;#]/.test(source[j])) j++;
      const text = source.slice(i, j);
      const lower = text.toLowerCase();
      tokens.push(isKeyword(lower)
        ? { type: 'keyword', value: lower, span: { start: i, end: j } }
        : { type: 'word', value: text, span: { start: i, end: j } });
      i = j;
    }
  }
  tokens.push({ type: 'eof', value: '', span: { start: source.length, end: source.length } });
  return tokens;
}
