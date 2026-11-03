/**
 * Paired effects of an ablated configuration A against the baseline B (pure functions; the
 * records are checked by analysis/records.mjs before they get here).
 *
 * The pairs are the replicates on which both arms are feasible. The absolute difference
 * d_i = S_i(A) - S_i(B) is computed on all of them. The relative difference
 * r_i = 100 d_i / S_i(B) is undefined when the baseline cost is zero, so such pairs are left out of
 * the relative estimate only -- they stay in the absolute one -- and are counted separately.
 */
import { tci, signTest, median } from '../src/lib/stats.mjs';

const byRep = (rows, what) => {
  const m = new Map();
  for (const r of rows) {
    if (m.has(r.rep)) throw new Error(`${what}: replicate ${r.rep} recorded twice`);
    m.set(r.rep, r);
  }
  return m;
};

export function pairedEffect(ablatedRows, baselineRows, { reps = null, label = 'effect', partial = false } = {}) {
  const A = byRep(ablatedRows, `${label} (ablated)`), B = byRep(baselineRows, `${label} (baseline)`);
  let ids = [...new Set([...A.keys(), ...B.keys()])].filter((i) => !reps || reps.includes(i)).sort((x, y) => x - y);
  const unmatched = ids.filter((i) => !A.has(i) || !B.has(i));
  // a complete design has every replicate for both arms (checked before); only an explicitly
  // partial analysis may proceed on the replicates the two arms have in common
  if (unmatched.length && !partial) throw new Error(`${label}: replicates ${unmatched.join(', ')} are not recorded for both configurations`);
  ids = ids.filter((i) => A.has(i) && B.has(i));
  const feasA = ids.filter((i) => A.get(i).feasible).length, feasB = ids.filter((i) => B.get(i).feasible).length;
  const both = ids.filter((i) => A.get(i).feasible && B.get(i).feasible);
  const zeroBase = both.filter((i) => B.get(i).soft === 0);
  const relIds = both.filter((i) => B.get(i).soft > 0);
  const pairs = both.map((i) => ({ rep: i, sA: A.get(i).soft, sB: B.get(i).soft, abs: A.get(i).soft - B.get(i).soft,
    rel: B.get(i).soft > 0 ? 100 * (A.get(i).soft - B.get(i).soft) / B.get(i).soft : null }));
  const rel = pairs.filter((p) => p.rel !== null).map((p) => p.rel);
  return {
    replicates: ids.length, feasibleAblated: feasA, feasibleBaseline: feasB,
    bothFeasible: both.length, excludedInfeasible: ids.length - both.length, excludedZeroBaseline: zeroBase.length,
    excluded: ids.length - relIds.length,
    rel: tci(rel), abs: tci(pairs.map((p) => p.abs)), sign: signTest(rel), pairs,
    medianSoftAblated: feasA ? median(ids.filter((i) => A.get(i).feasible).map((i) => A.get(i).soft)) : null,
    medianSoftBaseline: feasB ? median(ids.filter((i) => B.get(i).feasible).map((i) => B.get(i).soft)) : null
  };
}
