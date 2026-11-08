import type { Program } from './ast.ts';
import { lineCol } from './diagnostics.ts';
import type { CompileResult } from './index.ts';

const pos = (source: string, offset: number) => {
  const { line, col } = lineCol(source, offset);
  return `${line}:${col}`;
};

/** The AST as JSON, with spans shown as "line:col–line:col". */
export function astToJSON(program: Program, source: string): string {
  return JSON.stringify(program, (key, value) =>
    (key === 'span' || key === 'keyword') && value && typeof value.start === 'number'
      ? `${pos(source, value.start)}–${pos(source, value.end)}`
      : value, 2);
}

/**
 * A stable, acyclic view of a compile result for tools (`safarc --emit json`).
 * The in-memory network graph is cyclic (stations ⇄ lines), so names stand in for objects.
 */
export function resultToJSON(r: CompileResult) {
  const j = r.journey;
  return {
    ok: !r.diagnostics.some((d) => d.severity === 'error'),
    diagnostics: r.diagnostics.map((d) => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      ...lineCol(r.source, d.span.start),
      ...(d.help ? { help: d.help } : {}),
      ...(d.fix ? { fix: { label: d.fix.label, start: d.fix.span.start, end: d.fix.span.end, text: d.fix.text } } : {}),
    })),
    journey: j && {
      origin: j.origin.name,
      destination: j.destination.name,
      minutes: Math.round(j.minutes.total),
      // Rounded: the raw sums carry float noise (37.400000000000006).
      breakdown: Object.fromEntries(Object.entries(j.minutes).map(([k, v]) => [k, Math.round(v * 10) / 10])),
      stations: j.stationCount,
      stops: j.hops,
      interchanges: j.interchanges.map((s) => s.name),
      steps: j.steps.map((s) => s.type === 'leg'
        ? { leg: { line: s.leg.line.name, from: s.leg.from.name, to: s.leg.to.name, towards: s.leg.towards, stops: s.leg.hops, stations: s.leg.stations.map((st) => st.name) } }
        : { transfer: { kind: s.transfer.kind, at: s.transfer.at.name, from: s.transfer.from.name, to: s.transfer.to.name, minutes: s.transfer.minutes } }),
    },
    timings: r.timings,
  };
}
