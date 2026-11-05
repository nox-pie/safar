import { describe, expect, it } from 'vitest';
import { applyFix, compile, formatDiagnostic, network } from '../src/compiler/index.ts';
import { lex } from '../src/compiler/lexer.ts';

const codes = (src: string) => compile(src).diagnostics.map((d) => d.code);
const errors = (src: string) => compile(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

const EXAMPLE = 'board Rajiv Chowk; ride Yellow to Hauz Khas; change Magenta; ride to Botanical Garden; exit';

describe('network data', () => {
  it('derives interchanges from shared stations', () => {
    for (const name of ['Kashmere Gate', 'Mandi House', 'Rajiv Chowk', 'Hauz Khas', 'Botanical Garden', 'Kalkaji Mandir']) {
      expect(network.isInterchange(network.station(name)!), name).toBe(true);
    }
    expect(network.station('Kashmere Gate')!.lines.map((l) => l.id)).toEqual(['red', 'yellow', 'violet']);
    expect(network.isInterchange(network.station('Patel Chowk')!)).toBe(false);
  });

  it('normalises names and resolves aliases', () => {
    expect(network.station('rajiv   chowk')?.name).toBe('Rajiv Chowk');
    expect(network.station('RK Puram')?.name).toBe('R.K. Puram');
    expect(network.station('Connaught Place')?.name).toBe('Rajiv Chowk');
    expect(network.line('yellow line')?.id).toBe('yellow');
    expect(network.line('Orange')?.id).toBe('airport');
  });
});

describe('lexer and parser', () => {
  it('keeps multi-word names and treats newlines as separators', () => {
    const toks = lex('board Rajiv Chowk\nride Yellow to Hauz Khas # comment');
    expect(toks.map((t) => t.type)).toEqual(['keyword', 'word', 'word', 'separator', 'keyword', 'word', 'keyword', 'word', 'word', 'comment', 'eof']);
    const { program } = compile('board Rajiv Chowk\nride Yellow to Hauz Khas\nexit');
    expect(program.statements.map((s) => s.kind)).toEqual(['board', 'ride', 'exit']);
  });

  it('reports a missing separator and keeps parsing', () => {
    const r = compile('board Rajiv Chowk ride Yellow to Hauz Khas; exit');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E102']);
    expect(r.program.statements).toHaveLength(3);
  });

  it('reports syntax errors with fixes', () => {
    expect(errors('board; exit')).toContain('E101');
    expect(errors('board Rajiv Chowk; ride Hauz Khas; exit')).toEqual(['E103']);
    expect(errors('board Rajiv Chowk; ride Yellow to; exit')).toEqual(['E104']);
    expect(errors('board Rajiv Chowk; change; exit')).toEqual(['E105']);
    const unknown = compile('board Rajiv Chowk; go Yellow to Hauz Khas; exit').diagnostics[0];
    expect(unknown.code).toBe('E106');
    expect(unknown.fix?.text).toBe('ride');
  });
});

describe('semantic checks', () => {
  it('accepts the example program', () => {
    const r = compile(EXAMPLE);
    expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    expect(r.journey).not.toBeNull();
  });

  it('requires stations to be on the line you ride', () => {
    const r = compile('board Rajiv Chowk; ride Yellow to Botanical Garden; exit');
    const d = r.diagnostics.find((x) => x.code === 'E208')!;
    expect(d.message).toBe('Botanical Garden is not on the Yellow line');
    // The suggested fix itself compiles cleanly.
    expect(errors(applyFix(r.source, d.fix!))).toEqual([]);
  });

  it('only allows changes at a real interchange that serves the new line', () => {
    const notInterchange = compile('board Rajiv Chowk; ride Yellow to Patel Chowk; change Violet; ride to Lajpat Nagar; exit');
    const d = notInterchange.diagnostics.find((x) => x.code === 'E212')!;
    expect(d.help).toContain('Central Secretariat (1 stop away');
    expect(errors(applyFix(notInterchange.source, d.fix!))).toEqual([]);

    expect(errors('board Rajiv Chowk; ride Yellow to Hauz Khas; change Blue; ride to Noida Sector 18; exit')).toContain('E213');
    expect(errors('board Kashmere Gate; ride Violet to Mandi House; change Blue; ride to Rajiv Chowk; exit')).toEqual([]);
  });

  it('requires an explicit change to switch lines', () => {
    const r = compile('board Rajiv Chowk; ride Yellow to Hauz Khas; ride Magenta to Botanical Garden; exit');
    const d = r.diagnostics.find((x) => x.code === 'E211')!;
    expect(errors(applyFix(r.source, d.fix!))).toEqual([]);
  });

  it('needs a line on the first ride unless the station has only one', () => {
    expect(errors('board Rajiv Chowk; ride to Hauz Khas; exit')).toEqual(['E210']);
    expect(errors('board Patel Chowk; ride to Hauz Khas; exit')).toEqual([]);
  });

  it('checks program structure', () => {
    expect(errors('')).toEqual(['E201']);
    expect(errors('ride Yellow to Hauz Khas; exit')).toEqual(['E202']);
    expect(errors('board Rajiv Chowk; board Hauz Khas; exit')).toEqual(['E203']);
    expect(errors('board Rajiv Chowk; ride Yellow to Hauz Khas')).toEqual(['E204']);
    expect(errors('board Rajiv Chowk; ride Yellow to Hauz Khas; exit; ride to Saket')).toEqual(['E205']);
    expect(errors('board Rajiv Chowk; ride Yellow to Rajiv Chowk; exit')).toEqual(['E209']);
    expect(errors('board Rajiv Chowk; change Blue; exit')).toEqual(['E215']);
    expect(errors('board Rajiv Chowk; ride Yellow to Hauz Khas; change Yellow; exit')).toEqual(['E214']);
  });

  it('suggests corrections for typos without cascading', () => {
    const r = compile('board Rajiv Chok; ride Yelow to Hauz Kas; change Magneta; ride to Botanical Gardens; exit');
    expect(r.diagnostics.map((d) => [d.code, d.fix?.text])).toEqual([
      ['E206', 'Rajiv Chowk'],
      ['E207', 'Yellow'],
      ['E206', 'Hauz Khas'],
      ['E207', 'Magenta'],
      ['E206', 'Botanical Garden'],
    ]);
  });

  it('handles branch lines', () => {
    const r = compile('board Vaishali; ride Blue to Noida City Centre; exit');
    const d = r.diagnostics.find((x) => x.code === 'E216')!;
    expect(d.fix?.text).toBe('ride Blue to Yamuna Bank; ride to Noida City Centre');
    const fixed = compile(applyFix(r.source, d.fix!));
    expect(fixed.journey?.steps.map((s) => s.type)).toEqual(['leg', 'transfer', 'leg']);
    expect(errors('board Vaishali; ride Blue to Rajiv Chowk; exit')).toEqual([]);
  });

  it('warns about doubling back and pointless changes', () => {
    expect(codes('board Rajiv Chowk; ride Yellow to Hauz Khas; ride to Green Park; exit')).toContain('W301');
    expect(codes('board Rajiv Chowk; ride Yellow to Hauz Khas; change Magenta; exit')).toContain('W302');
    expect(codes('board Rajiv Chowk; exit')).toContain('W303');
  });
});

describe('journey card', () => {
  it('computes stations, interchanges and time for the example', () => {
    const j = compile(EXAMPLE).journey!;
    expect(j.legs.map((l) => [l.line.id, l.hops])).toEqual([['yellow', 9], ['magenta', 13]]);
    expect(j.interchanges.map((s) => s.name)).toEqual(['Hauz Khas']);
    expect(j.stationCount).toBe(23);
    expect(j.legs[0].towards).toEqual(['Millennium City Centre Gurugram']);
    expect(Math.round(j.minutes.total)).toBe(56);
  });

  it('points out a faster route as info, with a fix that compiles', () => {
    const r = compile(EXAMPLE);
    const info = r.diagnostics.find((d) => d.code === 'I401')!;
    expect(info.severity).toBe('info');
    expect(info.fix!.text).toBe('board Rajiv Chowk;\nride Blue to Botanical Garden;\nexit\n');
    const faster = compile(applyFix(r.source, info.fix!));
    expect(faster.diagnostics).toEqual([]);
    expect(Math.round(faster.journey!.minutes.total)).toBe(32);
  });

  it('formats diagnostics with a caret', () => {
    const src = 'board Rajiv Chowk; ride Yellow to Botanical Garden; exit';
    const d = compile(src).diagnostics[0];
    expect(formatDiagnostic(src, d)).toContain('1 | board Rajiv Chowk; ride Yellow to Botanical Garden; exit\n  |                                   ^^^^^^^^^^^^^^^^');
  });
});

// Found by the fuzzer (tests/properties.test.ts).
describe('error recovery regressions', () => {
  it('does not cascade after a destination that is not on the line', () => {
    const src = 'board Rajiv Chowk; ride Yellow to Botanical Garden; ride to Noida Sector 18; exit';
    expect(errors(src)).toEqual(['E208']);
  });

  it('still checks the boarding line when the destination has a typo', () => {
    expect(errors('board Tis Hazari; ride Magenta to Inderok; exit')).toEqual(['E208', 'E206']);
  });
});
