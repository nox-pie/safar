import type { ResolvedRide } from './checker.ts';
import { INITIAL_WAIT_MIN, INTERCHANGE_MIN, TRAIN_CHANGE_MIN, type Line, type Network, type Station } from './network.ts';

export interface Leg {
  line: Line;
  from: Station;
  to: Station;
  /** Every station on the leg, both ends included. */
  stations: Station[];
  towards: string[];
  hops: number;
  minutes: number;
}

export interface Transfer {
  /** 'interchange' = different line; 'train' = same line, other branch or direction. */
  kind: 'interchange' | 'train';
  at: Station;
  from: Line;
  to: Line;
  minutes: number;
}

export type JourneyStep = { type: 'leg'; leg: Leg } | { type: 'transfer'; transfer: Transfer };

export interface Journey {
  origin: Station;
  destination: Station;
  steps: JourneyStep[];
  legs: Leg[];
  interchanges: Station[];
  hops: number;
  stationCount: number;
  minutes: { wait: number; riding: number; transfers: number; total: number };
}

/** Same train continues if some shared service runs both rides in the same direction. */
function staysOnTrain(prev: ResolvedRide, cur: ResolvedRide): boolean {
  return prev.services.some((s) => {
    if (!cur.services.includes(s)) return false;
    const dir = (r: ResolvedRide) => Math.sign(s.index.get(r.to)! - s.index.get(r.from)!);
    return dir(prev) === dir(cur);
  });
}

export function lower(origin: Station, destination: Station, rides: ResolvedRide[], net: Network): Journey {
  const steps: JourneyStep[] = [];
  const legs: Leg[] = [];
  let transfers = 0;

  rides.forEach((ride, i) => {
    const prev = rides[i - 1];
    if (prev) {
      if (prev.line !== ride.line) {
        steps.push({ type: 'transfer', transfer: { kind: 'interchange', at: ride.from, from: prev.line, to: ride.line, minutes: INTERCHANGE_MIN } });
        transfers += INTERCHANGE_MIN;
      } else if (!staysOnTrain(prev, ride)) {
        steps.push({ type: 'transfer', transfer: { kind: 'train', at: ride.from, from: prev.line, to: ride.line, minutes: TRAIN_CHANGE_MIN } });
        transfers += TRAIN_CHANGE_MIN;
      }
    }
    const hops = ride.path.length - 1;
    const leg: Leg = {
      line: ride.line,
      from: ride.from,
      to: ride.to,
      stations: ride.path,
      towards: net.towards(ride.services, ride.from, ride.to),
      hops,
      minutes: hops * ride.line.minutesPerHop,
    };
    legs.push(leg);
    steps.push({ type: 'leg', leg });
  });

  const riding = legs.reduce((sum, l) => sum + l.minutes, 0);
  const wait = legs.length ? INITIAL_WAIT_MIN : 0;
  const allStations = new Set<Station>([origin, ...legs.flatMap((l) => l.stations)]);
  const interchanges = steps.flatMap((s) => (s.type === 'transfer' && s.transfer.kind === 'interchange' ? [s.transfer.at] : []));

  return {
    origin,
    destination,
    steps,
    legs,
    interchanges,
    hops: legs.reduce((sum, l) => sum + l.hops, 0),
    stationCount: allStations.size,
    minutes: { wait, riding, transfers, total: wait + riding + transfers },
  };
}
