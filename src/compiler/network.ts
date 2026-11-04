import { MinHeap } from './min-heap.ts';
import { LINES, STATION_ALIASES, type RawLine } from './network-data.ts';

// Time model (minutes). Per-hop times live on each line.
export const INITIAL_WAIT_MIN = 3;
export const INTERCHANGE_MIN = 5;
export const TRAIN_CHANGE_MIN = 4;

export interface Station {
  name: string;
  key: string;
  lines: Line[];
}

export interface Service {
  id: string;
  line: Line;
  stations: Station[];
  index: Map<Station, number>;
  /** Planner node id of stations[0]; stations[i] is node base + i. */
  base: number;
}

export interface Line {
  id: string;
  name: string;
  color: string;
  minutesPerHop: number;
  services: Service[];
  stations: Station[];
}

export interface RouteRide {
  line: Line;
  from: Station;
  to: Station;
}

export interface Route {
  rides: RouteRide[];
  minutes: number;
}

/** Case, spacing and punctuation insensitive key: "R.K. Puram" → "rkpuram". */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Edit distance. With `max`, gives up early and returns `max + 1` once the answer is
 * known to exceed it, so scanning every station name for a typo stays cheap.
 */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (rowA.length <= b.length) [rowA, rowB] = [new Int32Array(b.length * 2 + 1), new Int32Array(b.length * 2 + 1)];
  let prev = rowA;
  let cur = rowB;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
// Reused DP rows: suggestions scan every station name, so avoid allocating per call.
let rowA = new Int32Array(64);
let rowB = new Int32Array(64);

interface NameEntry {
  key: string;
  name: string;
}

