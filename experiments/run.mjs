#!/usr/bin/env node
/**
 * Runs one design (experiments/designs.mjs) and appends one JSON line per run to
 * results/<design>.jsonl. Every schedule is scored by the independent validator, never by the
 * solver's own counters. Resumable: a run whose key is already in the file is skipped.
 *
 *   node experiments/run.mjs --design T3-moves [--shard 0/2] [--dry]
 *
 * Wall-clock designs must run alone on the host (no other experiment in parallel); the runner
 * refuses --shard for them.
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emit } from '../src/generator/emit.mjs';
import { validate } from '../src/validator/validate.mjs';
import { loadSolver, hydrate, effectiveOptions } from '../src/lib/solver.mjs';
import { CODE, METRIC_VERSION, environment } from '../src/lib/provenance.mjs';
import { DESIGNS, CONFIGS, CANARY } from './designs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
  const k = a.slice(2); const nx = process.argv[i + 1];
  if (!['design', 'shard', 'dry', 'out'].includes(k)) throw new Error(`unknown argument --${k} (rejected rather than ignored)`);
  argv[k] = nx && !nx.startsWith('--') ? (i++, nx) : true;
}
const name = argv.design;
const D = DESIGNS[name];
if (!D) throw new Error(`unknown design "${name}"; known: ${Object.keys(DESIGNS).join(', ')}`);
const wall = D.budget.timeMs !== undefined;
const [shard, shards] = (argv.shard ?? '0/1').split('/').map(Number);
if (wall && shards > 1) throw new Error('wall-clock designs must run alone; --shard is refused');
const OUT = argv.out ?? join(ROOT, 'results', shards > 1 ? `${name}.part${shard}.jsonl` : `${name}.jsonl`);
mkdirSync(dirname(OUT), { recursive: true });

export const solverSeed = (rep) => 20260802 + rep;
const keyOf = (j) => `${name}|${j.config}|n${j.n}|r${j.rep}|${j.budget.moves ? 'm' + j.budget.moves : 't' + j.budget.timeMs}${j.tag ? '|' + j.tag : ''}`;

// ---- the plan, in execution order ----------------------------------------------------------
let plan = [];
if (D.order === 'repeat6') {
  for (let k = 0; k < 6; k++) plan.push({ config: D.configs[0], n: D.n, rep: D.reps[0], budget: D.budget, tag: `x${k + 1}`, callback: k % 2 === 0 });
} else {
  for (const c of D.configs) for (const rep of D.reps) plan.push({ config: c, n: D.n, rep, budget: D.budget, callback: true });
  if (D.order === 'shuffled') {
    // seeded, so the order itself is reproducible and recorded
    let s = 0x9e3779b9 ^ [...name].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
    const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [plan[i], plan[j]] = [plan[j], plan[i]]; }
  } else if (D.order !== 'blocked') throw new Error(`unknown order ${D.order}`);
}
plan = plan.map((j, i) => ({ ...j, orderIndex: i }));
if (D.canary) {
  const at = [0, Math.floor(plan.length / 2), plan.length];
  const withC = [];
  plan.forEach((j, i) => { if (at.includes(i)) withC.push({ ...CANARY, canary: true, tag: `canary@${i}`, callback: true, orderIndex: -1 }); withC.push(j); });
  withC.push({ ...CANARY, canary: true, tag: `canary@${plan.length}`, callback: true, orderIndex: -1 });
  plan = withC;
}
plan = plan.filter((_, i) => i % shards === shard);

const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
const todo = plan.filter((j) => !done.has(keyOf(j)));
console.log(`${name}: ${plan.length} runs in this shard, ${todo.length} to do -> ${OUT}`);
if (argv.dry) { for (const j of todo) console.log(keyOf(j)); process.exit(0); }

const mod = await loadSolver();
const env = environment();
const instances = new Map();
for (const job of todo) {
  const ik = `${job.n}/${job.rep}`;
  if (!instances.has(ik)) { instances.clear(); instances.set(ik, emit(job.n, job.rep)); }
  const { problem, hidden } = instances.get(ik);
  const reference = validate(problem, hidden);
  if (reference.hard !== 0) throw new Error(`planted schedule of n=${job.n} r=${job.rep} is not feasible`);
  const requested = { ...CONFIGS[job.config].opts, seed: solverSeed(job.rep),
    ...(job.budget.moves ? { maxIterations: job.budget.moves, timeLimitMs: 3_600_000 } : { timeLimitMs: job.budget.timeMs }) };
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
    key: keyOf(job), design: name, config: job.config, label: CONFIGS[job.config].label, canary: !!job.canary,
    tag: job.tag ?? null, orderIndex: job.orderIndex, order: D.order, n: job.n, rep: job.rep,
    instanceSeed: job.rep, solverSeed: solverSeed(job.rep),
    budgetType: job.budget.moves ? 'moves' : 'wall', budget: job.budget.moves ?? job.budget.timeMs,
    requestedOptions: requested, effectiveOptions: eff, callback: job.callback,
    startedAt, wallMs: Math.round(wallMs), moves: res.iterations, movesPerSec: Math.round(res.iterations / (wallMs / 1000)),
    budgetSpent: job.budget.moves ? res.iterations === job.budget.moves : wallMs >= job.budget.timeMs * 0.98,
    feasible: v.feasible, hard: v.hard, soft: v.soft, objective: v.objective, violations: v.violations,
    unplaced: res.unplaced.length, timeToFeasibleMs: firstFeasibleMs === null ? null : Math.round(firstFeasibleMs),
    referenceSoft: reference.soft, callbacks,
    metricVersion: METRIC_VERSION, code: CODE, env
  };
  appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${row.key.padEnd(48)} hard=${String(v.hard).padStart(3)} soft=${String(v.soft).padStart(6)} moves/s=${row.movesPerSec} wall=${(wallMs / 1000).toFixed(1)}s`);
}
