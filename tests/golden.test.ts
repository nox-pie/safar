// Golden tests: every example's full compiler output is snapshotted, so any change to
// diagnostics, the card or the IR shows up as a reviewable diff in tests/__snapshots__.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic, renderIR, renderJourneyText, resultToJSON } from '../src/compiler/index.ts';

const dir = new URL('../examples/', import.meta.url);
const examples = readdirSync(dir).filter((f) => f.endsWith('.safar')).sort();

describe.each(examples)('%s', (file) => {
  const source = readFileSync(new URL(file, dir), 'utf8');
  const r = compile(source);

  it('diagnostics', () => {
    expect(r.diagnostics.map((d) => formatDiagnostic(source, d, { file })).join('\n\n')).toMatchSnapshot();
  });

  it('journey card and IR', () => {
    expect(r.journey ? `${renderJourneyText(r.journey)}\n\n${renderIR(r.journey)}` : '(no journey)').toMatchSnapshot();
  });

  it('JSON', () => {
    const { timings: _ignored, ...stable } = resultToJSON(r);
    expect(stable).toMatchSnapshot();
  });
});
