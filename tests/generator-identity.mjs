#!/usr/bin/env node
/**
 * The released generator (src/generator) adds one travel guard to the generator used for the
 * historical records (tests/reference). This test emits every instance of 13 sizes x 20 seeds with
 * both and requires byte-identical output, and requires that the guard never fired.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emit as released } from '../src/generator/emit.mjs';
import { emit as reference } from './reference/emit.mjs';
import { guardFired } from '../src/generator/build.mjs';
import { validate } from '../src/validator/validate.mjs';
import { BOUNDARY, BOUNDARY_SEEDS } from './boundary-configs.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// where test outputs go: results/ by default, a fresh experiment's own directory under run_all.sh
const RESULTS = process.env.RESULTS_DIR ?? join(ROOT, 'results');
const quick = process.argv.includes('--quick');
const SIZES = quick ? [10, 400] : [10, 30, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 20000, 31000];
const SEEDS = quick ? 3 : 20;
const h = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
let n = 0; const diff = [];
for (const size of SIZES) for (let s = 1; s <= SEEDS; s++) { n++; if (h(released(size, s)) !== h(reference(size, s))) diff.push(`${size}/${s}`); }
// Boundary configurations: here the guard may fire. Report where the two generators differ and
// whether the reference generator's witness is feasible there (if not, the guard closes a real gap).
const boundary = [];
const fired0 = guardFired.count;
if (!quick) for (const { n: size, opts } of BOUNDARY) for (const s of BOUNDARY_SEEDS) {
  const before = guardFired.count;
  const a = released(size, s, opts), b = reference(size, s, opts);
  const vb = validate(b.problem, b.hidden), va = validate(a.problem, a.hidden);
  boundary.push({ n: size, seed: s, opts, identical: h(a) === h(b), guardFired: guardFired.count - before,
    referenceWitnessFeasible: vb.feasible, referenceHard: vb.hard, releasedWitnessFeasible: va.feasible });
}
const out = { instances: n, sizes: SIZES, seeds: SEEDS, differing: diff, guardFired: fired0,
  boundary: { instances: boundary.length, differing: boundary.filter((r) => !r.identical).length,
    guardFired: boundary.reduce((x, r) => x + r.guardFired, 0),
    referenceWitnessInfeasible: boundary.filter((r) => !r.referenceWitnessFeasible).length,
    releasedWitnessInfeasible: boundary.filter((r) => !r.releasedWitnessFeasible).length, cases: boundary.filter((r) => !r.identical) } };
if (!quick) { mkdirSync(RESULTS, { recursive: true }); writeFileSync(join(RESULTS, 'generator-identity.json'), JSON.stringify(out, null, 1)); }
console.log(JSON.stringify(out));
if (diff.length || fired0 || out.boundary.releasedWitnessInfeasible) process.exit(1);
