/**
 * interaction.mjs — do two leave-one-out contributions add?
 *
 * Every row of the ablation is the complete solver minus one mechanism, which measures that
 * mechanism's marginal contribution against a background containing all the others. That is the
 * right quantity to report, and it is not the same as the mechanism's value: if two mechanisms do
 * overlapping work, each one's leave-one-out cell is cheap because the other covers for it, and a
 * leave-one-out design cannot see that from its own rows.
 *
 * The pair most likely to interact here is targeted swap (N2) and the ejection chain (N4): both
 * exist to place a class where something already sits. So one two-factor cell was run — both
 * removed, same instances, same seeds, same move budget as the leave-one-out batch — and this
 * script computes the 2x2 interaction contrast from it.
 *
 * THE CONTRAST, per seed:
 *
 *     I = (both removed - chain removed) - (swap removed - full)
 *
 * which is zero when the two losses add. I > 0 means removing swap costs MORE once the chain is
 * gone (the mechanisms substitute for each other); I < 0 means it costs less (they complement each
 * other, each being worth more in the other's presence).
 *
 * The exact two-sided Wilcoxon signed-rank test on k paired seeds cannot produce a p below 2/2^k,
 * so at small k the test is a consistency check and never the basis of the claim; the per-seed
 * values are printed and tabulated so a reader can judge the spread directly. That constraint is
 * the same one the companion measurement paper states as a checklist item. The floor is COMPUTED
 * into the caption and into a macro rather than typed, because the batch grew from five seeds to
 * more and a hand-typed floor would have stayed at 0.0625 while the table moved underneath it.
 *
 * Run: node interaction.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync as pathExists } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'records');
const PAPERS = [join(HERE, '..'), join(HERE, '..', 'articles')]
  .find((d) => pathExists(join(d, 'timetable-generation'))) ?? join(HERE, '..');
const OUT = process.argv[2] ?? join(HERE, '..', 'reconstructed');
mkdirSync(OUT, { recursive: true });

const load = (f) => readFileSync(join(RESULTS, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rows = [...load('ablation-moves.jsonl'), ...load('ablation-twofactor.jsonl')];

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Exact two-sided Wilcoxon signed-rank; identical implementation to analyse.mjs by design. */
function wilcoxon(d0) {
  const d = d0.filter((x) => x !== 0);
  const n = d.length;
  if (!n) return { W: 0, p: 1, n: 0 };
  const idx = d.map((x, i) => i).sort((i, j) => Math.abs(d[i]) - Math.abs(d[j]));
  const rank = new Array(n);
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && Math.abs(d[idx[j + 1]]) === Math.abs(d[idx[i]])) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k]] = r;
    i = j + 1;
  }
  let Wp = 0, Wm = 0;
  for (let i = 0; i < n; i++) (d[i] > 0 ? Wp += rank[i] : Wm += rank[i]);
  const W = Math.min(Wp, Wm);
  let count = 0;
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    let p = 0, m2 = 0;
    for (let i = 0; i < n; i++) ((mask >> i) & 1 ? p += rank[i] : m2 += rank[i]);
    if (Math.min(p, m2) <= W) count++;
  }
  return { W, p: count / total, n };
}

const CELLS = ['full', 'no-swap', 'no-chain', 'no-swap-no-chain'];
const sizes = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b)
  .filter((n) => CELLS.every((c) => rows.some((r) => r.n === n && r.config === c)));

