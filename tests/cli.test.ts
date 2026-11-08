import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const CLI = new URL('../src/cli/safarc.ts', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;

function safarc(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [CLI, '--no-color', ...args], { cwd: ROOT, input, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('safarc CLI', () => {
  it('prints a journey card and exits 0', () => {
    const r = safarc(['examples/problem-statement.safar']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Rajiv Chowk → Botanical Garden');
    expect(r.stdout).toContain('23 stations · 1 interchange · ~56 min');
    expect(r.stderr).toContain('info[I401]');
  });

  it('reports errors rustc-style and exits 1', () => {
    const r = safarc(['examples/error-not-interchange.safar']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('error[E212]: Patel Chowk is not an interchange');
    expect(r.stderr).toContain('--> examples/error-not-interchange.safar:4:1');
    expect(r.stdout).toBe('');
  });

  it('reads stdin and emits JSON', () => {
    const r = safarc(['--emit', 'json', '-'], 'board Rajiv Chowk; ride Yellow to Hauz Khas; exit');
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(json.journey).toMatchObject({ origin: 'Rajiv Chowk', destination: 'Hauz Khas', stops: 9 });
  });

  it('plans a route as a program', () => {
    const r = safarc(['--plan', 'Connaught Place', 'T3']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('board Rajiv Chowk;\nride Yellow to New Delhi;\nchange Airport Express;\nride to IGI Airport;\nexit\n');
  });

  it('exits 2 on usage and I/O errors', () => {
    expect(safarc(['missing.safar']).code).toBe(2);
    expect(safarc(['--emit', 'wat', 'examples/airport.safar']).code).toBe(2);
    expect(safarc(['--plan', 'Nowhere', 'Hauz Khas']).stderr).toContain("unknown station 'Nowhere'");
  });
});

// In-process runs, so coverage sees the CLI code paths.
describe('safarc main()', () => {
  it('returns the documented exit codes', async () => {
    const { main } = await import('../src/cli/safarc.ts');
    const { vi } = await import('vitest');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const ewrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(main(['--no-color', 'examples/airport.safar'])).toBe(0);
      expect(main(['--no-color', '--emit', 'ir', 'examples/three-lines.safar', 'examples/branch-line.safar'])).toBe(0);
      expect(main(['--no-color', '-e', 'tokens', 'examples/airport.safar'])).toBe(0);
      expect(main(['--no-color', '-e', 'ast', '-q', 'examples/airport.safar'])).toBe(0);
      expect(main(['--no-color', 'examples/error-typos.safar'])).toBe(1);
      expect(main(['--help'])).toBe(0);
      expect(main(['--version'])).toBe(0);
      expect(main(['--bogus'])).toBe(2);
      expect(main([])).toBe(2);
      expect(main(['--plan', 'Hauz Khas'])).toBe(2);
      expect(main(['--plan', 'Hauz Khas', 'Hauz Khas'])).toBe(2);
    } finally {
      write.mockRestore();
      ewrite.mockRestore();
    }
  });
});

describe('safarc output streams', () => {
  it('does not colour stdout when only stderr is a terminal', () => {
    const r = spawnSync(process.execPath, [CLI, '-q', 'examples/airport.safar', 'examples/branch-line.safar'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '' },
    });
    expect(r.stdout).not.toContain('\x1b[');
  });

  it('rounds JSON time breakdowns', () => {
    const json = JSON.parse(safarc(['--emit', 'json', 'examples/branch-line.safar']).stdout);
    expect(json.journey.breakdown).toEqual({ wait: 3, riding: 37.4, transfers: 4, total: 44.4 });
  });
});
