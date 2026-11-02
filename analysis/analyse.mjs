#!/usr/bin/env node
/**
 * Turns results/*.jsonl and the test outputs into every number the article reports from the
 * reproduction runs: results/summary.json (all estimates), results/paired-observations.csv (every
 * matched pair behind every effect), and results/tex/*.tex (LaTeX macros and tables).
 *
 * The analysis enforces its own preconditions (safeguard 7): a row whose budget was not spent is
 * an error; soft-cost comparisons use only replicates on which BOTH arms are feasible, and the
 * feasibility counts are reported beside every effect; every design's cells are checked for
 * completeness before an effect is computed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DESIGNS, CONFIGS } from '../experiments/designs.mjs';
import { tci, signTest, median, mean } from '../src/lib/stats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = join(ROOT, 'results');
const load = (d) => { const f = join(R, `${d}.jsonl`); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : null; };
const partial = process.argv.includes('--partial');

const data = {};
for (const d of Object.keys(DESIGNS)) {
  const rows = load(d);
  if (!rows) { if (partial) continue; throw new Error(`results/${d}.jsonl is missing (run ./run_all.sh, or pass --partial)`); }
  const main = rows.filter((r) => !r.canary);
  const D = DESIGNS[d];
  const expected = D.order === 'repeat6' ? 6 : D.configs.length * D.reps.length;
  if (main.length !== expected && !partial) throw new Error(`${d}: ${main.length} runs, expected ${expected} -- incomplete batch`);
  for (const r of main) if (!r.budgetSpent) throw new Error(`${d}: ${r.key} did not spend its budget`);
  data[d] = rows;
}
const cell = (d, config) => (data[d] ?? []).filter((r) => !r.canary && r.config === config);
const pairs = [];   // every matched observation, for the CSV

/** Paired effect of `ablated` against `baseline` in design d. */
function effect(d, ablated, baseline = 'full', reps = null) {
  const A = new Map(cell(d, ablated).map((r) => [r.rep, r])), B = new Map(cell(d, baseline).map((r) => [r.rep, r]));
  const ids = [...A.keys()].filter((i) => B.has(i) && (!reps || reps.includes(i))).sort((x, y) => x - y);
  const feasA = ids.filter((i) => A.get(i).feasible).length, feasB = ids.filter((i) => B.get(i).feasible).length;
  const matched = ids.filter((i) => A.get(i).feasible && B.get(i).feasible && B.get(i).soft > 0);
  const rel = matched.map((i) => 100 * (A.get(i).soft - B.get(i).soft) / B.get(i).soft);
  const abs = matched.map((i) => A.get(i).soft - B.get(i).soft);
  for (const i of matched) pairs.push({ design: d, ablated, baseline, rep: i, sA: A.get(i).soft, sB: B.get(i).soft, rel: 100 * (A.get(i).soft - B.get(i).soft) / B.get(i).soft });
  return { design: d, ablated, baseline, replicates: ids.length, feasibleAblated: feasA, feasibleBaseline: feasB,
    excluded: ids.length - matched.length, rel: tci(rel), abs: tci(abs), sign: signTest(rel),
    medianSoftAblated: feasA ? median(ids.filter((i) => A.get(i).feasible).map((i) => A.get(i).soft)) : null,
    medianSoftBaseline: feasB ? median(ids.filter((i) => B.get(i).feasible).map((i) => B.get(i).soft)) : null };
}

const S = { generated: new Date().toISOString(), estimand: 'mean paired relative difference (%), 95% Student-t interval; replicate = generated instance + solver seed' };