const panels = [];
for (const n of sizes) {
  const cell = (c) => {
    const m = new Map();
    for (const r of rows) if (r.n === n && r.config === c) m.set(r.seed, r.soft);
    return m;
  };
  const [full, noSwap, noChain, both] = CELLS.map(cell);
  const seeds = [...full.keys()].filter((s) => [noSwap, noChain, both].every((m) => m.has(s)))
    .sort((a, b) => a - b);
  if (seeds.length < 3) continue;
  /**
   * REFUSE TO BE READ MID-BATCH, LOUDLY.
   *
   * A seed enters the panel only when all four cells have it, so a batch still running yields a
   * panel of whichever seeds the shuffled schedule happened to finish --- an arbitrary subset, not
   * a prefix. We read one of those once and wrote "the sixth seed moved the estimate by half" into
   * the algorithm paper; there was no sixth seed, there was a seed numbered eight that finished
   * early. The set of incomplete seeds is therefore printed on every run, so that a partial read
   * announces itself instead of looking like a result.
   */
  const partial = [...new Set([...noSwap.keys(), ...noChain.keys(), ...both.keys(), ...full.keys()])]
    .filter((s) => !seeds.includes(s)).sort((a, b) => a - b);
  if (partial.length) {
    console.warn(`  !! n=${n}: batch INCOMPLETE — seeds ${partial.join(', ')} are missing at least ` +
      'one cell and are excluded. The panel below is an arbitrary subset of a running batch, not a ' +
      'prefix of the seed order; do not quote it.');
  }
  // Per-seed contrast, in soft-cost units and then as a share of that seed's own complete solver,
  // because soft costs differ fourfold between the sizes and a raw contrast would not compare.
  const raw = seeds.map((s) => (both.get(s) - noChain.get(s)) - (noSwap.get(s) - full.get(s)));
  const rel = seeds.map((s, i) => (100 * raw[i]) / full.get(s));
  const pct = (m) => (100 * (med(seeds.map((s) => m.get(s))) - med(seeds.map((s) => full.get(s)))))
    / med(seeds.map((s) => full.get(s)));
  panels.push({
    n, seeds,
    moveBudget: rows.find((r) => r.n === n && r.config === 'full')?.moveBudget ?? null,
    full, noSwap, noChain, both,
    dSwap: pct(noSwap), dChain: pct(noChain), dBoth: pct(both),
    raw, rel, meanRel: mean(rel),
    test: wilcoxon(raw),
    // Each mechanism's loss measured against the OTHER background: the number a leave-one-out
    // design cannot produce from its own rows.
    chainGivenNoSwap: pct(both) - pct(noSwap),
    swapGivenNoChain: pct(both) - pct(noChain),
    /**
     * Paired sign counts, which are what this sample size can actually resolve.
     *
     * The interaction contrast is a difference of two differences and compounds the noise of both;
     * at five seeds it is not resolvable, and the table says so. The two ordinary paired
     * comparisons underneath it are another matter: whether removing the swap helps, with the chain
     * present and with it absent, is a per-seed sign that can be counted. Counting is reported
     * beside the contrast so that a reader sees which statement the design supports and which it
     * does not.
     */
    swapHelpsWithChain: seeds.filter((s) => noSwap.get(s) < full.get(s)).length,
    swapHelpsWithoutChain: seeds.filter((s) => both.get(s) < noChain.get(s)).length,
    /**
     * How many paired seeds would it take? A rough normal-approximation sample size for a paired
     * two-sided test at 80 % power and alpha = 0.05, n = ((z_{a/2} + z_b) * sd / mean)^2 with the
     * constant taken as 2.8. It is an order-of-magnitude statement and is labelled as one in the
     * paper: the point is the difference between "a few more seeds" and "hundreds", which is a
     * decision about whether the experiment is worth running at all.
     */
    contrastMean: mean(rel),
    contrastSd: Math.sqrt(rel.reduce((a, x) => a + (x - mean(rel)) ** 2, 0) / (rel.length - 1)),
    get seedsNeeded() {
      return Math.ceil(((2.8 * this.contrastSd) / Math.abs(this.contrastMean)) ** 2);
    }
  });
}

