// Throughput benchmark: compiles each example repeatedly and reports per-compile latency.
// Run with: npm run bench
import { readdirSync, readFileSync } from 'node:fs';
import { compile } from '../src/compiler/index.ts';

const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.safar')).sort();
const ITERATIONS = 2000;

console.log(`${'example'.padEnd(28)} ${'µs/compile'.padStart(11)}  ${'compiles/s'.padStart(11)}`);
for (const f of files) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  for (let i = 0; i < 200; i++) compile(src); // warm up the JIT
  const t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) compile(src);
  const us = ((performance.now() - t0) / ITERATIONS) * 1000;
  console.log(`${f.padEnd(28)} ${us.toFixed(1).padStart(11)}  ${Math.round(1e6 / us).toLocaleString('en-US').padStart(11)}`);
}
