import type { ChangeStmt, Name, Program, RideStmt, Stmt } from './ast.ts';
import type { Diagnostic, Fix, Span } from './diagnostics.ts';
import { routeStatements, type Line, type Network, type Service, type Station } from './network.ts';

/** A ride that passed every check: the input to lowering. */
export interface ResolvedRide {
  stmt: RideStmt;
  line: Line;
  from: Station;
  to: Station;
  services: Service[];
  path: Station[];
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  rides: ResolvedRide[];
  origin: Station | null;
  destination: Station | null;
  /** The line in effect for each ride statement, used by the editor for completions. */
  rideLines: Map<RideStmt, Line>;
}

const list = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const lineList = (lines: Line[]) => list(lines.map((l) => l.name));

/**
 * Walks the program like an interpreter, tracking where the traveller is and which
 * line they are on. After an error the state is repaired optimistically (or marked
 * unknown) so one mistake doesn't cascade into a page of follow-on errors.
 */
export function check(program: Program, net: Network): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const rides: ResolvedRide[] = [];
  const rideLines = new Map<RideStmt, Line>();
  const visited = new Set<Station>();

  let boarded = false;
  let reportedNotBoarded = false;
  let exited = false;
  let origin: Station | null = null;
  let destination: Station | null = null;
  /** null = unknown, either before boarding or after an error. */
  let station: Station | null = null;
  let line: Line | null = null;
  // Widened explicitly: it's only reassigned inside the closures below, which TS doesn't track.
  let pendingChange = null as ChangeStmt | null;

  const report = (severity: Diagnostic['severity'], code: string, message: string, span: Span, extra: { help?: string; fix?: Fix } = {}) =>
    diagnostics.push({ severity, code, message, span, ...extra });

  function resolveStation(name: Name): Station | null {
    const st = net.station(name.text);
    if (st) return st;
    const [best, ...rest] = net.suggestStations(name.text);
    report('error', 'E206', `Unknown station '${name.text}'`, name.span, best
      ? { help: `Did you mean ${list([best, ...rest].map((s) => `'${s}'`))}?`, fix: { label: `Replace with '${best}'`, span: name.span, text: best } }
      : { help: 'Check the spelling against the Network tab.' });
    return null;
  }

  function resolveLine(name: Name): Line | null {
    const l = net.line(name.text);
    if (l) return l;
    const [best] = net.suggestLines(name.text);
    report('error', 'E207', `Unknown line '${name.text}'`, name.span, {
      help: `${best ? `Did you mean '${best}'? ` : ''}Lines: ${lineList(net.lines)}.`,
      fix: best ? { label: `Replace with '${best}'`, span: name.span, text: best } : undefined,
    });
    return null;
  }

  function routeFix(stmt: Stmt, from: Station, to: Station, onLine: Line | null, label: string): { help: string; fix: Fix } | null {
    const route = net.plan(from, to);
    if (!route) return null;
    const text = routeStatements(route, onLine).join('; ');
    return { help: `Try: ${text}`, fix: { label, span: stmt.span, text } };
  }

  function markVisited(path: Station[], at: Span) {
    const repeats = path.slice(1).filter((s) => visited.has(s));
    if (repeats.length) {
      const names = repeats.slice(0, 3).map((s) => s.name);
      const more = repeats.length > 3 ? ` and ${repeats.length - 3} more` : '';
      report('warning', 'W301', `This ride passes ${names.join(', ')}${more} a second time`, at, {
        help: 'Your journey doubles back on itself.',
      });
    }
    for (const s of path) visited.add(s);
  }

  function checkRide(stmt: RideStmt) {
    pendingChange = null;
    if (!stmt.dest) {
      station = null;
      return;
    }
    const dest = resolveStation(stmt.dest);

    // Which line is this ride on?
    let rideLine: Line | null = null;
    if (stmt.line) {
      rideLine = resolveLine(stmt.line);
      if (rideLine && line && rideLine !== line) {
        const canChange = station && rideLine.stations.includes(station);
        report('error', 'E211', `You're on the ${line.name} line; change before riding ${rideLine.name}`, stmt.line.span, canChange
          ? {
              help: `Add 'change ${rideLine.name}' first: lines only change with an explicit change.`,
              fix: { label: `Insert 'change ${rideLine.name};'`, span: { start: stmt.span.start, end: stmt.span.start }, text: `change ${rideLine.name}; ` },
            }
          : { help: station ? `The ${rideLine.name} line doesn't stop at ${station.name}, so you can't switch to it here.` : undefined });
        if (!canChange) station = null;
      }
    } else if (line) {
      rideLine = line;
    } else if (station) {
      if (station.lines.length === 1) {
        rideLine = station.lines[0];
      } else {
        const fits = dest ? station.lines.filter((l) => dest.lines.includes(l)) : [];
        const after = { start: stmt.keyword.end, end: stmt.keyword.end };
        report('error', 'E210', `${station.name} is served by ${lineList(station.lines)}: say which line to ride`, stmt.keyword, fits.length === 1
          ? { help: `${dest!.name} is on the ${fits[0].name} line.`, fix: { label: `Ride ${fits[0].name}`, span: after, text: ` ${fits[0].name}` } }
          : { help: `Write 'ride <line> to ${stmt.dest.text}'.` });
        rideLine = fits.length === 1 ? fits[0] : null;
      }
    }
    if (rideLine) rideLines.set(stmt, rideLine);

    const from = station;
    const prevLine = line;
    station = dest;
    line = rideLine ?? line;
    if (!dest || !from || !rideLine) return;

    if (dest === from) {
      report('error', 'E209', `You're already at ${dest.name}`, stmt.dest.span);
      return;
    }
    const servesFrom = rideLine.stations.includes(from);
    const servesTo = rideLine.stations.includes(dest);
    if (!servesFrom) {
      report('error', 'E208', `The ${rideLine.name} line doesn't stop at ${from.name}`, stmt.line?.span ?? stmt.keyword, {
        help: `${from.name} is on the ${lineList(from.lines)} line${from.lines.length > 1 ? 's' : ''}.`,
      });
    }
    if (!servesTo) {
      const route = servesFrom ? routeFix(stmt, from, dest, prevLine, 'Use suggested route') : null;
      report('error', 'E208', `${dest.name} is not on the ${rideLine.name} line`, stmt.dest.span, {
        help: `${dest.name} is on ${lineList(dest.lines)}.${route ? ` ${route.help}` : ''}`,
        fix: route?.fix,
      });
    }
    if (!servesFrom || !servesTo) return;

    const services = net.servicesBetween(rideLine, from, dest);
    if (services.length === 0) {
      const route = routeFix(stmt, from, dest, prevLine, 'Split at the junction');
      report('error', 'E216', `No direct ${rideLine.name} line train runs from ${from.name} to ${dest.name}`, stmt.dest.span, {
        help: `They are on different branches; change trains at the junction. ${route?.help ?? ''}`.trim(),
        fix: route?.fix,
      });
      return;
    }
    const path = net.path(services[0], from, dest);
    markVisited(path, stmt.dest.span);
    rides.push({ stmt, line: rideLine, from, to: dest, services, path });
  }

  function checkChange(stmt: ChangeStmt) {
    if (!stmt.line) return;
    const target = resolveLine(stmt.line);
    if (!target) return;
    if (pendingChange) {
      report('warning', 'W302', `You changed to ${pendingChange.line!.text} but never rode it`, pendingChange.span);
    }
    pendingChange = stmt;
    const current = line;
    line = target;
    if (!station) return;

    if (!current) {
      report('error', 'E215', "You haven't ridden a line yet, so there's nothing to change from", stmt.span, {
        help: `Name the line in your first ride instead: 'ride ${target.name} to <station>'.`,
      });
      if (!target.stations.includes(station)) station = null;
      return;
    }
    if (target === current) {
      report('error', 'E214', `You're already on the ${target.name} line`, stmt.line.span, {
        fix: { label: 'Remove this change', span: stmt.span, text: '' },
      });
      return;
    }
    const here = station;
    const nearest = net.nearestChangePoint(current, here, target);
    const suggestion = nearest
      ? {
          help: `Nearest place to change to ${target.name}: ${nearest.station.name} (${nearest.hops} stop${nearest.hops > 1 ? 's' : ''} away on ${current.name}).`,
          fix: { label: `Ride to ${nearest.station.name} first`, span: { start: stmt.span.start, end: stmt.span.start }, text: `ride to ${nearest.station.name}; ` },
        }
      : { help: `The ${current.name} and ${target.name} lines don't meet.` };

    if (!net.isInterchange(here)) {
      report('error', 'E212', `${here.name} is not an interchange; only the ${current.name} line stops here`, stmt.span, suggestion);
      station = null;
    } else if (!target.stations.includes(here)) {
      report('error', 'E213', `${here.name} is an interchange for ${lineList(here.lines)}, but not ${target.name}`, stmt.line.span, suggestion);
      station = null;
    }
  }

  const statements = program.statements;
  if (statements.length === 0) {
    report('error', 'E201', "Empty program: a journey starts with 'board <station>'", { start: 0, end: 0 }, {
      fix: { label: 'Insert example', span: { start: 0, end: 0 }, text: 'board Rajiv Chowk;\nride Yellow to Hauz Khas;\nexit\n' },
    });
  }

  for (const stmt of statements) {
    if (exited) {
      report('error', 'E205', "Statements after 'exit' are never reached", { start: stmt.span.start, end: statements.at(-1)!.span.end }, {
        help: 'A journey ends at its first exit.',
      });
      break;
    }
    if (stmt.kind === 'board') {
      if (boarded) {
        report('error', 'E203', 'You can only board once per journey', stmt.keyword, { help: 'Use ride and change to continue the journey.' });
        continue;
      }
      boarded = true;
      station = stmt.station ? resolveStation(stmt.station) : null;
      origin = station;
      if (station) visited.add(station);
      continue;
    }
    if (!boarded && !reportedNotBoarded) {
      reportedNotBoarded = true;
      report('error', 'E202', "A journey must start with 'board <station>'", stmt.keyword, {
        fix: { label: "Insert 'board'", span: { start: stmt.span.start, end: stmt.span.start }, text: 'board <station>; ' },
      });
    }
    if (stmt.kind === 'ride') checkRide(stmt);
    else if (stmt.kind === 'change') checkChange(stmt);
    else {
      if (pendingChange) report('warning', 'W302', `You changed to ${pendingChange.line!.text} but never rode it`, pendingChange.span);
      if (boarded && rides.length === 0 && !diagnostics.some((d) => d.severity === 'error')) {
        report('warning', 'W303', 'You exit without riding anywhere', stmt.keyword);
      }
      exited = true;
      destination = station;
    }
  }

  if (statements.length > 0 && !exited) {
    const end = program.span.end;
    report('error', 'E204', "Journey never ends: add 'exit'", { start: end, end }, {
      fix: { label: "Append 'exit'", span: { start: end, end }, text: '\nexit' },
    });
  }

  return { diagnostics, rides, origin, destination, rideLines };
}
