// Data integrity: the network is hand-entered, so guard it like code.
import { describe, expect, it } from 'vitest';
import { network } from '../src/compiler/index.ts';
import { LINES, STATION_ALIASES } from '../src/compiler/network-data.ts';

describe('network data', () => {
  it('has well-formed lines and services', () => {
    expect(network.lines.map((l) => l.id)).toEqual(['red', 'yellow', 'blue', 'green', 'violet', 'pink', 'magenta', 'airport', 'grey']);
    for (const line of network.lines) {
      expect(line.color).toMatch(/^#[0-9A-F]{6}$/i);
      for (const s of line.services) expect(s.stations.length, s.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('connects every branch to its line', () => {
    for (const line of network.lines) {
      const [main, ...branches] = line.services;
      for (const b of branches) expect(b.stations.some((st) => main.index.has(st)), b.id).toBe(true);
    }
  });

  it('is one connected network', () => {
    const hub = network.station('Rajiv Chowk')!;
    for (const st of network.stations) {
      if (st !== hub) expect(network.plan(hub, st), st.name).not.toBeNull();
    }
  });

  it('resolves every alias to a real station', () => {
    for (const [alias, target] of Object.entries(STATION_ALIASES)) {
      expect(network.station(alias)?.name, alias).toBe(target);
    }
  });

  it('derives the interchanges from shared stations', () => {
    const interchanges = network.stations.filter((s) => network.isInterchange(s)).map((s) => s.name).sort();
    expect(interchanges).toEqual([
      'Anand Vihar ISBT', 'Azadpur', 'Botanical Garden', 'Central Secretariat', 'Dilli Haat INA', 'Dwarka',
      'Dwarka Sector 21', 'Hauz Khas', 'Inderlok', 'Janakpuri West', 'Kalkaji Mandir', 'Karkarduma',
      'Kashmere Gate', 'Kirti Nagar', 'Lajpat Nagar', 'Mandi House', 'Mayur Vihar Phase-1', 'Netaji Subhash Place',
      'New Delhi', 'Rajiv Chowk', 'Rajouri Garden', 'Welcome',
    ]);
  });

  it('keeps raw data and the built network in sync', () => {
    const raw = new Set(LINES.flatMap((l) => l.services.flat()));
    expect(network.stations.length).toBe(raw.size);
  });
});
