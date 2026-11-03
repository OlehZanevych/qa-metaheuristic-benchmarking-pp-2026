#!/usr/bin/env node
/**
 * Do the safeguards reject what they claim to reject? Each case feeds one of the failures the
 * article discusses to the code that is supposed to stop it, and requires a rejection (or, for
 * the zero baseline, the documented treatment). Run in a few seconds; no solver run is made.
 *
 *  G1  witness with zero hard violations but a filter breach (an unplaced session)  -> run.mjs assertWitness
 *  G2  a duplicated record replacing a missing cell (row count unchanged)          -> records.mjs checkDesign
 *  G3  a record with another metric version                                        -> checkDesign
 *  G4  a record whose effective options differ from what the released code runs   -> checkDesign
 *  G5  a record from an undeclared generator version                               -> checkDesign
 *  G6  a record whose fields disagree with its plan cell (configuration)           -> checkDesign
 *  G7  resuming after a source change, a metric change or with an unplanned record -> plan.mjs checkResume
 *  G8  a feasible pair with a zero baseline                                        -> effects.mjs pairedEffect
 *  G9  the runner asked to write into results/, or to append without --resume      -> experiments/run.mjs
 * and, as controls, the article's own records pass checkDesign and a compatible resume is accepted.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emit } from '../src/generator/emit.mjs';
import { validate } from '../src/validator/validate.mjs';
import { loadSolver, effectiveOptions } from '../src/lib/solver.mjs';
import { CODE, METRIC_VERSION, environment } from '../src/lib/provenance.mjs';
import { ARTICLE_DESIGNS } from '../experiments/designs.mjs';
import { SCHEMA, planOf, requestedOptions, assertWitness, checkResume } from '../experiments/plan.mjs';
import { checkDesign, loadDesign } from '../analysis/records.mjs';
import { pairedEffect } from '../analysis/effects.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = process.env.RESULTS_DIR ?? join(ROOT, 'results');
const mod = await loadSolver();
const results = [];
const expectThrow = (id, what, fn, pattern) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  const pass = msg !== null && (!pattern || pattern.test(msg));
  results.push({ id, what, pass, detail: msg ? msg.split('\n').slice(0, 2).join(' / ') : 'not rejected' });
};
const expectOk = (id, what, fn) => {
  let detail = 'accepted';
  let pass = true;
  try { const r = fn(); if (r === false) { pass = false; detail = 'wrong result'; } } catch (e) { pass = false; detail = e.message.split('\n')[0]; }
  results.push({ id, what, pass, detail });
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- G1: the witness check is Definition 1, not "hard = 0" --------------------------------------
{
  const { problem, hidden } = emit(400, 1);
  const ok = validate(problem, hidden);
  expectOk('G1a', 'the retained witness of n=400 r=1 is accepted', () => assertWitness(ok, 400, 1));
  const broken = validate(problem, hidden.slice(1));    // one session left unplaced
  if (broken.hard !== 0) throw new Error('fixture: expected zero hard violations');
  expectThrow('G1b', 'a witness with hard = 0 but one unplaced session is rejected', () => assertWitness(broken, 400, 1), /not feasible.*unplaced":1/);
}

// ---- G2-G6: record checks, on the article's own T3-moves records --------------------------------
const base = loadDesign(join(ROOT, 'results'), 'T3-moves');
for (const d of ARTICLE_DESIGNS) expectOk(`C-${d}`, `the article's records of ${d} pass the checks`, () => checkDesign(d, loadDesign(join(ROOT, 'results'), d), mod));
{
  const rows = clone(base);
  rows[3] = clone(rows[4]);                          // same length, one cell missing, one twice
  expectThrow('G2', 'a duplicate replacing a missing cell is rejected although the row count is right', () => checkDesign('T3-moves', rows, mod), /recorded 2 times[\s\S]*planned but missing|planned but missing[\s\S]*recorded 2 times/);
}
{
  const rows = clone(base); rows[0].metricVersion = 'validator-v2 (soft = unrounded)';
  expectThrow('G3', 'a record with another metric version is rejected', () => checkDesign('T3-moves', rows, mod), /metric version/);
}
{
  const rows = clone(base); rows[0].effectiveOptions.lahcLength = 50;
  expectThrow('G4', 'a record whose effective options are not those of the released code is rejected', () => checkDesign('T3-moves', rows, mod), /effective options/);
}
{
  const rows = clone(base); rows[0].code.generator = 'f'.repeat(64);
  expectThrow('G5', 'a record from an undeclared generator version is rejected', () => checkDesign('T3-moves', rows, mod), /generator source/);
}
{
  const rows = clone(base); const r = rows.find((x) => x.config === 'no-chain'); r.config = 'no-swap';
  expectThrow('G6', 'a record whose configuration disagrees with its plan cell is rejected', () => checkDesign('T3-moves', rows, mod), /config = "no-swap"/);
}

// ---- G7: resume compatibility --------------------------------------------------------------------
{
  const env = environment();
  const effective = (j) => effectiveOptions(mod, requestedOptions(j));
  const fake = planOf('smoke').slice(0, 2).map((j) => ({ schema: SCHEMA, key: j.key, design: 'smoke', code: { ...CODE },
    metricVersion: METRIC_VERSION, effectiveOptions: effective(j), env }));
  const ctx = { code: CODE, metricVersion: METRIC_VERSION, effective, env };
  expectOk('G7a', 'a compatible partial batch can be resumed (its two runs are skipped)', () => checkResume('smoke', fake, ctx).size === 2);
  const src = clone(fake); src[1].code.solver = '0'.repeat(64);
  expectThrow('G7b', 'resuming after a solver source change is refused', () => checkResume('smoke', src, ctx), /solver source changed/);
  const met = clone(fake); met[0].metricVersion = 'other';
  expectThrow('G7c', 'resuming under another metric version is refused', () => checkResume('smoke', met, ctx), /metric version/);
  const odd = clone(fake); odd[0].key = 'smoke|full|n400|r9|m20000';
  expectThrow('G7d', 'resuming a file with an unplanned record is refused', () => checkResume('smoke', odd, ctx), /not a run of design/);
  const old = clone(fake); delete old[0].schema;
  expectThrow('G7e', 'resuming a file of the older record schema is refused', () => checkResume('smoke', old, ctx), /record schema 1/);
}

// ---- G8: zero baseline -----------------------------------------------------------------------------
{
  const A = [{ rep: 1, feasible: true, soft: 12 }, { rep: 2, feasible: true, soft: 110 }, { rep: 3, feasible: true, soft: 95 }];
  const B = [{ rep: 1, feasible: true, soft: 0 }, { rep: 2, feasible: true, soft: 100 }, { rep: 3, feasible: true, soft: 100 }];
  expectOk('G8', 'a zero-baseline pair stays in the absolute difference and is excluded (and counted) only from the relative one', () => {
    const e = pairedEffect(A, B);
    return e.abs.k === 3 && e.rel.k === 2 && e.excludedZeroBaseline === 1 && Math.abs(e.abs.mean - (12 + 10 - 5) / 3) < 1e-9 && Math.abs(e.rel.mean - 2.5) < 1e-9;
  });
  expectThrow('G8b', 'a replicate recorded for only one arm is an error (not a smaller sample)', () => pairedEffect(A, B.slice(1)), /not recorded for both/);
}

// ---- G9: the runner keeps the article's records unchanged -----------------------------------------
{
  const run = (args) => execFileSync(process.execPath, [join(ROOT, 'experiments/run.mjs'), ...args], { stdio: 'pipe', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  expectThrow('G9a', 'the runner refuses to write into results/', () => run(['--design', 'smoke', '--out-dir', join(ROOT, 'results'), '--dry']), /never written by the runner/);
  const dir = mkdtempSync(join(tmpdir(), 'qa-g9-'));
  writeFileSync(join(dir, 'smoke.jsonl'), readFileSync(join(ROOT, 'results/drift.jsonl'), 'utf8').split('\n')[0] + '\n');
  expectThrow('G9b', 'the runner refuses to append to an existing record file without --resume', () => run(['--design', 'smoke', '--out-dir', dir, '--dry']), /already holds 1 records/);
  expectThrow('G9c', 'with --resume, records of another design are refused', () => run(['--design', 'smoke', '--out-dir', dir, '--resume', '--dry']), /cannot resume smoke/);
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
mkdirSync(RESULTS, { recursive: true });
writeFileSync(join(RESULTS, 'safeguard-tests.json'), JSON.stringify(results.map(({ id, what, pass }) => ({ id, what, pass })), null, 1));
for (const r of results) console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.id.padEnd(22)} ${r.what}${r.pass ? '' : ` -- ${r.detail}`}`);
console.log(`safeguard tests: ${results.length - failed.length}/${results.length} pass`);
if (failed.length) process.exit(1);
