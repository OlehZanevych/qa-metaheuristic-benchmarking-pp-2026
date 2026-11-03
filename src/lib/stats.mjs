/**
 * Paired-effect statistics used by analysis/analyse.mjs. Standard library only.
 *
 * Estimand. For a replicate i on which both arms reached feasibility, the paired relative
 * difference of an ablated configuration A against the baseline B is
 *     r_i = 100 * (S_i(A) - S_i(B)) / S_i(B),
 * positive when removing the component makes the soft cost worse (the objective is minimised).
 * The reported effect is the mean of r_i over the k matched feasible pairs, with a two-sided 95 %
 * Student-t interval mean +- t(0.975, k-1) * sd / sqrt(k). The replicate is the sampling unit:
 * each replicate is a different generated instance with its own solver seed. Treating the pairs as
 * independent is a working assumption -- runs on one host share its conditions, which can correlate
 * wall-clock outcomes -- and one solver seed per instance does not separate instance variability from
 * solver randomness. With four to ten pairs the interval is approximate (it leans on the normality of
 * the paired differences); every pair is published in paired-observations.csv.
 */
const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160,
  2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tq = (df) => (df < T975.length ? T975[df] : 1.96);
export const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

export function tci(values) {
  const k = values.length;
  if (k < 2) return { k, mean: k ? values[0] : NaN, lo: NaN, hi: NaN };
  const m = mean(values), h = tq(k - 1) * sd(values) / Math.sqrt(k);
  return { k, mean: m, lo: m - h, hi: m + h, sd: sd(values), median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

/** Exact two-sided sign test p-value for the number of positive values among non-zero ones. */
export function signTest(values) {
  const nz = values.filter((x) => x !== 0), n = nz.length, pos = nz.filter((x) => x > 0).length;
  if (!n) return { n, pos, p: 1 };
  const c = (n2, k2) => { let r = 1; for (let i = 1; i <= k2; i++) r = r * (n2 - k2 + i) / i; return r; };
  const tail = (k) => { let s = 0; for (let i = 0; i <= k; i++) s += c(n, i); return s / 2 ** n; };
  return { n, pos, p: Math.min(1, 2 * tail(Math.min(pos, n - pos))) };
}
