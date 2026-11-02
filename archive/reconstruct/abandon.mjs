/**
 * abandon.mjs — runs that reach feasibility, leave it, and never come back.
 *
 * WHERE THIS CAME FROM. Deepening the size ladder from five seeds to ten put two runs at
 * n = 31,000 into the results with a soft cost an order of magnitude above their own cell's median
 * (38,674 and 38,193 against medians near 3,700) while reporting zero hard violations. Neither is a
 * scoring error and neither is an infeasible run: the validator agrees the returned schedule is
 * feasible. What happened is visible only in the convergence samples the harness records once a
 * second.
 *
 * THE SIGNATURE, AND A CORRECTION TO OUR FIRST READING OF IT. In these runs the incumbent objective
 * stops changing about a fifth of the way in and never changes again, while the *current* state
 * wanders at twelve to sixteen thousand hard violations for the rest of the budget. The search left
 * the feasible region, the acceptance rule kept accepting, and the descent never pulled it back;
 * what gets reported is whichever feasible schedule was incumbent at the moment of departure.
 *
 * The first version of this script stopped there and called the departure itself the failure. That
 * was wrong, and the data says so plainly once every batch is swept rather than the one that
 * prompted the question. DEPARTURE IS COMMON: 69 of 435 traced runs end outside the feasible
 * region, and under a wall clock at the smaller sizes it is the normal ending, not the exception.
 * It is almost always FREE --- the median departing run's soft cost is 1.00x its own cell median,
 * because by the time the search wanders off the incumbent is already as good as that cell ever
 * gets. What is rare is departing EARLY, before the incumbent has been polished. Three runs do
 * that, and they cost nine to eleven times their cell median.
 *
 * So the quantity to report is not "did the search leave" but "did it leave before it was
 * finished", and the two are separated here rather than conflated.
 *
 * WHY IT MATTERS FOR THE METHOD AND NOT ONLY FOR THE SOLVER. Five seeds per cell did not contain
 * one of these. Ten seeds contain three across the whole study. A median over ten is unaffected by
 * one such run --- which is why every headline in the paper survives --- and a mean would have been
 * destroyed by it. The failure is therefore invisible in exactly the statistic the paper reports,
 * and the only reason we know it exists is that the deepening happened for an unrelated reason and
 * the per-seed values are published.
 *
 * DETECTION, in two parts, stated so both can be argued with.
 *
 *   DEPARTED: the run returns a feasible schedule but the state it was exploring when the budget
 *   expired carries hard violations (median of the last five samples, so a single sample of a
 *   wandering walk cannot decide it).
 *
 *   COSTLY: departed, and the returned soft cost is more than twice its own cell's median.
 *
 * The 2x factor is not a threshold the data is sensitive to: the regret distribution among departed
 * runs is 1.00x at the median, 1.26x at the ninetieth percentile, and then 9.1x, 10.3x, 10.7x. Any
 * cut-off between 1.5 and 9 gives the same three runs. Infeasible runs are excluded throughout
 * because a configuration that never reaches feasibility at all --- L = 5,000 does this everywhere
 * --- is already reported as infeasible and would swamp both counts.
 *
 * Run: node abandon.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'records');
const PAPERS = [join(HERE, '..'), join(HERE, '..', 'articles')]
  .find((d) => existsSync(join(d, 'timetable-generation'))) ?? join(HERE, '..');
const OUT = process.argv[2] ?? join(HERE, '..', 'reconstructed');
mkdirSync(OUT, { recursive: true });

/**
 * EVERY batch, move-bounded and wall-clock alike.
 *
 * The first version read the move-bounded files only, on the reasoning that the wall-clock ones are
 * a different budget type and mixing them would make the denominator mean two things. That was a
 * mistake of exactly the kind this series collects: the excluded files are where the phenomenon is
 * COMMON, and looking only at the batch that raised the question made a frequent event look like a
 * rare one. The two budget types are reported separately below rather than merged.
 *
 * `ablation-contaminated.jsonl` stays out: those runs are retained as an artefact of the drift
 * incident and are not part of any reported experiment.
 */
