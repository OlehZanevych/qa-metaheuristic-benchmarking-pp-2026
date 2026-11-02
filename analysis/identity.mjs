#!/usr/bin/env node
/**
 * Do the move-budget reproduction runs reproduce the archived historical runs exactly?
 *
 * A historical run is matched to a reproduction run by configuration, n, seed (= replicate) and
 * move budget. Compared fields: soft cost, hard count, moves made, feasibility and every validator
 * counter. The five archived n = 3200 rows whose note records that the run REQUESTED L = 1 but ran
 * under the silent max(50, L) clamp (Incident 5; relabelled "short-history" in the archive) are
 * counted separately: they are compared with the reproduction's explicit L = 50 runs.
 * Writes results/identity.json.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const L = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const HIST = ['ablation-moves.jsonl', 'ablation-twofactor.jsonl', 'ablation-deep3200.jsonl', 'ablation-deep12800.jsonl'];
const hist = HIST.flatMap((f) => L(join(ROOT, 'archive/records', f)).map((r) => ({ ...r, file: f })));
const repro = readdirSync(join(ROOT, 'results')).filter((f) => /^(T3-moves|B-moves|L-sweep)(\.part\d)?\.jsonl$/.test(f))
  .flatMap((f) => L(join(ROOT, 'results', f))).filter((r) => r.budgetType === 'moves' && !r.canary);
const dedup = new Map(repro.map((r) => [r.key, r]));
const key = (c, n, s, m) => `${c}|${n}|${s}|${m}`;
const R = new Map([...dedup.values()].map((r) => [key(r.config, r.n, r.rep, r.budget), r]));
const same = (h, r) => h.soft === r.soft && h.hard === r.hard && h.moves === r.moves && h.feasible === r.feasible
  && JSON.stringify(h.violations) === JSON.stringify(r.violations);
const out = { compared: 0, identical: 0, differing: [], clampedRequests: { compared: 0, identicalToL50: 0 } };
for (const h of hist) {
  const r = R.get(key(h.config, h.n, h.seed, h.moveBudget));
  if (!r) continue;
  out.compared++;
  const ok = same(h, r);
  if (ok) out.identical++; else out.differing.push({ file: h.file, key: h.key, hist: { soft: h.soft, hard: h.hard, moves: h.moves }, repro: { soft: r.soft, hard: r.hard, moves: r.moves } });
  if (/requested L=1/.test(h.note ?? '')) { out.clampedRequests.compared++; if (ok) out.clampedRequests.identicalToL50++; }
}
writeFileSync(join(ROOT, 'results/identity.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, differing: out.differing.slice(0, 5), nDiffering: out.differing.length }));