const sgn = (x, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const thin = (x) => Math.round(x).toLocaleString('en-US').replace(',', '\\,');

let tex = '% generated by interaction.mjs\n\\begin{table*}[t]\n\\centering\n';
// The caption's statement about what the test can and cannot reach is computed from the panels
// themselves. It was once a hand-typed "with five seeds ... p = 0.0625"; the batch grew and the
// sentence did not, which is the failure mode the companion measurement paper collects. The floor
// of an exact two-sided signed-rank test on $k$ non-zero differences is $2/2^k$.
const floorFor = (k) => 2 / 2 ** k;
const seedCounts = panels.map((p) => p.seeds.length);
const floorPhrase = panels
  .map((p) => `$${p.seeds.length}$ seeds at $n = ${thin(p.n)}$ put its floor at ` +
    `$p = ${floorFor(p.seeds.length).toFixed(4).replace(/0+$/, '')}$`)
  .join(', and ');
tex += '\\caption{Do two leave-one-out contributions add? Each panel holds the complete solver, ' +
  'the two single-mechanism removals, and the cell with both removed --- same instances, same ' +
  'seeds, same move budget. $\\Delta$ is the median soft cost against the complete solver at that ' +
  'size. The interaction contrast is per seed, ' +
  '$I = (\\textrm{both} - \\textrm{no chain}) - (\\textrm{no swap} - \\textrm{full})$, expressed as ' +
  'a share of that seed\'s own complete-solver cost; it is zero when the two losses add. Each ' +
  'panel\'s medians are taken over the seeds \\emph{this} cell carries, which is more than the ' +
  'leave-one-out batch received, so a configuration\'s entry here may differ by a few tenths of a ' +
  'point from the same configuration in Table~\\ref{tab:ablation-moves}; the two are the same ' +
  'experiment on different sample sizes and neither is a correction of the other. An exact ' +
  'two-sided signed-rank test cannot report a $p$ below $2/2^{k}$ on $k$ paired seeds --- ' +
  `${floorPhrase} --- so the test is reported as a consistency check and never as the basis of a ` +
  'claim, and the per-seed contrasts are given in full so that a reader can judge the spread ' +
  'directly.}\n';
tex += '\\label{tab:interaction}\n\\small\n\\begin{tabular}{@{}lrr@{}}\n\\toprule\n';
tex += 'configuration & ' + panels.map((p) => `$n = ${thin(p.n)}$`).join(' & ') + ' \\\\\n\\midrule\n';
const rowFor = (label, f) => `${label} & ${panels.map(f).join(' & ')} \\\\\n`;
tex += rowFor('complete solver (median soft)', (p) => `${med(p.seeds.map((s) => p.full.get(s)))}`);
tex += rowFor('without targeted swap', (p) => `${sgn(p.dSwap)}\\,\\%`);
tex += rowFor('without ejection chain', (p) => `${sgn(p.dChain)}\\,\\%`);
tex += rowFor('without either', (p) => `\\textbf{${sgn(p.dBoth)}\\,\\%}`);
tex += '\\addlinespace\n';
tex += rowFor('if the two losses added', (p) => `${sgn(p.dSwap + p.dChain)}\\,\\%`);
tex += rowFor('interaction, median of per-seed $I$',
  (p) => `${sgn(med(p.rel))}\\,\\%`);
tex += rowFor('per-seed $I$', (p) => `{\\footnotesize ${p.rel.map((x) => sgn(x, 0)).join(', ')}}`);
tex += rowFor('signed-rank $p$ (floor $0.0625$)', (p) => `${p.test.p.toFixed(4)}`);
tex += '\\addlinespace\n';
tex += rowFor("chain's loss with swap present", (p) => `${sgn(p.dChain)}\\,\\%`);
tex += rowFor("chain's loss with swap already removed", (p) => `${sgn(p.chainGivenNoSwap)}\\,\\%`);
tex += '\\addlinespace\n';
tex += rowFor('seeds on which dropping swap helps, chain present',
  (p) => `${p.swapHelpsWithChain}/${p.seeds.length}`);
tex += rowFor('seeds on which dropping swap helps, chain absent',
  (p) => `${p.swapHelpsWithoutChain}/${p.seeds.length}`);
tex += '\\bottomrule\n\\end{tabular}\n\\end{table*}\n';
writeFileSync(`${OUT}/interaction.tex`, tex);

const WORD = ['Mid', 'Big'];
let facts = '% generated by interaction.mjs\n';
panels.forEach((p, i) => {
  const w = WORD[i] ?? `P${i}`;
  facts += `\\newcommand{\\intSwap${w}}{${sgn(p.dSwap)}}\n`;
  facts += `\\newcommand{\\intChain${w}}{${sgn(p.dChain)}}\n`;
  facts += `\\newcommand{\\intBoth${w}}{${sgn(p.dBoth)}}\n`;
  facts += `\\newcommand{\\intAdditive${w}}{${sgn(p.dSwap + p.dChain)}}\n`;
  facts += `\\newcommand{\\intContrast${w}}{${sgn(med(p.rel))}}\n`;
  facts += `\\newcommand{\\intP${w}}{${p.test.p.toFixed(3)}}\n`;
  facts += `\\newcommand{\\intChainAlone${w}}{${sgn(p.chainGivenNoSwap)}}\n`;
  facts += `\\newcommand{\\intN${w}}{${thin(p.n)}}\n`;
});
/**
 * How much of the chain's headline contribution is the chain being useful BECAUSE the swap is
 * there: 1 - (loss against a swapless solver) / (loss against the complete solver). This is the
 * quantity the discussion paragraph is actually about, and it was once written as the hand-typed
 * phrase "between a third and two fifths" --- which was true of one batch and stopped being true
 * when the next seed landed. Emitted as per-panel percentages plus the range's endpoints so the
 * sentence can be built from macros alone.
 */
/**
 * How the estimate moved as seeds arrived.
 *
 * The chain's loss against a swapless solver is a difference of two medians, and medians over five
 * paired seeds are not stable objects. Rather than assert that in the text, we print the prefix
 * trace: the value the paper would have quoted had the batch stopped at k seeds, for k from five up
 * to what we have. At the larger size it read +6.3, then one more seed took it to +3.5, and the
 * full ten settled near the smaller size's answer. A reader who wants to know how much to trust a
 * five-seed cell in anybody's paper can read that sequence instead of being told.
 */
const prefixTrace = (p) => {
  const out = [];
  for (let k = 5; k <= p.seeds.length; k++) {
    const ss = p.seeds.slice(0, k);
    const m = (map) => med(ss.map((s) => map.get(s)));
    const base = m(p.full);
    const d = (map) => (100 * (m(map) - base)) / base;
    out.push(d(p.both) - d(p.noSwap)); // chain's loss with the swap already removed
  }
  return out;
};
const shares = panels.map((p) => 100 * (1 - p.chainGivenNoSwap / p.dChain));
panels.forEach((p, i) => {
  const t = prefixTrace(p);
  const w = WORD[i] ?? `P${i}`;
  facts += `\\newcommand{\\intTrace${w}}{${t.map((x) => sgn(x)).join(', ')}}\n`;
  facts += `\\newcommand{\\intTraceFive${w}}{${sgn(t[0])}}\n`;
  facts += `\\newcommand{\\intTraceLast${w}}{${sgn(t[t.length - 1])}}\n`;
  facts += `\\newcommand{\\intTraceLo${w}}{${sgn(Math.min(...t))}}\n`;
  facts += `\\newcommand{\\intTraceHi${w}}{${sgn(Math.max(...t))}}\n`;
  facts += `\\newcommand{\\intTraceSwing${w}}{${(Math.max(...t) - Math.min(...t)).toFixed(1)}}\n`;
});
panels.forEach((p, i) => {
  facts += `\\newcommand{\\intShare${WORD[i] ?? `P${i}`}}{${shares[i].toFixed(0)}}\n`;
});
facts += `\\newcommand{\\intShareLo}{${Math.min(...shares).toFixed(0)}}\n`;
facts += `\\newcommand{\\intShareHi}{${Math.max(...shares).toFixed(0)}}\n`;
// The two sizes' contrast dispersions, as a ratio, for the sentence that compares them.
const sds = panels.map((p) => p.contrastSd);
facts += `\\newcommand{\\intSdRatio}{${(Math.max(...sds) / Math.min(...sds)).toFixed(1)}}\n`;
// The direction, as a word, so the prose cannot outrun the data if a rerun moves it.
const allNeg = panels.every((p) => med(p.rel) < 0);
const allPos = panels.every((p) => med(p.rel) > 0);
facts += `\\newcommand{\\intDirection}{${allNeg ? 'complement each other' : allPos ? 'substitute for each other' : 'do not agree across sizes'}}\n`;
facts += `\\newcommand{\\intSizes}{${panels.length}}\n`;
facts += `\\newcommand{\\intSeeds}{${panels[0]?.seeds.length ?? 0}}\n`;
panels.forEach((p, i) => {
  const w = WORD[i] ?? `P${i}`;
  facts += `\\newcommand{\\intSignWith${w}}{${p.swapHelpsWithChain}/${p.seeds.length}}\n`;
  facts += `\\newcommand{\\intSignWithout${w}}{${p.swapHelpsWithoutChain}/${p.seeds.length}}\n`;
});
facts += `\\newcommand{\\intSignWithoutAll}{${panels.reduce((a, p) => a + p.swapHelpsWithoutChain, 0)}/${panels.reduce((a, p) => a + p.seeds.length, 0)}}\n`;
// Whether the contrast is resolvable at this sample size, as a word: every p here is above its own
// floor, and a paper that says "no interaction" when it means "no power" is the failure this
// series is about.
facts += `\\newcommand{\\intResolvable}{${panels.every((p) => p.test.p > 0.0625) ? 'not resolvable' : 'resolvable'}}\n`;
panels.forEach((p, i) => {
  const w = WORD[i] ?? `P${i}`;
  facts += `\\newcommand{\\intSeeds${w}}{${p.seeds.length}}\n`;
  facts += `\\newcommand{\\intFloor${w}}{${floorFor(p.seeds.length).toFixed(4).replace(/0+$/, '')}}\n`;
  facts += `\\newcommand{\\intSd${w}}{${p.contrastSd.toFixed(0)}}\n`;
  facts += `\\newcommand{\\intNeeded${w}}{${p.seedsNeeded >= 100 ? `${Math.round(p.seedsNeeded / 100) * 100}` : `${p.seedsNeeded}`}}\n`;
});
writeFileSync(`${OUT}/interaction-facts.tex`, facts);
/**
 * The measurement paper quotes this cell too, as its checklist item on two-factor cells. It used to
 * quote it in hand-typed digits, which survived exactly as long as the batch did: a sixth seed
 * moved the chain's swapless loss and left two papers disagreeing about the same experiment. The
 * same macros are therefore written into that paper's figures directory, so both documents read one
 * generated file and a re-run cannot desynchronise them.
 */
const SIBLING = null;
if (SIBLING && pathExists(SIBLING)) {
  writeFileSync(`${SIBLING}/interaction-facts.tex`, facts);
  console.log(`wrote ${SIBLING}/interaction-facts.tex (same macros, for the measurement paper)`);
}

for (const p of panels) {
  console.log(`n=${p.n} (budget ${p.moveBudget}, ${p.seeds.length} seeds)`);
  console.log(`  no-swap ${sgn(p.dSwap)}%   no-chain ${sgn(p.dChain)}%   both ${sgn(p.dBoth)}%   additive ${sgn(p.dSwap + p.dChain)}%`);
  console.log(`  interaction per seed: ${p.rel.map((x) => sgn(x, 1)).join(', ')}  median ${sgn(med(p.rel))}%  p=${p.test.p.toFixed(4)}`);
  console.log(`  chain's loss: ${sgn(p.dChain)}% with swap, ${sgn(p.chainGivenNoSwap)}% without it`);
}
console.log(`\nwrote ${OUT}/interaction.tex and interaction-facts.tex`);
