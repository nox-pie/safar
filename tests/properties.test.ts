// Property-based tests: invariants checked over thousands of generated inputs.
import { describe, expect, it } from 'vitest';
import { applyFix, compile, network, routeProgram, type Line } from '../src/compiler/index.ts';
import { MinHeap } from '../src/compiler/min-heap.ts';

/** Small seeded PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const VOCAB = [
  'board', 'ride', 'change', 'exit', 'to', 'TO', 'Board', ';', ';', '\n', '\n', '# note', '',
  'Rajiv Chowk', 'Hauz Khas', 'Botanical Garden', 'Kashmere Gate', 'Mandi House', 'Patel Chowk',
  'Vaishali', 'Yamuna Bank', 'Noida City Centre', 'IGI Airport', 'New Delhi', 'R.K. Puram',
  'Yellow', 'Blue', 'Magenta', 'Violet', 'Airport Express', 'yellow line', 'Orange',
  'Rajiv Chok', 'Yelow', 'Hauz', 'go', 'switch', '???', '(', 'ride to', 'to to', '\t', '  ',
];

/** Token soup: exercises the lexer, parser and error recovery. */
function soupProgram(rand: () => number): string {
  const n = 1 + Math.floor(rand() * 16);
  return Array.from({ length: n }, () => pick(rand, VOCAB)).join(rand() < 0.5 ? ' ' : '');
}

/**
 * Grammar-aware generator: simulates a traveller who mostly makes legal moves, sometimes
 * illegal ones, then mutates the text. Soup alone never reaches the deep semantic checks.
 */
function journeyProgram(rand: () => number): string {
  let station = pick(rand, network.stations);
  let line: Line | null = null;
  const out = [`board ${station.name}`];
  for (let steps = Math.floor(rand() * 6); steps > 0; steps--) {
    const legal = rand() < 0.7;
    if (line ? rand() < 0.6 : rand() < 0.9) {
      const l: Line = legal ? (line ?? pick(rand, station.lines)) : pick(rand, network.lines);
      const dest = legal ? pick(rand, l.stations) : pick(rand, network.stations);
      out.push(line === l && rand() < 0.7 ? `ride to ${dest.name}` : rand() < 0.1 ? `ride to ${dest.name}` : `ride ${l.name} to ${dest.name}`);
      [station, line] = [dest, l];
    } else {
      const others = station.lines.filter((x) => x !== line);
      const l = legal && others.length ? pick(rand, others) : pick(rand, network.lines);
      out.push(`change ${l.name}`);
      line = l;
    }
  }
  if (rand() < 0.93) out.push('exit');
  if (rand() < 0.04) out.push(`ride to ${pick(rand, network.stations).name}`);
  if (rand() < 0.04) out.splice(1, 0, `board ${pick(rand, network.stations).name}`);
  let src = out.join(pick(rand, ['; ', ';\n', '\n', ' ; ']));
  for (let m = rand() < 0.3 ? 1 + Math.floor(rand() * 2) : 0; m > 0; m--) src = mutate(rand, src);
  return src;
}

function mutate(rand: () => number, src: string): string {
  const at = Math.floor(rand() * src.length);
  switch (Math.floor(rand() * 4)) {
    case 0: return src.slice(0, at) + src.slice(at + 1); // drop a character (typos, lost ';')
    case 1: return `${src.slice(0, at)} ${pick(rand, VOCAB)} ${src.slice(at)}`; // insert junk
    case 2: return src.replace(';', ''); // run two statements together
    default: return src.slice(0, at); // truncate
  }
}

const SOURCES = import.meta.glob('../src/compiler/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const DECLARED_CODES = new Set(Object.values(SOURCES).flatMap((src) => [...src.matchAll(/'([EWI]\d{3})'/g)].map((m) => m[1])));

describe('compiler robustness (fuzzing)', () => {
  const rand = rng(42);
  const programs = [
    ...Array.from({ length: 2000 }, () => soupProgram(rand)),
    ...Array.from({ length: 4000 }, () => journeyProgram(rand)),
  ];

  it('reaches every diagnostic the compiler can emit', () => {
    const seen = new Set(programs.flatMap((src) => compile(src).diagnostics.map((d) => d.code)));
    expect([...DECLARED_CODES].filter((c) => !seen.has(c))).toEqual([]);
    expect(programs.filter((src) => compile(src).journey).length).toBeGreaterThan(500);
  });

  it('never throws, and reports spans inside the source', () => {
    for (const src of programs) {
      const r = compile(src);
      for (const d of r.diagnostics) {
        expect(d.span.start, src).toBeGreaterThanOrEqual(0);
        expect(d.span.end, src).toBeLessThanOrEqual(src.length);
        expect(d.span.start, src).toBeLessThanOrEqual(d.span.end);
      }
    }
  });

  it('produces a journey exactly when there are no errors', () => {
    for (const src of programs) {
      const r = compile(src);
      const hasErrors = r.diagnostics.some((d) => d.severity === 'error');
      expect(r.journey === null, src).toBe(hasErrors);
    }
  });

  it('every fix-it resolves the error it was offered for', () => {
    let checked = 0;
    for (const src of programs) {
      for (const d of compile(src).diagnostics) {
        if (!d.fix || d.severity !== 'error') continue;
        const fixed = compile(applyFix(src, d.fix));
        // Text before the fix is unchanged; text after it moves by the edit's length.
        const shift = d.fix.text.length - (d.fix.span.end - d.fix.span.start);
        const unresolved = fixed.diagnostics.some((x) => x.code === d.code && (x.span.start === d.span.start || x.span.start === d.span.start + shift));
        expect(unresolved, `${d.code} on ${JSON.stringify(src)}`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('planner ⇄ checker agreement', () => {
  const rand = rng(7);
  const pairs = Array.from({ length: 1500 }, () => [pick(rand, network.stations), pick(rand, network.stations)] as const)
    .filter(([a, b]) => a !== b);

  it('every planned route compiles cleanly, with the same time, and is not beaten', () => {
    for (const [from, to] of pairs) {
      const route = network.plan(from, to);
      expect(route, `${from.name} → ${to.name}`).not.toBeNull();
      const r = compile(routeProgram(from, route!));
      expect(r.diagnostics, `${from.name} → ${to.name}`).toEqual([]);
      expect(r.journey!.destination).toBe(to);
      expect(r.journey!.minutes.total).toBeCloseTo(route!.minutes, 9);
    }
  });

  it('plans are symmetric in duration', () => {
    for (const [from, to] of pairs.slice(0, 300)) {
      expect(network.plan(from, to)!.minutes).toBeCloseTo(network.plan(to, from)!.minutes, 9);
    }
  });
});

describe('MinHeap', () => {
  it('pops in non-decreasing priority order', () => {
    const rand = rng(1);
    const heap = new MinHeap<number>();
    const values = Array.from({ length: 1000 }, () => Math.floor(rand() * 100));
    values.forEach((v) => heap.push(v, v));
    const popped = Array.from({ length: values.length }, () => heap.pop()!.priority);
    expect(popped).toEqual([...values].sort((a, b) => a - b));
    expect(heap.pop()).toBeUndefined();
  });
});