// ---- Table 3 replication (n = 3200) -------------------------------------------------------
const T3 = ['no-chain', 'no-taper', 'no-hot', 'no-rcl', 'no-swap', 'fixed-weight', 'short-history', 'long-history'];
S.table3 = {};
for (const d of ['T3-wall30-blocked', 'T3-wall60-blocked', 'T3-wall30-shuffled', 'T3-moves']) {
  if (!data[d]) continue;
  S.table3[d] = { full: { feasible: cell(d, 'full').filter((r) => r.feasible).length, runs: cell(d, 'full').length,
    medianSoft: median(cell(d, 'full').filter((r) => r.feasible).map((r) => r.soft)) },
    effects: Object.fromEntries(T3.map((c) => [c, effect(d, c)])) };
}
// the move-budget batch restricted to replicates 1..5, for a like-for-like column
if (data['T3-moves']) S.table3['T3-moves-r1to5'] = { effects: Object.fromEntries(T3.map((c) => [c, effect('T3-moves', c, 'full', [1, 2, 3, 4, 5])])) };

// ---- budget dependence at n = 12 800 --------------------------------------------------------
S.budget = {};
for (const c of ['no-chain', 'greedy-accept', 'no-swap', 'no-rcl']) {
  S.budget[c] = {};
  for (const d of ['B-wall60', 'B-wall300']) if (data[d]) S.budget[c][d] = effect(d, c);
  if (data['B-moves']) { S.budget[c]['B-moves-r1to5'] = effect('B-moves', c, 'full', [1, 2, 3, 4, 5]); S.budget[c]['B-moves'] = effect('B-moves', c); }
}

// ---- 2x2 interaction (ejection chain x targeted swap) ---------------------------------------
// S11 = both present (full), S10 = chain only (no-swap), S01 = swap only (no-chain), S00 = neither.
// Additive interaction I_i = S11 - S10 - S01 + S00 on the soft-cost scale; also as % of S11.
function interaction(d) {
  const get = (c) => new Map(cell(d, c).filter((r) => r.feasible).map((r) => [r.rep, r.soft]));
  const s11 = get('full'), s10 = get('no-swap'), s01 = get('no-chain'), s00 = get('no-swap-no-chain');
  const reps = [...s11.keys()].filter((i) => s10.has(i) && s01.has(i) && s00.has(i)).sort((a, b) => a - b);
  const I = reps.map((i) => s11.get(i) - s10.get(i) - s01.get(i) + s00.get(i));
  const Ipct = reps.map((i, k) => 100 * I[k] / s11.get(i));
  const chainWithSwap = reps.map((i) => 100 * (s01.get(i) - s11.get(i)) / s11.get(i));
  const chainWithoutSwap = reps.map((i) => 100 * (s00.get(i) - s10.get(i)) / s10.get(i));
  return { design: d, reps: reps.length, cells: { s11: [...s11.values()].length, s10: s10.size, s01: s01.size, s00: s00.size },
    interactionAbs: tci(I), interactionPctOfFull: tci(Ipct), sign: signTest(I),
    chainEffectWithSwap: tci(chainWithSwap), chainEffectWithoutSwap: tci(chainWithoutSwap),
    perReplicate: reps.map((i, k) => ({ rep: i, s11: s11.get(i), s10: s10.get(i), s01: s01.get(i), s00: s00.get(i), I: I[k] })) };
}
S.interaction = {};
for (const d of ['T3-moves', 'B-moves']) if (data[d]) S.interaction[d] = interaction(d);

// ---- acceptance-history sweep (n = 12 800, 3e6 moves, replicates 1..5) ----------------------
if (data['L-sweep'] && data['B-moves']) {
  const fullRows = cell('B-moves', 'full'), l1 = cell('B-moves', 'greedy-accept');
  const Lrows = { 1: l1, 100: fullRows };
  for (const [c, L] of [['L2', 2], ['L5', 5], ['L10', 10], ['L20', 20], ['short-history', 50], ['L200', 200]]) Lrows[L] = cell('L-sweep', c);
  S.lsweep = Object.fromEntries(Object.entries(Lrows).map(([L, rows]) => {
    const by = new Map(rows.map((r) => [r.rep, r])), fb = new Map(fullRows.map((r) => [r.rep, r]));
    const reps = [1, 2, 3, 4, 5].filter((i) => by.get(i)?.feasible && fb.get(i)?.feasible);
    const rel = reps.map((i) => 100 * (by.get(i).soft - fb.get(i).soft) / fb.get(i).soft);
    return [L, { L: Number(L), feasible: [1, 2, 3, 4, 5].filter((i) => by.get(i)?.feasible).length,
      medianSoft: median(reps.map((i) => by.get(i).soft)), vsL100: tci(rel) }];
  }));
}

