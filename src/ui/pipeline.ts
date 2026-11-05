import { check } from '../compiler/checker.ts';
import type { CompileResult, Phase } from '../compiler/index.ts';
import { lex } from '../compiler/lexer.ts';
import { lower } from '../compiler/lower.ts';
import { network } from '../compiler/network.ts';
import { parse } from '../compiler/parser.ts';

interface Stage {
  phase: Phase | null;
  name: string;
  stat: string;
  state: 'ok' | 'error' | 'skipped';
  tab: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function stages(r: CompileResult): Stage[] {
  const syntax = r.diagnostics.filter((d) => d.severity === 'error' && d.code.startsWith('E1')).length;
  const semantic = r.diagnostics.filter((d) => d.severity === 'error' && d.code.startsWith('E2')).length;
  const j = r.journey;
  return [
    { phase: 'lex', name: 'Lexer', stat: plural(r.tokens.length - 1, 'token'), state: 'ok', tab: 'view-tokens' },
    { phase: 'parse', name: 'Parser', stat: syntax ? plural(syntax, 'syntax error') : plural(r.program.statements.length, 'statement'), state: syntax ? 'error' : 'ok', tab: 'view-ast' },
    { phase: 'check', name: 'Checker', stat: semantic ? plural(semantic, 'error') : 'journey allowed', state: semantic ? 'error' : syntax ? 'skipped' : 'ok', tab: 'problems' },
    { phase: 'lower', name: 'Lowering', stat: j ? plural(j.legs.length, 'leg') : 'needs a valid program', state: j ? 'ok' : 'skipped', tab: 'view-ir' },
    { phase: null, name: 'Card', stat: j ? `~${Math.round(j.minutes.total)} min` : '—', state: j ? 'ok' : 'skipped', tab: 'view-journey' },
  ];
}

export function renderPipeline(r: CompileResult, timings?: Record<Phase, number>): string {
  return stages(r).map((s) => {
    const t = s.phase && timings ? formatTime(timings[s.phase]) : s.phase ? '…' : '';
    return `<li class="stage is-${s.state}">
      <button type="button" data-stage-tab="${s.tab}" title="Show ${s.name.toLowerCase()} output">
        <span class="stage-name">${s.name}</span>
        <span class="stage-stat">${s.stat}</span>
        ${s.phase ? `<span class="stage-time">${t}</span>` : ''}
      </button>
    </li>`;
  }).join('');
}

export function formatTime(ms: number): string {
  if (ms === 0) return '—';
  return ms < 1 ? `${Math.max(1, Math.round(ms * 1000))} µs` : `${ms.toFixed(1)} ms`;
}

/**
 * Per-phase cost in ms. Browsers coarsen performance.now(), so each phase runs in a loop
 * for about a millisecond and the average is reported.
 */
export function profile(source: string, r: CompileResult): Record<Phase, number> {
  const per = (fn: () => unknown) => {
    for (let i = 0; i < 20; i++) fn(); // warm up, so the first reading isn't a cold-JIT outlier
    let n = 0;
    let elapsed = 0;
    const t0 = performance.now();
    do {
      fn();
      n++;
      elapsed = performance.now() - t0;
    } while (elapsed < 1 && n < 500);
    return elapsed / n;
  };
  const { origin, destination, rides } = r.check;
  return {
    lex: per(() => lex(source)),
    parse: per(() => parse(r.tokens)),
    check: per(() => check(r.program, network)),
    lower: r.journey && origin && destination
      ? per(() => {
          lower(origin, destination, rides, network);
          network.plan(origin, destination); // the faster-route analysis runs in this phase
        })
      : 0,
  };
}
