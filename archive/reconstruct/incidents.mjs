#!/usr/bin/env node
/**
 * Tables and data files for the methodology article (article 4).
 *
 * The point of this script is that the methodology paper's numbers come from the same files as the
 * algorithm paper's, by the same route. A paper about measurement discipline that transcribed its
 * own figures by hand would be arguing against itself.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// Paths resolve from this file's own location, so the tree can be copied anywhere — the papers ship
// with `_scripts/` beside them and a reader should be able to rebuild every table without editing
// a path. RESULTS is `<script dir>/results`; PAPERS is the article root, one level up.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync as pathExists } from 'node:fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'records');
// Two layouts must both work: the papers ship with `_scripts/` beside them, and the sandbox keeps
// the harness in its own directory alongside `articles/`. Probe for a paper folder rather than
// assuming either.
const PAPERS = [join(HERE, '..'), join(HERE, '..', 'articles')]
  .find((d) => pathExists(join(d, 'timetable-generation'))) ?? join(HERE, '..');


const OUT = process.argv[2] ?? join(HERE, '..', 'reconstructed');
mkdirSync(OUT, { recursive: true });

const load = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

const contaminated = load(join(RESULTS, 'ablation-contaminated.jsonl'));
const moves = load(join(RESULTS, 'ablation-moves.jsonl'));

/**
 * The central table of the paper: the same nine configurations, measured three ways, with the
 * *null* configuration marked.
 *
 * `no-rcl` at n=3200 is behaviourally identical to `full` — the instance has 167 rooms and the
 * solver scans every room whenever the domain is below 256, so the option that shortens the scan
 * never engages. Whatever that row reports is therefore that batch's observed null-control
 * deviation and not an effect: the only calibration in the study known to be exactly zero. It is
 * NOT a noise floor, and the caption no longer calls it one — one null arm shows what a batch can
 * manufacture, it does not estimate the distribution of what it manufactures.
 */
const NULLROW = 'no-rcl';
const ORDER = ['full', 'no-chain', 'no-taper', 'no-hot', 'no-rcl', 'no-swap',
  'fixed-weight', 'short-history', 'long-history'];
const LABEL = {
  full: 'complete solver (baseline)',
  'no-chain': 'ejection chain removed',
  'no-taper': 'chain never switched off',
  'no-hot': 'min-conflicts selection removed',
  'no-rcl': '\\textbf{restricted candidate list removed}',
  'no-swap': 'targeted swap removed',
  'fixed-weight': 'fixed hard-violation price',
  'short-history': 'short acceptance history',
  'long-history': 'long acceptance history'
};

