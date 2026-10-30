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

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

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
    let score = levenshtein(q, e.key);
    if (q.length >= 3 && e.key.startsWith(q)) score = Math.min(score, 1);
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

  constructor(raw: RawLine[], aliases: Record<string, string>) {
    for (const r of raw) {
      const line: Line = { id: r.id, name: r.name, color: r.color, minutesPerHop: r.minutesPerHop, services: [], stations: [] };
      this.lines.push(line);
      for (const k of [r.id, r.name, ...r.aliases]) this.lineByKey.set(normalize(k), line);
      this.lineNames.push({ key: normalize(r.name), name: r.name }, ...r.aliases.map((a) => ({ key: normalize(a), name: r.name })));

      r.services.forEach((names, i) => {
        const stations = names.map((n) => this.intern(n));
        const service: Service = { id: `${r.id}-${i}`, line, stations, index: new Map(stations.map((s, j) => [s, j])) };
        if (service.index.size !== stations.length) throw new Error(`${service.id} lists a station twice`);
        line.services.push(service);
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

  /** Fastest route (Dijkstra over (service, station) states) using the same time model as the card. */
  plan(from: Station, to: Station): Route | null {
    if (from === to) return null;
    const keyOf = (s: Service, st: Station) => `${s.id}|${st.key}`;
    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const nodes = new Map<string, [Service, Station]>();
    const done = new Set<string>();
    const relax = (s: Service, st: Station, d: number, p: string | null) => {
      const k = keyOf(s, st);
      if (d < (dist.get(k) ?? Infinity)) {
        dist.set(k, d);
        prev.set(k, p);
        nodes.set(k, [s, st]);
      }
    };
    for (const line of from.lines) for (const s of line.services) if (s.index.has(from)) relax(s, from, 0, null);

    for (;;) {
      let cur: string | null = null;
      let curD = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && d < curD) [cur, curD] = [k, d];
      if (cur === null) return null;
      done.add(cur);
      const [s, st] = nodes.get(cur)!;
      if (st === to) return this.buildRoute(cur, prev, nodes, curD);

      const i = s.index.get(st)!;
      for (const j of [i - 1, i + 1]) {
        if (j >= 0 && j < s.stations.length) relax(s, s.stations[j], curD + s.line.minutesPerHop, cur);
      }
      for (const line of st.lines) {
        for (const s2 of line.services) {
          if (s2 !== s && s2.index.has(st)) relax(s2, st, curD + (line === s.line ? TRAIN_CHANGE_MIN : INTERCHANGE_MIN), cur);
        }
      }
    }
  }

  private buildRoute(goal: string, prev: Map<string, string | null>, nodes: Map<string, [Service, Station]>, d: number): Route {
    const chain: [Service, Station][] = [];
    for (let k: string | null = goal; k !== null; k = prev.get(k) ?? null) chain.unshift(nodes.get(k)!);
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
