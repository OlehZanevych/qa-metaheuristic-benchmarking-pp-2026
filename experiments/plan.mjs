/**
 * The execution plan of a design and the rules a run record must obey. Shared by the runner
 * (experiments/run.mjs), which follows the plan, and by the analysis (analysis/records.mjs), which
 * checks that a set of records is exactly the plan -- every cell present once, nothing else --
 * before computing anything from it.
 */
import { createHash } from 'node:crypto';
import { DESIGNS, CONFIGS, CANARY } from './designs.mjs';

/** Record schema. 1: the records of 1-2 November 2026 (results/); 2 adds filters, run id and hashes. */
export const SCHEMA = 2;

export const solverSeed = (rep) => 20260802 + rep;

export const keyOf = (name, j) =>
  `${name}|${j.config}|n${j.n}|r${j.rep}|${j.budget.moves ? 'm' + j.budget.moves : 't' + j.budget.timeMs}${j.tag ? '|' + j.tag : ''}`;

export const isWall = (name) => DESIGNS[name].budget.timeMs !== undefined;

/** Every job of a design in execution order, canaries included (before sharding). */
export function planOf(name) {
  const D = DESIGNS[name];
  if (!D) throw new Error(`unknown design "${name}"; known: ${Object.keys(DESIGNS).join(', ')}`);
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
  return plan.map((j) => ({ ...j, key: keyOf(name, j) }));
}

/** The options a job asks the solver for. */
export function requestedOptions(job) {
  return { ...CONFIGS[job.config].opts, seed: solverSeed(job.rep),
    ...(job.budget.moves ? { maxIterations: job.budget.moves, timeLimitMs: 3_600_000 } : { timeLimitMs: job.budget.timeMs }) };
}

/**
 * The retained witness must be feasible in the full sense of Definition 1: no hard violation AND
 * no filter breach (unplaced, duplicate, room, time grid, scheduling rule). `reference` is the
 * validator's verdict on the witness.
 */
export function assertWitness(reference, n, rep) {
  if (reference.feasible === true) return;
  throw new Error(`retained witness of n=${n} r=${rep} is not feasible: hard=${reference.hard} ` +
    `violations=${JSON.stringify(reference.violations)} filters=${JSON.stringify(reference.filters)}`);
}

/**
 * SHA-256 of a schedule in canonical form: the placements sorted by requirement key, each with its
 * fields in alphabetical order. Two runs have equal hashes exactly when they produced the same schedule.
 */
export function scheduleHash(placements) {
  const canon = placements
    .map((p) => Object.fromEntries(Object.keys(p).sort().map((k) => [k, p[k] ?? null])))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

export const instanceHash = (problem) => createHash('sha256').update(JSON.stringify(problem)).digest('hex');

/** Order-insensitive deep equality for the plain JSON values of a record. */
export function sameJson(a, b) {
  const norm = (x) => (Array.isArray(x) ? x.map(norm) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm(x[k])])) : x);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * May the runner append to an existing record file? Only when every record in it belongs to this
 * design's plan and was produced by the same record schema, metric version, solver, generator and
 * validator sources and the same effective options -- otherwise a resumed batch would silently mix
 * incompatible rows. Wall-clock records are measurements of the host, so for them the CPU model,
 * core count, architecture and Node version must also be unchanged. Returns the keys already done.
 */
export function checkResume(name, rows, { code, metricVersion, effective, env }) {
  const plan = new Map(planOf(name).map((j) => [j.key, j]));
  const problems = [];
  const seen = new Set();
  for (const r of rows) {
    const j = plan.get(r.key);
    if (!j) { problems.push(`${r.key}: not a run of design ${name}`); continue; }
    if (seen.has(r.key)) problems.push(`${r.key}: recorded twice`);
    seen.add(r.key);
    if (r.schema !== SCHEMA) problems.push(`${r.key}: record schema ${r.schema ?? 1}, the runner writes ${SCHEMA}`);
    if (r.metricVersion !== metricVersion) problems.push(`${r.key}: metric version "${r.metricVersion}" differs from "${metricVersion}"`);
    for (const part of ['solver', 'generator', 'validator']) {
      if (r.code?.[part] !== code[part]) problems.push(`${r.key}: ${part} source changed since the run (${String(r.code?.[part]).slice(0, 12)} -> ${code[part].slice(0, 12)})`);
    }
    if (!sameJson(r.effectiveOptions, effective(j))) problems.push(`${r.key}: effective options differ from what this code would run`);
    if (isWall(name) && env) {
      for (const k of ['cpuModel', 'logicalCpus', 'arch', 'node']) if (r.env?.[k] !== env[k]) problems.push(`${r.key}: wall-clock run made with ${k} = ${r.env?.[k]}, this host has ${env[k]}`);
    }
  }
  if (problems.length) {
    throw new Error(`cannot resume ${name}: the existing records are not compatible with this run\n  ` + problems.slice(0, 20).join('\n  ') +
      (problems.length > 20 ? `\n  ... ${problems.length - 20} more` : ''));
  }
  return seen;
}
