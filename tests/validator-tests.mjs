#!/usr/bin/env node
/**
 * Runs the validator test cases (tests/validator-cases.mjs) against src/validator/validate.mjs, or
 * against the file named by VALIDATOR (used by tests/mutations.mjs), and writes every input,
 * expected vector and observed vector to results/validator-tests.json.
 *
 * A pair passes when the valid fragment scores zero on every counter and the mutated fragment
 * matches its full expected vector -- the expected counter changes by the expected amount and no
 * other counter moves. A boundary case passes when its fragment matches its full expected vector.
 *
 *   node tests/validator-tests.mjs            exit 0 when every case passes
 *   EXCLUDE=V07 node tests/validator-tests.mjs  run without some cases (the "initial suite")
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PAIRS, SINGLES, COUNTERS, vector } from './validator-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// where test outputs go: results/ by default, a fresh experiment's own directory under run_all.sh
const RESULTS = process.env.RESULTS_DIR ?? join(ROOT, 'results');
const VPATH = resolve(process.env.VALIDATOR ?? join(ROOT, 'src/validator/validate.mjs'));
const { validate } = await import(pathToFileURL(VPATH).href);
const exclude = new Set((process.env.EXCLUDE ?? '').split(',').filter(Boolean));
const quiet = process.env.QUIET === '1';

const observe = ({ p, s }) => { const v = validate(p, s); const o = { ...v.violations, ...v.filters };
  return { vector: Object.fromEntries(COUNTERS.map((k) => [k, o[k]])), hard: v.hard, feasible: v.feasible }; };
const diff = (got, want) => COUNTERS.filter((k) => got[k] !== want[k]).map((k) => `${k}=${got[k]} (expected ${want[k]})`);

const records = [], failures = [];
for (const c of PAIRS) {
  if (exclude.has(c.id)) continue;
  const vi = c.valid(), mu = c.mutated();
  const gv = observe(vi), bv = observe(mu);
  const wantValid = vector(), wantMut = vector(c.expect);
  const d1 = diff(gv.vector, wantValid), d2 = diff(bv.vector, wantMut);
  if (d1.length) failures.push(`${c.id} ${c.family}: valid fragment ${d1.join(', ')}`);
  if (d2.length) failures.push(`${c.id} ${c.family}: mutated fragment ${d2.join(', ')}`);
  records.push({ id: c.id, kind: c.row === 'valid' ? 'standalone legality check' : 'valid/violating pair',
    family: c.family, arrangement: c.what, legalityAssertion: c.legality ?? null, note: c.note ?? null,
    valid: { input: vi, expected: wantValid, observed: gv.vector, feasible: gv.feasible },
    mutated: { input: mu, expected: wantMut, observed: bv.vector, feasible: bv.feasible },
    pass: !d1.length && !d2.length });
}
for (const c of SINGLES) {
  if (exclude.has(c.id)) continue;
  const fr = c.f(); const o = observe(fr); const want = vector(c.expect); const d = diff(o.vector, want);
  if (d.length) failures.push(`${c.id}: ${d.join(', ')}`);
  records.push({ id: c.id, kind: 'boundary case', arrangement: c.what, input: fr, expected: want, observed: o.vector, feasible: o.feasible, pass: !d.length });
}

if (!process.env.VALIDATOR) {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'validator-tests.json'), JSON.stringify({ validator: 'src/validator/validate.mjs', counters: COUNTERS, cases: records }, null, 1));
}
if (!quiet) for (const f of failures) console.log(`  FAIL ${f}`);
const nPairs = records.filter((r) => r.kind !== 'boundary case').length, nB = records.length - nPairs;
if (failures.length) { if (!quiet) console.log(`${failures.length} failure(s)`); process.exit(1); }
if (!quiet) console.log(`validator tests: ${nPairs} pair cases and ${nB} boundary cases pass (full counter vectors)`);
