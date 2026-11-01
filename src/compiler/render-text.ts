import type { Journey } from './lower.ts';

const min = (m: number) => `${Math.round(m)} min`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Plain-text journey card, used for "Copy as text". */
export function renderJourneyText(j: Journey): string {
  const rule = '─'.repeat(48);
  const out = ['SAFAR · DELHI METRO JOURNEY CARD', `${j.origin.name} → ${j.destination.name}`, rule];
  for (const step of j.steps) {
    if (step.type === 'transfer') {
      const t = step.transfer;
      out.push(t.kind === 'interchange'
        ? `⇄ Change to ${t.to.name} at ${t.at.name} · +${min(t.minutes)}`
        : `↻ Change train at ${t.at.name} (${t.to.name} line) · +${min(t.minutes)}`);
      continue;
    }
    const l = step.leg;
    const via = l.stations.slice(1, -1).map((s) => s.name);
    out.push(`● ${l.line.name} line · towards ${l.towards.join(' / ')}`);
    out.push(`  ${l.from.name} → ${l.to.name} · ${plural(l.hops, 'stop')} · ~${min(l.minutes)}`);
    if (via.length) out.push(`  via ${via.join(', ')}`);
  }
  out.push(rule);
  out.push(`${plural(j.stationCount, 'station')} · ${plural(j.interchanges.length, 'interchange')} · ~${min(j.minutes.total)}`);
  out.push(`(${min(j.minutes.wait)} wait + ${min(j.minutes.riding)} riding + ${min(j.minutes.transfers)} changing)`);
  return out.join('\n');
}

/** The lowered program as a flat instruction listing: the compiler's "IR" view. */
export function renderIR(j: Journey): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const out = [`${pad('BOARD', 8)}${j.origin.name}`];
  for (const step of j.steps) {
    if (step.type === 'transfer') {
      const t = step.transfer;
      out.push(`${pad(t.kind === 'interchange' ? 'XFER' : 'TRAIN', 8)}${pad(t.at.name, 26)}${t.from.id} → ${t.to.id}   +${t.minutes}`);
    } else {
      const l = step.leg;
      out.push(`${pad('RIDE', 8)}${pad(l.line.id, 9)}${l.from.name} → ${l.to.name}   hops=${l.hops} t=${l.minutes.toFixed(1)}`);
      out.push(`${pad('', 8)}${pad('', 9)}towards ${l.towards.join(' / ')}`);
    }
  }
  out.push(`${pad('EXIT', 8)}${j.destination.name}`);
  const m = j.minutes;
  out.push('', `; time = wait ${m.wait} + riding ${m.riding.toFixed(1)} + changes ${m.transfers} = ${m.total.toFixed(1)} min`);
  return out.join('\n');
}
