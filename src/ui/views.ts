import type { CompileResult } from '../compiler/index.ts';
import { astToJSON, lineCol, network } from '../compiler/index.ts';
import { esc, lineChip } from './html.ts';

const pos = (source: string, offset: number) => {
  const { line, col } = lineCol(source, offset);
  return `${line}:${col}`;
};

export function renderTokens(r: CompileResult): string {
  const rows = r.tokens.map((t, i) => {
    const text = t.type === 'separator' && t.value === '\n' ? '⏎' : t.type === 'eof' ? '' : t.value;
    return `<tr><td class="num">${i}</td><td><span class="tt tt-${t.type}">${t.type}</span></td><td class="mono">${esc(text)}</td><td class="mono muted">${pos(r.source, t.span.start)}</td></tr>`;
  });
  return `<table class="table"><thead><tr><th>#</th><th>Type</th><th>Value</th><th>At</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function renderAst(r: CompileResult): string {
  return `<pre class="code-view">${esc(astToJSON(r.program, r.source))}</pre>`;
}

export function renderNetwork(): string {
  return network.lines.map((line) => {
    const services = line.services.map((s) => `${s.stations[0].name} ⇄ ${s.stations.at(-1)!.name}`);
    const stations = line.stations.map((st) => {
      const others = st.lines.filter((l) => l !== line);
      const dots = others.map((l) => `<i class="dot" style="--c:${l.color}" title="${esc(l.name)}"></i>`).join('');
      return `<li><button type="button" class="station-btn${others.length ? ' is-interchange' : ''}" data-insert="${esc(st.name)}" title="Insert into program">${esc(st.name)}${dots}</button></li>`;
    });
    return `
      <details class="net-line" style="--c:${line.color}">
        <summary>${lineChip(line)}<span class="net-services">${services.map(esc).join('<br>')}</span><span class="muted">${line.stations.length} stations</span></summary>
        <ol class="net-stations">${stations.join('')}</ol>
      </details>`;
  }).join('');
}
