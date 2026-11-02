#!/usr/bin/env node
/**
 * Generator self-test (Section 2.2 of the article; Proposition 1 and its scope).
 *
 * For every instance of the study's family (8 sizes x 20 generator seeds) and for a set of boundary
 * configurations, the retained witness sigma* is re-scored by the independent validator, which
 * must report H = 0 and every filter counter (unplaced, duplicate, room eligibility, time-grid
 * eligibility, scheduling-rule breach) at zero; each requirement must carry exactly one placement;
 * and the number of sessions produced is compared with the number requested. The SHA-256 of every
 * emitted instance and of every witness is recorded, so that a reader can confirm they regenerate
 * the same files.
 *
 * Feasibility is a theorem (Proposition 1); size fulfilment is not, and is measured here.
 *
 *   node tests/generator-selftest.mjs           full family + boundary configurations
 *   node tests/generator-selftest.mjs --quick   two small sizes, three seeds
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emit } from '../src/generator/emit.mjs';
import * as gen from '../src/generator/build.mjs';
import { validate } from '../src/validator/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const SIZES = quick ? [400, 800] : [400, 800, 1600, 3200, 6400, 12800, 20000, 31000];
const SEEDS = quick ? 3 : 20;
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

function check(n, seed, opts = {}) {
  const fired0 = gen.guardFired ? gen.guardFired.count : 0;
  const { problem, hidden, meta } = emit(n, seed, opts);
  const guard = gen.guardFired ? gen.guardFired.count - fired0 : null;
  const byKey = new Map();
  for (const h of hidden) byKey.set(h.key, (byKey.get(h.key) ?? 0) + 1);
  const notExactlyOnce = problem.requirements.filter((q) => byKey.get(q.key) !== 1).length;
  const v = validate(problem, hidden);
  const produced = problem.requirements.length + (problem.fixedEntries ?? []).length;
  return { n, seed, opts, requested: n, produced, requirements: problem.requirements.length,
    fixed: problem.fixedEntries.length, constraints: meta.constraints, notExactlyOnce,
    H: v.hard, filters: v.filters, feasible: v.feasible, witnessSoft: v.soft,
    instanceSha256: sha(problem), witnessSha256: sha(hidden), travelGuardFired: guard };
}

const family = [];
for (const n of SIZES) for (let s = 1; s <= SEEDS; s++) family.push(check(n, s));

import { BOUNDARY, BOUNDARY_SEEDS } from './boundary-configs.mjs';
const boundary = quick ? [] : BOUNDARY.flatMap(({ n, opts }) => BOUNDARY_SEEDS.map((s) => check(n, s, opts)));

const all = [...family, ...boundary];
const bad = all.filter((r) => !r.feasible || r.H !== 0 || r.notExactlyOnce);
const short = (rs) => rs.filter((r) => r.produced < r.requested);
const summary = {
  family: { instances: family.length, sizes: SIZES, seeds: SEEDS, sessions: family.reduce((a, r) => a + r.produced, 0),
    infeasibleWitness: family.filter((r) => !r.feasible).length, notExactlyOnce: family.filter((r) => r.notExactlyOnce).length,
    shortOfRequestedSize: short(family).length },
  boundary: { instances: boundary.length, infeasibleWitness: boundary.filter((r) => !r.feasible).length,
    shortOfRequestedSize: short(boundary).length,
    worstShortfallPct: short(boundary).length ? Math.max(...short(boundary).map((r) => 100 * (1 - r.produced / r.requested))).toFixed(1) : '0.0' },
  travelGuardFired: { family: family.reduce((a, r) => a + (r.travelGuardFired ?? 0), 0),
    boundary: boundary.reduce((a, r) => a + (r.travelGuardFired ?? 0), 0),
    boundaryInstancesAffected: boundary.filter((r) => r.travelGuardFired).length }
};
mkdirSync(join(ROOT, 'results'), { recursive: true });
if (!quick) writeFileSync(join(ROOT, 'results/generator-selftest.json'), JSON.stringify({ summary, instances: all }, null, 1));
console.log(JSON.stringify(summary));
if (bad.length) { console.log('FAIL: witness not feasible or not one placement per requirement:', bad.slice(0, 5).map((r) => `n=${r.n} s=${r.seed}`)); process.exit(1); }
