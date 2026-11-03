#!/usr/bin/env node
/**
 * Do the move-budget reproduction runs reproduce the archived historical runs?
 *
 * Candidates: every row of the four archived move-budget files (HIST below). A historical row is
 * matched to a reproduction run by configuration, n, seed (= replicate) and move budget; rows of
 * configurations or sizes that the reproduction designs did not rerun stay unmatched and are
 * listed with their configuration and size. For a matched pair the compared fields are the soft
 * cost, the hard count, the number of moves made, the feasibility flag and the nine validator
 * counters (`violations`). Schedule identity is NOT assessed: the archived rows store no
 * assignments, so equal summaries are reported as equal summaries, not as equal schedules.
 * (Records of schema 2 carry a schedule hash, so two such sets can be compared on it as well.)
 *
 * The five archived n = 3200 rows whose note records that the run REQUESTED L = 1 but ran under
 * the silent max(50, L) clamp (Incident 5; relabelled "short-history" in the archive) are counted
 * separately: they are compared with the reproduction's explicit L = 50 runs.
 *
 *   node analysis/identity.mjs [--results DIR]       writes DIR/identity.json (default results/)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const R = resolve(arg('--results') ?? process.env.RESULTS_DIR ?? join(ROOT, 'results'));
const L = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const HIST = ['ablation-moves.jsonl', 'ablation-twofactor.jsonl', 'ablation-deep3200.jsonl', 'ablation-deep12800.jsonl'];
const hist = HIST.flatMap((f) => L(join(ROOT, 'archive/records', f)).map((r) => ({ ...r, file: f })));

// the merged record file of each move-budget design (run_all.sh merges shards into it)
const repro = ['T3-moves', 'B-moves', 'L-sweep'].flatMap((d) => {
  const f = join(R, `${d}.jsonl`);
  if (!existsSync(f)) throw new Error(`${f} is missing`);
  return L(f);
}).filter((r) => r.budgetType === 'moves' && !r.canary);
const key = (c, n, s, m) => `${c}|${n}|${s}|${m}`;
const R2 = new Map();
for (const r of repro) {
  const k = key(r.config, r.n, r.rep, r.budget);
  if (R2.has(k)) throw new Error(`two reproduction runs for ${k}`);
  R2.set(k, r);
}
const FIELDS = ['soft', 'hard', 'moves', 'feasible', 'violations'];
const same = (h, r) => h.soft === r.soft && h.hard === r.hard && h.moves === r.moves && h.feasible === r.feasible
  && JSON.stringify(h.violations) === JSON.stringify(r.violations);
const out = {
  records: R === resolve(ROOT, 'results') ? 'results/' : R,
  sources: HIST.map((f) => `archive/records/${f}`),
  comparedFields: FIELDS, scheduleIdentity: 'not assessed: the archived records store no assignments',
  candidates: hist.length, compared: 0, identical: 0, unmatched: 0, unmatchedBy: {},
  differing: [], clampedRequests: { compared: 0, identicalToL50: 0 }
};
for (const h of hist) {
  const r = R2.get(key(h.config, h.n, h.seed, h.moveBudget));
  if (!r) {
    out.unmatched++;
    const k = `${h.config} n=${h.n} budget=${h.moveBudget}`;
    out.unmatchedBy[k] = (out.unmatchedBy[k] ?? 0) + 1;
    continue;
  }
  out.compared++;
  const ok = same(h, r);
  if (ok) out.identical++; else out.differing.push({ file: h.file, key: h.key, hist: { soft: h.soft, hard: h.hard, moves: h.moves }, repro: { soft: r.soft, hard: r.hard, moves: r.moves } });
  if (/requested L=1/.test(h.note ?? '')) { out.clampedRequests.compared++; if (ok) out.clampedRequests.identicalToL50++; }
}
writeFileSync(join(R, 'identity.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ candidates: out.candidates, compared: out.compared, identical: out.identical, unmatched: out.unmatched, unmatchedBy: out.unmatchedBy, nDiffering: out.differing.length }));
