#!/usr/bin/env node
// safarc: the Safar compiler on the command line.
// Runs straight from TypeScript source on Node ≥ 22.18 (native type stripping), no build step.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  astToJSON, compile, formatDiagnostic, network, renderIR, renderJourneyText, resultToJSON, routeProgram,
} from '../compiler/index.ts';

const EMITS = ['card', 'ir', 'tokens', 'ast', 'json'] as const;
type Emit = (typeof EMITS)[number];

const HELP = `safarc: compile Delhi Metro journeys written in Safar

Usage
  safarc [options] <file.safar ...>     compile files ("-" reads stdin)
  safarc --plan <from> <to>             write a program for the fastest route

Options
  -e, --emit <kind>   card (default) | ir | tokens | ast | json
  -q, --quiet         only print the output, no summary line
      --no-color      disable ANSI colours (also honours NO_COLOR)
  -h, --help          show this help
  -v, --version       show version

Exit codes: 0 compiled, 1 compile errors, 2 usage or I/O error

Example
  echo "board Rajiv Chowk; ride Yellow to Hauz Khas; exit" | safarc -`;

const out = (s: string) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
const err = (s: string) => process.stderr.write(s.endsWith('\n') ? s : `${s}\n`);

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return `safarc ${pkg.version}`;
}

export function main(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        emit: { type: 'string', short: 'e', default: 'card' },
        plan: { type: 'boolean' },
        quiet: { type: 'boolean', short: 'q' },
        'no-color': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    err(`safarc: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values: opts, positionals: files } = parsed;
  // Decided per stream: diagnostics go to stderr, output to stdout, and either may be redirected.
  const colorFor = (stream: NodeJS.WriteStream) =>
    !opts['no-color'] && !process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR) || stream.isTTY === true);
  const color = colorFor(process.stderr);
  const dim = (s: string) => (colorFor(process.stdout) ? `\x1b[2m${s}\x1b[0m` : s);
  const green = (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s);
  const red = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);

  if (opts.help) return out(HELP), 0;
  if (opts.version) return out(version()), 0;

  if (opts.plan) {
    if (files.length !== 2) return err('safarc: --plan needs exactly two stations, e.g. --plan "Rajiv Chowk" "Botanical Garden"'), 2;
    const [from, to] = files.map((name) => {
      const st = network.station(name);
      if (!st) {
        const [best] = network.suggestStations(name);
        err(`safarc: unknown station '${name}'${best ? ` (did you mean '${best}'?)` : ''}`);
      }
      return st;
    });
    if (!from || !to) return 2;
    const route = network.plan(from, to);
    if (!route) return err('safarc: pick two different stations'), 2;
    out(routeProgram(from, route));
    return 0;
  }

  const emit = opts.emit as Emit;
  if (!EMITS.includes(emit)) return err(`safarc: unknown --emit '${emit}' (expected ${EMITS.join(', ')})`), 2;
  if (files.length === 0) return err(HELP), 2;

  let failed = false;
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file === '-' ? 0 : file, 'utf8');
    } catch (e) {
      err(`safarc: cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
      return 2;
    }
    const name = file === '-' ? '<stdin>' : file;
    const r = compile(source);
    const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
    failed ||= errors > 0;

    if (emit !== 'json') {
      for (const d of r.diagnostics) err(`${formatDiagnostic(source, d, { file: name, color })}\n`);
    }
    if (files.length > 1 && emit !== 'json') out(dim(`── ${name} ──`));
    switch (emit) {
      case 'json': out(JSON.stringify({ file: name, ...resultToJSON(r) }, null, 2)); break;
      case 'tokens':
        for (const t of r.tokens) {
          const value = t.value === '\n' ? '\\n' : t.value;
          out(`${String(t.span.start).padStart(4)}..${String(t.span.end).padEnd(4)} ${t.type.padEnd(9)} ${value}`);
        }
        break;
      case 'ast': out(astToJSON(r.program, source)); break;
      case 'ir': if (r.journey) out(renderIR(r.journey)); break;
      case 'card': if (r.journey) out(renderJourneyText(r.journey)); break;
    }

    if (!opts.quiet && emit !== 'json') {
      const ms = Object.values(r.timings).reduce((a, b) => a + b, 0).toFixed(2);
      err(errors
        ? red(`✗ ${name}: ${errors} error${errors > 1 ? 's' : ''}`)
        : green(`✓ ${name}: compiled in ${ms} ms`));
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  process.exitCode = main(process.argv.slice(2));
}
