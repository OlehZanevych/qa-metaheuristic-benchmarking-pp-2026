#!/usr/bin/env node
/**
 * Runs one design (experiments/designs.mjs) and appends one JSON line per run to
 * <out-dir>/<design>.jsonl (or <design>.part<i>.jsonl for a shard). Every schedule is scored by the
 * independent validator, never by the solver's own counters.
 *
 *   node experiments/run.mjs --design T3-moves --out-dir runs/2026-11-02 [--shard 0/2] [--resume] [--dry]
 *
 * A run never writes into results/: those are the records the article reports, kept unchanged.
 * A new output file starts a fresh experiment. An output file that already holds records is
 * refused unless --resume is given; then the existing records must be compatible with this run
 * (same plan, record schema, metric version, solver/generator/validator sources and effective
 * options; for wall-clock designs also the same host type), and only the missing runs are made.
 *
 * Wall-clock designs must run alone on the host (no other experiment in parallel); the runner
 * refuses --shard for them.
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { emit } from '../src/generator/emit.mjs';
import { validate } from '../src/validator/validate.mjs';
import { loadSolver, hydrate, effectiveOptions } from '../src/lib/solver.mjs';
import { CODE, METRIC_VERSION, environment } from '../src/lib/provenance.mjs';
import { DESIGNS, CONFIGS } from './designs.mjs';
import { SCHEMA, planOf, requestedOptions, assertWitness, scheduleHash, instanceHash, checkResume, isWall } from './plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
  const k = a.slice(2); const nx = process.argv[i + 1];
  if (!['design', 'shard', 'dry', 'out-dir', 'resume'].includes(k)) throw new Error(`unknown argument --${k} (rejected rather than ignored)`);
  argv[k] = nx && !nx.startsWith('--') ? (i++, nx) : true;
}
const name = argv.design;
const D = DESIGNS[name];
if (!D) throw new Error(`unknown design "${name}"; known: ${Object.keys(DESIGNS).join(', ')}`);
if (typeof argv['out-dir'] !== 'string') throw new Error('--out-dir DIR is required: a fresh experiment needs its own directory (results/ holds the article\'s records)');
const wall = isWall(name);
const [shard, shards] = (argv.shard ?? '0/1').split('/').map(Number);
if (!(Number.isInteger(shard) && Number.isInteger(shards) && shard >= 0 && shard < shards)) throw new Error(`bad --shard ${argv.shard}`);
if (wall && shards > 1) throw new Error('wall-clock designs must run alone; --shard is refused');

const outDir = resolve(argv['out-dir']);
mkdirSync(outDir, { recursive: true });
for (const kept of ['results', 'archive']) {
  const p = join(ROOT, kept);
  if (existsSync(p) && realpathSync(outDir).startsWith(realpathSync(p))) throw new Error(`${kept}/ holds the article's records and is never written by the runner; choose another --out-dir`);
}
const OUT = join(outDir, shards > 1 ? `${name}.part${shard}.jsonl` : `${name}.jsonl`);

const plan = planOf(name).filter((_, i) => i % shards === shard);
const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
if (existing.length && !argv.resume) {
  throw new Error(`${OUT} already holds ${existing.length} records. A fresh experiment needs a new --out-dir; ` +
    'to continue this one, pass --resume (its records are then checked for compatibility).');
}
if (argv.resume && !existing.length) throw new Error(`--resume: ${OUT} holds no records to continue`);

const mod = await loadSolver();
const env = environment();
const effective = (job) => effectiveOptions(mod, requestedOptions(job));
const done = argv.resume ? checkResume(name, existing, { code: CODE, metricVersion: METRIC_VERSION, effective, env }) : new Set();
const todo = plan.filter((j) => !done.has(j.key));
console.log(`${name}: ${plan.length} runs in this shard, ${done.size} already recorded, ${todo.length} to do -> ${OUT}`);
if (argv.dry) { for (const j of todo) console.log(j.key); process.exit(0); }

const batchId = randomUUID();
const instances = new Map();
for (const job of todo) {
  const ik = `${job.n}/${job.rep}`;
  if (!instances.has(ik)) {
    instances.clear();
    const inst = emit(job.n, job.rep);
    instances.set(ik, { ...inst, hash: instanceHash(inst.problem) });
  }
  const { problem, hidden, hash } = instances.get(ik);
  const reference = validate(problem, hidden);
  assertWitness(reference, job.n, job.rep);
  const requested = requestedOptions(job);
  const eff = effectiveOptions(mod, requested);
  let callbacks = 0, firstFeasibleMs = null;
  const startedAt = new Date().toISOString();
  const t0 = process.hrtime.bigint();
  const res = mod.solveTimetable(hydrate(problem), requested, job.callback ? (p) => {
    callbacks++; if (firstFeasibleMs === null && p.hardTotal === 0) firstFeasibleMs = Number(process.hrtime.bigint() - t0) / 1e6;
  } : () => {});
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const placements = res.assignments.filter((a) => a.placement).map((a) => ({ key: a.key, ...a.placement }));
  const v = validate(problem, placements);
  const row = {
    schema: SCHEMA, runId: randomUUID(), batchId,
    key: job.key, design: name, config: job.config, label: CONFIGS[job.config].label, canary: !!job.canary,
    tag: job.tag ?? null, orderIndex: job.orderIndex, order: D.order, n: job.n, rep: job.rep,
    instanceSeed: job.rep, solverSeed: requested.seed, instanceHash: hash,
    budgetType: job.budget.moves ? 'moves' : 'wall', budget: job.budget.moves ?? job.budget.timeMs,
    requestedOptions: requested, effectiveOptions: eff, callback: job.callback,
    startedAt, wallMs: Math.round(wallMs), moves: res.iterations, movesPerSec: Math.round(res.iterations / (wallMs / 1000)),
    budgetSpent: job.budget.moves ? res.iterations === job.budget.moves : wallMs >= job.budget.timeMs * 0.98,
    feasible: v.feasible, hard: v.hard, soft: v.soft, objective: v.objective, violations: v.violations, filters: v.filters,
    scheduleHash: scheduleHash(placements),
    unplaced: res.unplaced.length, timeToFeasibleMs: firstFeasibleMs === null ? null : Math.round(firstFeasibleMs),
    referenceSoft: reference.soft, callbacks,
    metricVersion: METRIC_VERSION, code: CODE, env
  };
  appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${row.key.padEnd(48)} hard=${String(v.hard).padStart(3)} soft=${String(v.soft).padStart(6)} moves/s=${row.movesPerSec} wall=${(wallMs / 1000).toFixed(1)}s`);
}