// ---- timing --------------------------------------------------------------------------------
if (data.drift) {
  const rows = data.drift.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const mps = rows.map((r) => r.movesPerSec);
  S.drift = { runs: rows.map((r) => ({ tag: r.tag, startedAt: r.startedAt, callback: r.callback, moves: r.moves, wallMs: r.wallMs, movesPerSec: r.movesPerSec, soft: r.soft })),
    identicalOutcome: new Set(rows.map((r) => `${r.moves}/${r.soft}/${r.hard}`)).size === 1,
    meanMps: mean(mps), rangePctOfMean: 100 * (Math.max(...mps) - Math.min(...mps)) / mean(mps),
    callbackOnMean: mean(rows.filter((r) => r.callback).map((r) => r.movesPerSec)),
    callbackOffMean: mean(rows.filter((r) => !r.callback).map((r) => r.movesPerSec)) };
}
S.canaries = {};
for (const d of Object.keys(data)) {
  const c = data[d].filter((r) => r.canary).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (c.length) S.canaries[d] = c.map((r) => ({ tag: r.tag, startedAt: r.startedAt, movesPerSec: r.movesPerSec, soft: r.soft }));
}
// throughput of the complete solver per batch (median moves/s), the between-batch drift view
S.throughput = {};
for (const d of Object.keys(data)) { const f = cell(d, 'full'); if (f.length) S.throughput[d] = { medianMps: median(f.map((r) => r.movesPerSec)), min: Math.min(...f.map((r) => r.movesPerSec)), max: Math.max(...f.map((r) => r.movesPerSec)) }; }

// ---- tests ---------------------------------------------------------------------------------
for (const [k, f] of [['validator', 'validator-tests.json'], ['mutations', 'mutations.json'], ['selftest', 'generator-selftest.json'], ['guard', 'generator-identity.json']]) {
  const p = join(R, f); if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  if (k === 'validator') S.validator = { pairs: j.cases.filter((c) => c.kind !== 'boundary case').length, boundary: j.cases.filter((c) => c.kind === 'boundary case').length, failed: j.cases.filter((c) => !c.pass).map((c) => c.id) };
  if (k === 'mutations') S.mutations = { total: j.length, caughtFinal: j.filter((m) => m.final.caught).length, caughtInitial: j.filter((m) => m.initial.caught).length, survivedInitial: j.filter((m) => !m.initial.caught).map((m) => m.id) };
  if (k === 'selftest') S.selftest = j.summary;
  if (k === 'guard') { if (j.differing.length || j.guardFired) throw new Error('released and reference generators differ'); S.guard = { instances: j.instances, sizes: j.sizes.length, seeds: j.seeds, guardFired: j.guardFired, boundary: j.boundary ? { instances: j.boundary.instances, differing: j.boundary.differing, guardFired: j.boundary.guardFired, referenceWitnessInfeasible: j.boundary.referenceWitnessInfeasible } : null }; }
}

mkdirSync(join(R, 'tex'), { recursive: true });
writeFileSync(join(R, 'summary.json'), JSON.stringify(S, null, 1));
writeFileSync(join(R, 'paired-observations.csv'), 'design,ablated,baseline,replicate,soft_ablated,soft_baseline,relative_difference_pct\n' +
  pairs.map((p) => [p.design, p.ablated, p.baseline, p.rep, p.sA, p.sB, p.rel.toFixed(3)].join(',')).join('\n') + '\n');
console.log('wrote results/summary.json, results/paired-observations.csv');
