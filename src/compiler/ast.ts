import type { Span } from './diagnostics.ts';

/** A (possibly multi-word) station or line name as written. */
export interface Name {
  text: string;
  span: Span;
}

export interface BoardStmt {
  kind: 'board';
  span: Span;
  keyword: Span;
  station: Name | null;
}

export interface RideStmt {
  kind: 'ride';
  span: Span;
  keyword: Span;
  line: Name | null;
  dest: Name | null;
}

export interface ChangeStmt {
  kind: 'change';
  span: Span;
  keyword: Span;
  line: Name | null;
}

export interface ExitStmt {
  kind: 'exit';
  span: Span;
  keyword: Span;
}

export type Stmt = BoardStmt | RideStmt | ChangeStmt | ExitStmt;

export interface Program {
  statements: Stmt[];
  span: Span;
}