function view(rows, filter) {
  const g = new Map();
  for (const r of rows.filter(filter)) {
    const k = r.config === 'greedy-accept' ? 'short-history' : r.config;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  const out = new Map();
  for (const [k, a] of g) {
    out.set(k, {
      feasible: a.filter((r) => r.feasible).length, n: a.length,
      soft: med(a.map((r) => r.soft)), mps: Math.round(mean(a.map((r) => r.movesPerSec)))
    });
  }
  return out;
}

const v30 = view(contaminated, (r) => r.n === 3200 && r.timeMs === 30000);
const v60 = view(contaminated, (r) => r.n === 3200 && r.timeMs === 60000);
const vmv = view(moves, (r) => r.n === 3200 && r.budget === 'moves' && r.config !== 'greedy-accept');

const delta = (m, cfg) => {
  const base = m.get('full'), row = m.get(cfg);
  if (!base || !row || row.feasible < row.n) return null;
  return (100 * (row.soft - base.soft)) / base.soft;
};
const fmt = (d) => (d === null ? '\\emph{infeas.}' : `${d >= 0 ? '+' : ''}${d.toFixed(1)}`);

// The caption states which configurations were feasible everywhere and which nowhere. Both are
// read out of the three views, and both are asserted, because a caption that describes the data by
// hand is the same hazard as a table of numbers typed by hand.
const VIEWS = [v30, v60, vmv];
const runsSeen = new Set(VIEWS.flatMap((m) => [...m.values()].map((r) => r.n)));
if (runsSeen.size !== 1) {
  throw new Error(`the three batches do not share a run count: ${[...runsSeen].join(', ')}`);
}
const RUNS = [...runsSeen][0];
const INFEASIBLE = ORDER.filter((cfg) =>
  VIEWS.some((m) => m.get(cfg) && m.get(cfg).feasible < m.get(cfg).n));
for (const cfg of INFEASIBLE) {
  const partial = VIEWS.filter((m) => m.get(cfg) && m.get(cfg).feasible > 0);
  if (partial.length) {
    throw new Error(`${cfg} is feasible in some runs but not all; the caption says "feasible in ` +
      'none", which would be wrong. Reword the caption and this check together.');
  }
}
if (!INFEASIBLE.length) {
  throw new Error('no configuration is infeasible any more; the caption clause about it is stale');
}

let tex = '% generated by incidents.mjs\n\\begin{table*}[t]\n\\centering\n';
/**
 * The row count is `ORDER.length`, so the caption asks the list rather than the author.
 *
 * It read "the same nine configurations" as a literal, which was right when this table was built
 * and is a hand-typed count inside a generated caption --- the one place a paper's numbers are
 * least likely to be checked, since a caption reads as furniture rather than as a claim. A tenth
 * configuration would have left it saying nine, in the paper whose subject is exactly that.
 */
const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve'];
// A caption says what the table IS. Everything else it used to carry — what makes the bold row a
// null configuration, what its deviation does and does not estimate, why one row reports no soft
// cost — is argument, and argument belongs in the running text where a reader meets it in order.
// Rendered to Word, a caption of that length becomes a wall of prose sitting on top of the table.
// The two quantities that clause needed are emitted as macros below, so the sentence that now
// carries it in the text is still generated rather than typed.
tex += `\\caption{The same ${WORD[ORDER.length] ?? ORDER.length} configurations at ` +
  '$n=3200$, measured three ways: two discarded wall-clock batches, each executed configuration ' +
  'by configuration a few hours apart, and the move-bounded batch in randomised order. The row ' +
  'in bold is the null configuration.}\n';
tex += '\\label{tab:threeviews}\n\\small\n';
tex += '\\begin{tabular}{@{}lrrrrrr@{}}\n\\toprule\n';
tex += '& \\multicolumn{2}{c}{wall clock, 30\\,s, blocked} & \\multicolumn{2}{c}{wall clock, 60\\,s, blocked} ' +
  '& \\multicolumn{2}{c}{$1.5\\times10^6$ moves, shuffled} \\\\\n';
tex += '\\cmidrule(lr){2-3}\\cmidrule(lr){4-5}\\cmidrule(lr){6-7}\n';
tex += 'configuration & soft & $\\Delta\\,\\%$ & soft & $\\Delta\\,\\%$ & soft & $\\Delta\\,\\%$ \\\\\n\\midrule\n';
for (const cfg of ORDER) {
  const cells = [v30, v60, vmv].map((m) => {
    const row = m.get(cfg);
    if (!row) return ['---', '---'];
    // A configuration with no feasible run has no comparable soft cost. Printing its median soft
    // value under a column headed "soft", and "0/5" under one headed "delta %", says two things
    // that are not true: that the number is a soft cost of the same kind as the others, and that
    // the fraction is a percentage. The paper's own argument is that soft quality is only
    // comparable among feasible schedules, so the row says what it is instead.
    if (row.feasible < row.n) {
      return ['---', `\\emph{infeasible (${row.feasible}/${row.n})}`];
    }
    return [String(row.soft), cfg === 'full' ? '---' : fmt(delta(m, cfg))];
  });
  tex += `${LABEL[cfg]} & ${cells.flat().join(' & ')} \\\\\n`;
}
tex += '\\bottomrule\n\\end{tabular}\n\\end{table*}\n';
writeFileSync(`${OUT}/threeviews.tex`, tex);

// ── the noise floor, as a macro ─────────────────────────────────────────────
const floor30 = delta(v30, NULLROW), floor60 = delta(v60, NULLROW), floorMv = delta(vmv, NULLROW);
writeFileSync(`${OUT}/floors.tex`,
  '% generated by incidents.mjs\n' +
  `\\newcommand{\\floorThirty}{${floor30.toFixed(1)}}\n` +
  `\\newcommand{\\floorSixty}{${floor60.toFixed(1)}}\n` +
  `\\newcommand{\\floorMoves}{${floorMv.toFixed(1)}}\n` +
  // The feasibility clause moved out of the table caption and into the running text of the
  // execution-variability subsection. It stays generated: the run count and the name of the
  // configuration that never reached feasibility are both read from the result files, and the
  // guards above still refuse to emit a table if either goes stale.
  `\\newcommand{\\tvRuns}{${RUNS}}\n` +
  `\\newcommand{\\tvInfeasible}{${INFEASIBLE.map((x) => LABEL[x]).join(' and ')}}\n`);

// ── throughput spread within and across batches ─────────────────────────────
const rates = (rows, filter) => rows.filter(filter).map((r) => r.movesPerSec);
const spread = (a) => ({ min: Math.min(...a), max: Math.max(...a), med: Math.round(med(a)),
  ratio: (Math.max(...a) / Math.min(...a)).toFixed(2) });
const s30 = spread(rates(contaminated, (r) => r.n === 3200 && r.timeMs === 30000 && r.config === 'full'));
const s60 = spread(rates(contaminated, (r) => r.n === 3200 && r.timeMs === 60000 && r.config === 'full'));
const smv = spread(rates(moves, (r) => r.n === 3200 && r.config === 'full'));

let t2 = '% generated by incidents.mjs\n\\begin{table}[t]\n\\centering\n';
t2 += '\\caption{Move rate of the \\emph{same} configuration --- the complete solver, five seeds ---' +
  ' in three batches at $n=3200$. Nothing in the program differs between these rows. The spread ' +
  'within a batch is the machine, and the spread between batches is the machine on a different ' +
  'day.}\n\\label{tab:rates}\n\\small\n';
t2 += '\\begin{tabular}{@{}lrrrr@{}}\n\\toprule\nbatch & min & median & max & max/min \\\\\n\\midrule\n';
t2 += `wall clock, 30\\,s & ${s30.min} & ${s30.med} & ${s30.max} & ${s30.ratio} \\\\\n`;
t2 += `wall clock, 60\\,s & ${s60.min} & ${s60.med} & ${s60.max} & ${s60.ratio} \\\\\n`;
t2 += `move-bounded & ${smv.min} & ${smv.med} & ${smv.max} & ${smv.ratio} \\\\\n`;
t2 += '\\bottomrule\n\\end{tabular}\n\\end{table}\n';
writeFileSync(`${OUT}/rates.tex`, t2);

console.log('noise floor from the null configuration:',
  `30s ${floor30.toFixed(1)}%,`, `60s ${floor60.toFixed(1)}%,`, `moves ${floorMv.toFixed(1)}%`);
console.log('full-solver move rates:', { s30, s60, smv });
console.log(`wrote ${OUT}/threeviews.tex, rates.tex, floors.tex`);
