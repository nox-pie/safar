import type { Journey, Leg, Station } from '../compiler/index.ts';
import { esc, lineChip } from './html.ts';

/** Intermediate stops beyond this are collapsed behind a "show more" toggle. */
const COLLAPSE_AFTER = 6;

const mins = (m: number) => Math.round(m);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function otherLines(st: Station, leg: Leg): string {
  const others = st.lines.filter((l) => l !== leg.line);
  return others.length ? `<span class="stop-lines">${others.map((l) => `<i class="dot" style="--c:${l.color}" title="${esc(l.name)}"></i>`).join('')}</span>` : '';
}

function renderLeg(leg: Leg, isFirst: boolean, isLast: boolean): string {
  const middle = leg.stations.slice(1, -1);
  const collapse = middle.length > COLLAPSE_AFTER;
  const stop = (st: Station, cls: string, tag = '') =>
    `<li class="stop ${cls}"><span class="stop-name">${esc(st.name)}</span>${otherLines(st, leg)}${tag ? `<span class="tag">${tag}</span>` : ''}</li>`;

  const items = [stop(leg.from, 'end', isFirst ? 'Board' : '')];
  middle.forEach((st, i) => {
    const hidden = collapse && i >= 2 && i < middle.length - 2;
    items.push(stop(st, hidden ? 'mid hideable' : 'mid'));
    if (collapse && i === 1) {
      items.push(`<li class="stop more"><button type="button" class="link" data-toggle-leg>Show ${middle.length - 4} more stations</button></li>`);
    }
  });
  items.push(stop(leg.to, 'end', isLast ? 'Exit' : ''));

  return `
    <li class="leg" style="--c:${leg.line.color}">
      <div class="leg-head">
        ${lineChip(leg.line)}
        <span class="towards">towards ${esc(leg.towards.join(' / '))}</span>
        <span class="leg-meta">${plural(leg.hops, 'stop')} · ~${mins(leg.minutes)} min</span>
      </div>
      <ol class="stops">${items.join('')}</ol>
    </li>`;
}

export function renderCard(j: Journey): string {
  if (j.legs.length === 0) {
    return `<article class="card"><div class="card-empty">You boarded and exited at ${esc(j.origin.name)} without riding anywhere.</div></article>`;
  }
  const steps = j.steps.map((s) => {
    if (s.type === 'leg') return renderLeg(s.leg, s.leg === j.legs[0], s.leg === j.legs.at(-1));
    const t = s.transfer;
    const label = t.kind === 'interchange'
      ? `Change to ${lineChip(t.to)} at <strong>${esc(t.at.name)}</strong>`
      : `Change train at <strong>${esc(t.at.name)}</strong> (other ${esc(t.to.name)} branch or direction)`;
    return `<li class="transfer"><span class="transfer-icon" aria-hidden="true">${t.kind === 'interchange' ? '⇄' : '↻'}</span><span>${label}</span><span class="leg-meta">+${t.minutes} min</span></li>`;
  });
  const lines = [...new Set(j.legs.map((l) => l.line))];

  return `
    <article class="card">
      <header class="card-head">
        <div>
          <div class="eyebrow">Journey card</div>
          <h3 class="card-title">${esc(j.origin.name)} <span class="arrow">→</span> ${esc(j.destination.name)}</h3>
          <div class="card-lines">${lines.map((l) => lineChip(l)).join('')}</div>
        </div>
        <div class="card-time" aria-label="Estimated time ${mins(j.minutes.total)} minutes">
          <span class="num">${mins(j.minutes.total)}</span><span class="unit">min</span>
          <span class="est">estimated</span>
        </div>
      </header>
      <dl class="stats">
        <div><dt>Stations</dt><dd>${j.stationCount}</dd></div>
        <div><dt>Stops travelled</dt><dd>${j.hops}</dd></div>
        <div><dt>Interchanges</dt><dd>${j.interchanges.length}</dd></div>
      </dl>
      <ol class="route">${steps.join('')}</ol>
      <footer class="card-foot">
        <span>${mins(j.minutes.wait)} min wait + ${mins(j.minutes.riding)} min riding + ${mins(j.minutes.transfers)} min changing</span>
        <button type="button" class="btn small" data-copy-card>Copy as text</button>
      </footer>
    </article>`;
}
