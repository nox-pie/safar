import type { Program } from './ast.ts';
import { check, type CheckResult } from './checker.ts';
import type { Diagnostic } from './diagnostics.ts';
import { lex, type Token } from './lexer.ts';
import { lower, type Journey } from './lower.ts';
import { network as defaultNetwork, routeProgram, type Network } from './network.ts';
import { parse } from './parser.ts';

export interface CompileResult {
  source: string;
  tokens: Token[];
  program: Program;
  diagnostics: Diagnostic[];
  check: CheckResult;
  /** Present only when there are no errors. */
  journey: Journey | null;
  /** Wall-clock milliseconds per compiler phase. */
  timings: Record<Phase, number>;
}

export type Phase = 'lex' | 'parse' | 'check' | 'lower';

/** Only suggest a different route when it saves at least this many minutes. */
const FASTER_ROUTE_THRESHOLD_MIN = 5;

export function compile(source: string, net: Network = defaultNetwork): CompileResult {
  const timings: Record<Phase, number> = { lex: 0, parse: 0, check: 0, lower: 0 };
  const timed = <T>(phase: Phase, fn: () => T): T => {
    const t0 = performance.now();
    const out = fn();
    timings[phase] += performance.now() - t0;
    return out;
  };

  const tokens = timed('lex', () => lex(source));
  const { program, diagnostics: syntax } = timed('parse', () => parse(tokens, { isLine: (name) => net.line(name) !== undefined }));
  const checked = timed('check', () => check(program, net, { hasSyntaxErrors: syntax.length > 0 }));
  const diagnostics = [...syntax, ...checked.diagnostics];

  let journey: Journey | null = null;
  if (!diagnostics.some((d) => d.severity === 'error') && checked.origin && checked.destination) {
    journey = timed('lower', () => lower(checked.origin!, checked.destination!, checked.rides, net));
    const j = journey;
    const best = timed('lower', () => (j.legs.length ? net.plan(j.origin, j.destination) : null));
    if (best && journey.minutes.total - best.minutes >= FASTER_ROUTE_THRESHOLD_MIN) {
      const saved = Math.round(journey.minutes.total - best.minutes);
      const lines = [...new Set(best.rides.map((r) => r.line.name))].join(' → ');
      const board = program.statements[0];
      diagnostics.push({
        severity: 'info',
        code: 'I401',
        message: `A faster route exists: ${lines}, ~${Math.round(best.minutes)} min (saves ~${saved} min)`,
        span: board.span,
        help: 'Your journey is valid; this is just a suggestion.',
        fix: { label: 'Use faster route', span: program.span, text: routeProgram(journey.origin, best) },
      });
    }
  }

  diagnostics.sort((a, b) => a.span.start - b.span.start);
  return { source, tokens, program, diagnostics, check: checked, journey, timings };
}

export { applyFix, formatDiagnostic, lineCol } from './diagnostics.ts';
export type { Diagnostic, Fix, Span } from './diagnostics.ts';
export type { Journey, Leg, Transfer } from './lower.ts';
export { network, routeProgram, type Line, type Station } from './network.ts';
export { renderIR, renderJourneyText } from './render-text.ts';
export { astToJSON, resultToJSON } from './serialize.ts';