const FILES = ['ablation-moves.jsonl', 'ablation-twofactor.jsonl', 'ablation-deep12800.jsonl',
  'ablation-deep3200.jsonl', 'ablation-20k.jsonl', 'ablation-31k.jsonl',
  'ablation-time.jsonl', 'ablation-time120.jsonl', 'ablation-time300.jsonl',
  'ablation-t30-3200.jsonl', 'ablation-t120-3200.jsonl', 'ablation-t300-3200.jsonl',
  'ablation-t60-6400.jsonl', 'ablation-t180-6400.jsonl'];

const seen = new Set();
const rows = FILES.filter((f) => existsSync(join(RESULTS, f)))
  .flatMap((f) => readFileSync(join(RESULTS, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((r) => {
    const k = `${r.config}|${r.n}|${r.seed}|${r.moveBudget ?? r.timeMs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Share of the recorded samples over which the incumbent objective never changed, counted back
 *  from the end of the run. */
const terminalFreeze = (r) => {
  const s = r.samples ?? [];
  if (s.length < 10) return null;
  const last = s[s.length - 1].objective;
  let i = s.length - 1;
  while (i > 0 && s[i - 1].objective === last) i--;
  return (s.length - i) / s.length;
};

const traced = rows.filter((r) => terminalFreeze(r) !== null);
const feasible = traced.filter((r) => r.feasible);

/** Hard violations in the state the search was exploring when the budget expired. */
const finalHard = (r) => {
  const tail = r.samples.slice(-5).map((x) => x.hard);
  return med(tail);
};
const departed = feasible.filter((r) => finalHard(r) > 0);

// Cell medians, so each run can be quoted against the cell it belongs to. The budget is part of the
// key: the same configuration at the same size under two budgets is two cells.
const budgetOf = (r) => r.moveBudget ?? r.timeMs;
const cellMedian = (r) => med(feasible
  .filter((x) => x.n === r.n && x.config === r.config && budgetOf(x) === budgetOf(r))
  .map((x) => x.soft));
const regret = (r) => r.soft / cellMedian(r);

const COSTLY = 2;
const abandoned = departed.filter((r) => regret(r) > COSTLY);

/** Departure rate by budget type, which is where the two populations differ most. */
const byBudget = new Map();
for (const r of feasible) {
  const k = r.budget === 'moves' ? 'moves' : 'time';
  const e = byBudget.get(k) ?? { k, total: 0, dep: 0, costly: 0 };
  e.total++;
  if (finalHard(r) > 0) e.dep++;
  if (finalHard(r) > 0 && regret(r) > COSTLY) e.costly++;
  byBudget.set(k, e);
}

const bySize = new Map();
for (const r of feasible) {
  const e = bySize.get(r.n) ?? { n: r.n, total: 0, bad: 0 };
  e.total++;
  if (finalHard(r) > 0 && regret(r) > COSTLY) e.bad++;
  bySize.set(r.n, e);
}
const sizes = [...bySize.values()].sort((a, b) => a.n - b.n);

const thin = (x) => Math.round(x).toLocaleString('en-US').replace(/,/g, '\\,');
const pct = (x) => (100 * x).toFixed(0);

let tex = '% generated by abandon.mjs — do not edit\n';
tex += '\\begin{table}[t]\n\\centering\n';
tex += '\\caption{Runs that reached feasibility, left it, and did not return. Every row is a run ' +
  'the validator calls feasible: the reported schedule satisfies every hard constraint. The ' +
  '\\emph{frozen} column is the share of the run over which the incumbent never changed, and the ' +
  'final-state column is the hard-violation count of the state the search was actually exploring ' +
  'when the budget ran out. A median over ten seeds is unmoved by one of these; a mean is ' +
  'destroyed by it; five seeds contained none of them.}\n';
tex += '\\label{tab:abandon}\n\\small\n\\begin{tabular}{@{}lrrrrrr@{}}\n\\toprule\n';
tex += 'configuration & $n$ & seed & soft & cell median & frozen & final state \\\\\n\\midrule\n';
for (const r of abandoned.sort((a, b) => a.n - b.n || a.seed - b.seed)) {
  // The hard-violation count of the state the search was exploring when the budget expired, as a
  // median over the last five samples: a single sample would be a snapshot of a wandering walk.
  const tail = r.samples.slice(-5).map((x) => x.hard);
  tex += `${r.config} & ${thin(r.n)} & ${r.seed} & ${thin(r.soft)} & ${thin(cellMedian(r))} & ` +
    `${pct(terminalFreeze(r))}\\,\\% & ${thin(med(tail))} \\\\\n`;
}
tex += '\\bottomrule\n\\end{tabular}\n\\end{table}\n';
writeFileSync(`${OUT}/abandon.tex`, tex);

let facts = '% generated by abandon.mjs\n';
facts += `\\newcommand{\\abandonCount}{${abandoned.length}}\n`;
facts += `\\newcommand{\\abandonTotal}{${feasible.length}}\n`;
facts += `\\newcommand{\\abandonWorstSoft}{${thin(Math.max(...abandoned.map((r) => r.soft)))}}\n`;
facts += `\\newcommand{\\abandonWorstRatio}{${Math.round(Math.max(...abandoned.map((r) => r.soft / cellMedian(r))))}}\n`;
facts += `\\newcommand{\\abandonFrozenLo}{${pct(Math.min(...abandoned.map(terminalFreeze)))}}\n`;
facts += `\\newcommand{\\abandonFrozenHi}{${pct(Math.max(...abandoned.map(terminalFreeze)))}}\n`;
facts += `\\newcommand{\\abandonMedianFreeze}{${(100 * med(feasible.map(terminalFreeze))).toFixed(1)}}\n`;
// The separation the corrected reading rests on: departure is common and free, costly departure is
// rare. Both denominators are printed so a reader can see which population each rate belongs to.
facts += `\\newcommand{\\departCount}{${departed.length}}\n`;
facts += `\\newcommand{\\departRegretMedian}{${med(departed.map(regret)).toFixed(2)}}\n`;
const sortedRegret = departed.map(regret).sort((a, b) => b - a);
facts += `\\newcommand{\\departRegretNinetieth}{${sortedRegret[Math.floor(sortedRegret.length / 10)].toFixed(2)}}\n`;
facts += `\\newcommand{\\abandonRegretLo}{${Math.min(...abandoned.map(regret)).toFixed(1)}}\n`;
facts += `\\newcommand{\\abandonRegretHi}{${Math.max(...abandoned.map(regret)).toFixed(1)}}\n`;
/**
 * THE THRESHOLD'S OWN JUSTIFICATION, GENERATED RATHER THAN TYPED.
 *
 * The 2x cut-off is defensible only because the regret distribution is empty on both sides of it:
 * ordinary departures sit near 1 and costly ones start several times higher, so every cut-off in
 * the gap selects the same runs and the choice of 2 carries no weight. That is a claim about the
 * data, and the data grows. The first version of this file typed the three costly regrets into the
 * paper by hand along with the sentence "any cut-off between 1.5 and 9"; the n = 20,000 batch then
 * added a fourth costly run at 6.8, which shrank the gap to [1.26, 6.8] and would have left a
 * hand-typed interval asserting emptiness across a region that now contains a point. The interval
 * is therefore computed from the two runs that bound it, and the list is printed in full so a
 * reader can see how much room the choice actually has.
 */
const costlyRegrets = abandoned.map(regret).sort((a, b) => a - b);
const ordinaryHi = Math.max(...departed.filter((r) => regret(r) <= COSTLY).map(regret));
const enumerate = (xs) => (xs.length < 2 ? xs.join('')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
facts += `\\newcommand{\\abandonRegretList}{${enumerate(costlyRegrets.map((x) => x.toFixed(1)))}}\n`;
facts += `\\newcommand{\\abandonGapLo}{${ordinaryHi.toFixed(2)}}\n`;
facts += `\\newcommand{\\abandonGapHi}{${costlyRegrets[0].toFixed(1)}}\n`;
for (const e of byBudget.values()) {
  const w = e.k === 'moves' ? 'Moves' : 'Time';
  facts += `\\newcommand{\\depart${w}}{${e.dep} of ${e.total}}\n`;
  facts += `\\newcommand{\\abandon${w}}{${e.costly} of ${e.total}}\n`;
}
facts += `\\newcommand{\\abandonSizes}{${enumerate([...new Set(abandoned.map((r) => thin(r.n)))])}}\n`;
// LaTeX macro names cannot contain digits, so the per-size macros are named by position on the
// ladder rather than by n. The mapping is asserted rather than assumed: a fifth size would
// otherwise silently produce \abandonAtundefined, which is the failure the dispersion analysis in
// the companion portfolio paper already paid for once.
/**
 * Named by SIZE, not by position on the sorted list.
 *
 * The first version keyed the names off the sorted index, and adding the wall-clock files --- which
 * bring an n = 6,400 the move-bounded batches do not have --- silently shifted every name by one
 * from the third position on. `\abandonAtMid` would have gone on meaning something and started
 * meaning a different size, which is undetectable in the built PDF. The assertion below is what
 * caught it, and the map is now explicit so that a new size fails loudly instead of renaming its
 * neighbours.
 */
const WORD = { 3200: 'Small', 6400: 'Lower', 12800: 'Mid', 20000: 'Upper', 31000: 'Top' };
const unnamed = sizes.filter((s) => !WORD[s.n]);
if (unnamed.length) {
  throw new Error(`no macro name for n = ${unnamed.map((s) => s.n).join(', ')}: add it to WORD. ` +
    'Names are keyed by size, never by position, so that adding a size cannot rename another one.');
}
for (const s of sizes) {
  facts += `\\newcommand{\\abandonAt${WORD[s.n]}}{${s.bad} of ${s.total}}\n`;
  facts += `\\newcommand{\\abandonN${WORD[s.n]}}{${thin(s.n)}}\n`;
}
/**
 * Which sizes are affected, as a list rather than as a count of "the largest k".
 *
 * The paper said "all at the two largest sizes" while that was true; the n = 20,000 batch made it
 * three and the sentence would have stayed at two, which is the same class of error as the typed
 * regret interval above. A generated list cannot go stale, and it also stops the claim from
 * hardening into "the largest sizes" as a rule: what the data supports is that these particular
 * sizes have one and those do not.
 */
const hit = sizes.filter((s) => s.bad > 0);
const clean = sizes.filter((s) => s.bad === 0);
facts += `\\newcommand{\\abandonSizesHit}{${enumerate(hit.map((s) => thin(s.n)))}}\n`;
facts += `\\newcommand{\\abandonSizesClean}{${enumerate(clean.map((s) => thin(s.n)))}}\n`;
facts += `\\newcommand{\\abandonHitCount}{${hit.length}}\n`;
facts += `\\newcommand{\\abandonCleanCount}{${clean.length}}\n`;
facts += `\\newcommand{\\abandonAtHit}{${enumerate(hit.map((s) => `${s.bad} of ${s.total}`))}}\n`;
facts += `\\newcommand{\\abandonAtClean}{${enumerate(clean.map((s) => `${s.bad} of ${s.total}`))}}\n`;
/**
 * WOULD THE STUDY AS ORIGINALLY DESIGNED HAVE CONTAINED ONE OF THESE?
 *
 * That is the question the finding turns on, and "is the seed at most five" is not it. The original
 * leave-one-out design was five seeds per cell at two sizes; the larger sizes were added later, for
 * the cross-size comparison, and their runs are not runs the first design would have made. So two
 * counts are emitted and they mean different things. `\abandonInFirstFive` is the plain seed count,
 * which the n = 20,000 batch moved from zero to one. `\abandonInOriginal` restricts to the cells the
 * first design actually had --- the two smallest sizes at seeds one to five --- and is the number
 * that supports the claim about what we would have shipped. Keeping only the first would have let a
 * new size quietly falsify a sentence about an old design; keeping only the second would let us
 * define the awkward run out of existence. Both are printed and the paper uses each where it fits.
 */
const inFirstFive = abandoned.filter((r) => r.seed <= 5).length;
const ORIGINAL_SIZES = [3200, 12800];
const inOriginal = abandoned.filter((r) => r.seed <= 5 && ORIGINAL_SIZES.includes(r.n)).length;
facts += `\\newcommand{\\abandonInFirstFive}{${inFirstFive}}\n`;
facts += `\\newcommand{\\abandonInOriginal}{${inOriginal}}\n`;
facts += `\\newcommand{\\abandonOriginalSizes}{${enumerate(ORIGINAL_SIZES.map(thin))}}\n`;
facts += `\\newcommand{\\abandonConfigs}{${enumerate([...new Set(abandoned.map((r) => r.config))])}}\n`;
/**
 * The mechanism claim, asserted rather than trusted.
 *
 * The paper explains costly departure by the acceptance history: a run that keeps a long record of
 * recent costs will accept a drift out of feasibility that a shorter one rejects, so every costly
 * departure should carry the default L and none should come from the shortened-history arms. That
 * is a falsifiable prediction about which rows can appear here, and it is worth failing on rather
 * than discovering by reading a rebuilt table. If a `greedy-accept` or `short-history` run ever
 * abandons, the explanation in the paper is wrong and the build should stop until it is rewritten.
 */
const SHORT_HISTORY_ARMS = ['greedy-accept', 'short-history'];
const contradicting = abandoned.filter((r) => SHORT_HISTORY_ARMS.includes(r.config));
if (contradicting.length) {
  throw new Error(
    `costly departure in a shortened-history configuration: ` +
    contradicting.map((r) => `${r.config} n=${r.n} seed=${r.seed}`).join('; ') +
    '. The paper explains this failure by the length of the acceptance history, and that ' +
    'explanation predicts these arms cannot appear here. Rewrite the explanation before rebuilding.');
}
writeFileSync(`${OUT}/abandon-facts.tex`, facts);
/**
 * The measurement paper reports this as an incident, so it reads the same generated file rather
 * than a transcription --- the rule the interaction cell earned the hard way when a sixth seed left
 * two papers quoting different values for one experiment.
 */
/**
 * Every paper in the series that cites this failure reads the same generated file.
 *
 * Four do: the solver paper that owns the finding, the measurement paper that reports it as an
 * incident, and the portfolio and modelling papers, which each cite the cost range in one sentence
 * while describing what their own data can and cannot say about it. Those last two had the range
 * typed --- "nine to eleven times" --- which was true when written and stopped being true the
 * moment a fourth costly run at 6.8 arrived from the last batch of the study. One shared file is
 * the only arrangement under which a number cannot be right in one paper and wrong in the next,
 * and this collection has already paid once for learning that.
 */
const CITING = ['benchmark-inversion', 'browser-optimisation', 'domain-model'];
for (const paper of CITING) {
  const dir = join(PAPERS, paper, 'figures');
  if (!existsSync(dir)) continue;
  writeFileSync(`${dir}/abandon-facts.tex`, facts);
  console.log(`wrote ${dir}/abandon-facts.tex (same macros)`);
}

for (const e of byBudget.values()) {
  console.log(`${e.k.padEnd(5)} budget: ${e.dep} of ${e.total} depart, ${e.costly} costly`);
}
console.log(`departure regret: median ${med(departed.map(regret)).toFixed(2)}x, worst ` +
  `${Math.max(...departed.map(regret)).toFixed(1)}x`);
console.log(`${abandoned.length} costly of ${feasible.length} feasible traced runs ` +
  `(median terminal freeze ${(100 * med(feasible.map(terminalFreeze))).toFixed(1)}%)`);
for (const r of abandoned) {
  console.log(`  n=${r.n} ${r.config} seed ${r.seed}: soft ${r.soft} vs cell median ` +
    `${cellMedian(r)}, frozen ${pct(terminalFreeze(r))}%`);
}
for (const s of sizes) console.log(`  n=${s.n}: ${s.bad} of ${s.total}`);
console.log(`in the original five seeds: ${inFirstFive}`);
console.log(`wrote ${OUT}/abandon.tex and abandon-facts.tex`);