function suggest(query: string, entries: NameEntry[], limit: number): string[] {
  const q = normalize(query);
  if (!q) return [];
  const threshold = Math.max(2, Math.floor(q.length / 3));
  const scored: { name: string; score: number }[] = [];
  for (const e of entries) {
    const score = q.length >= 3 && e.key.startsWith(q) ? 1 : levenshtein(q, e.key, threshold);
    if (score <= threshold) scored.push({ name: e.name, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return [...new Set(scored.map((s) => s.name))].slice(0, limit);
}

export class Network {
  readonly stations: Station[] = [];
  readonly lines: Line[] = [];
  private stationByKey = new Map<string, Station>();
  private lineByKey = new Map<string, Line>();
  private stationNames: NameEntry[] = [];
  private lineNames: NameEntry[] = [];
  // Planner graph: one node per (service, station), as dense integer ids.
  private nodeService: Service[] = [];
  private stationNodes = new Map<Station, number[]>();

  constructor(raw: RawLine[], aliases: Record<string, string>) {
    for (const r of raw) {
      const line: Line = { id: r.id, name: r.name, color: r.color, minutesPerHop: r.minutesPerHop, services: [], stations: [] };
      this.lines.push(line);
      for (const k of [r.id, r.name, ...r.aliases]) this.lineByKey.set(normalize(k), line);
      this.lineNames.push({ key: normalize(r.name), name: r.name }, ...r.aliases.map((a) => ({ key: normalize(a), name: r.name })));

      r.services.forEach((names, i) => {
        const stations = names.map((n) => this.intern(n));
        const base = this.nodeService.length;
        const service: Service = { id: `${r.id}-${i}`, line, stations, index: new Map(stations.map((s, j) => [s, j])), base };
        if (service.index.size !== stations.length) throw new Error(`${service.id} lists a station twice`);
        line.services.push(service);
        stations.forEach((st, j) => {
          this.nodeService.push(service);
          const nodes = this.stationNodes.get(st) ?? [];
          nodes.push(base + j);
          this.stationNodes.set(st, nodes);
        });
        for (const st of stations) {
          if (!st.lines.includes(line)) {
            st.lines.push(line);
            line.stations.push(st);
          }
        }
      });
    }
    for (const [alias, target] of Object.entries(aliases)) {
      const st = this.stationByKey.get(normalize(target));
      if (!st) throw new Error(`Alias ${alias} points at unknown station ${target}`);
      this.stationByKey.set(normalize(alias), st);
      this.stationNames.push({ key: normalize(alias), name: st.name });
    }
  }

  private intern(name: string): Station {
    const key = normalize(name);
    const existing = this.stationByKey.get(key);
    if (existing) {
      if (existing.name !== name) throw new Error(`"${name}" collides with "${existing.name}"`);
      return existing;
    }
    const st: Station = { name, key, lines: [] };
    this.stationByKey.set(key, st);
    this.stations.push(st);
    this.stationNames.push({ key, name });
    return st;
  }

  station(text: string): Station | undefined {
    return this.stationByKey.get(normalize(text));
  }

  /** Accepts "Yellow", "yellow line", "Orange" (alias), etc. */
  line(text: string): Line | undefined {
    const key = normalize(text);
    return this.lineByKey.get(key) ?? (key.endsWith('line') ? this.lineByKey.get(key.slice(0, -4)) : undefined);
  }

  suggestStations(text: string, limit = 3): string[] {
    return suggest(text, this.stationNames, limit);
  }

  suggestLines(text: string, limit = 3): string[] {
    return suggest(text.replace(/\s*line\s*$/i, ''), this.lineNames, limit);
  }

  isInterchange(st: Station): boolean {
    return st.lines.length >= 2;
  }

  /** Services of `line` on which a single train runs from `a` to `b`. */
  servicesBetween(line: Line, a: Station, b: Station): Service[] {
    return line.services.filter((s) => s.index.has(a) && s.index.has(b));
  }

  path(service: Service, a: Station, b: Station): Station[] {
    const i = service.index.get(a)!;
    const j = service.index.get(b)!;
    return i <= j ? service.stations.slice(i, j + 1) : service.stations.slice(j, i + 1).reverse();
  }

  /** Terminus names shown on the train ("towards …"), one per service. */
  towards(services: Service[], a: Station, b: Station): string[] {
    const ends = services.map((s) => (s.index.get(a)! < s.index.get(b)! ? s.stations.at(-1)! : s.stations[0]).name);
    return [...new Set(ends)];
  }

  /** Closest station on `line`, reachable without changing train, where `target` also stops. */
  nearestChangePoint(line: Line, from: Station, target: Line): { station: Station; hops: number } | null {
    let best: { station: Station; hops: number } | null = null;
    for (const s of line.services) {
      const i = s.index.get(from);
      if (i === undefined) continue;
      for (const [j, st] of s.stations.entries()) {
        const hops = Math.abs(i - j);
        if (hops > 0 && st.lines.includes(target) && (!best || hops < best.hops)) best = { station: st, hops };
      }
    }
    return best;
  }

  /**
   * Fastest route using the same time model as the journey card. Dijkstra over
   * (service, station) nodes: riding to a neighbour costs the line's per-hop time,
   * switching service at a station costs an interchange or a same-line train change.
   */
  plan(from: Station, to: Station): Route | null {
    if (from === to) return null;
    const n = this.nodeService.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const queue = new MinHeap<number>();
    const relax = (node: number, d: number, from: number) => {
      if (d < dist[node]) {
        dist[node] = d;
        prev[node] = from;
        queue.push(d, node); // stale entries are skipped on pop (lazy deletion)
      }
    };
    for (const node of this.stationNodes.get(from)!) relax(node, 0, -1);

    while (queue.size > 0) {
      const { priority: d, value: node } = queue.pop()!;
      if (done[node]) continue;
      done[node] = 1;
      const [s, st] = this.nodeAt(node);
      if (st === to) return this.buildRoute(node, prev, d);

      const i = node - s.base;
      if (i > 0) relax(node - 1, d + s.line.minutesPerHop, node);
      if (i < s.stations.length - 1) relax(node + 1, d + s.line.minutesPerHop, node);
      for (const other of this.stationNodes.get(st)!) {
        if (other !== node) relax(other, d + (this.nodeService[other].line === s.line ? TRAIN_CHANGE_MIN : INTERCHANGE_MIN), node);
      }
    }
    return null;
  }

  private nodeAt(node: number): [Service, Station] {
    const s = this.nodeService[node];
    return [s, s.stations[node - s.base]];
  }

  private buildRoute(goal: number, prev: Int32Array, d: number): Route {
    const chain: [Service, Station][] = [];
    for (let k = goal; k !== -1; k = prev[k]) chain.unshift(this.nodeAt(k));
    const rides: RouteRide[] = [];
    let [segService, segFrom] = chain[0];
    for (let i = 1; i <= chain.length; i++) {
      const [s, st] = chain[i] ?? [null, null];
      if (s !== segService) {
        const last = chain[i - 1][1];
        if (last !== segFrom) rides.push({ line: segService.line, from: segFrom, to: last });
        if (s && st) [segService, segFrom] = [s, st];
      }
    }
    return { rides, minutes: INITIAL_WAIT_MIN + d };
  }
}

/** Statements that carry out `route`, given the line the traveller is currently on (if any). */
export function routeStatements(route: Route, currentLine: Line | null): string[] {
  const out: string[] = [];
  let line = currentLine;
  for (const r of route.rides) {
    if (line === null) out.push(`ride ${r.line.name} to ${r.to.name}`);
    else if (r.line !== line) out.push(`change ${r.line.name}`, `ride to ${r.to.name}`);
    else out.push(`ride to ${r.to.name}`);
    line = r.line;
  }
  return out;
}

export function routeProgram(from: Station, route: Route): string {
  return [`board ${from.name}`, ...routeStatements(route, null), 'exit'].join(';\n') + '\n';
}

export const network = new Network(LINES, STATION_ALIASES);
