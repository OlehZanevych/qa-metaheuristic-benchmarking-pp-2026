#!/usr/bin/env node
/**
 * The all-incidents summary table for the journal version.
 *
 * The journal article narrates only some of the fourteen measurement failures and would otherwise
 * lose the rest entirely. This table keeps every one visible at a fraction of the length: what
 * layer it belongs to, what the fault was, what wrong inference it would have supported, and the
 * cheapest check that would have caught it. How many are narrated is a property of the `narrated`
 * flags below and is emitted as a macro, not written into this comment or into the caption, for
 * the same reason the count itself is not.
 *
 * The rows are prose and cannot be derived from a results file — they are descriptions, not
 * measurements. What CAN be checked, and is, is that there are exactly as many of them as the paper
 * says there are, and that the ones described in the body are marked as such. An earlier version of
 * the long paper carried a section heading reading "Ten measurement failures" four incidents after
 * there were ten; a hand-written table of this shape is the same hazard with more rows.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAPERS = [join(HERE, '..'), join(HERE, '..', 'articles')]
  .find((d) => existsSync(join(d, 'benchmark-inversion'))) ?? join(HERE, '..');
const OUT = process.argv[2] ?? join(HERE, '..', 'reconstructed');
mkdirSync(OUT, { recursive: true });

/** `narrated` marks the cases the journal version describes in the running text. */
const INCIDENTS = [
  { id: 1, layer: 'execution', narrated: true,
    fault: 'host throughput drifted 32\\,\\% between batches',
    inferred: 'a component effect',
    check: 'randomised order; canary runs' },
  { id: 2, layer: 'control', narrated: true,
    fault: 'a behaviourally null configuration measured non-zero',
    inferred: 'a 10\\,\\% ablation gain',
    check: 'a null control arm' },
  { id: 3, layer: 'sampling', narrated: false,
    fault: 'one seed per size',
    inferred: 'a linear scaling law that reversed',
    check: 'replication before fitting' },
  { id: 4, layer: 'diagnostics', narrated: true,
    fault: 'a probe read a field absent from the record',
    inferred: 'a live branch was dead code',
    check: 'assert the probe\'s own reads are defined' },
  { id: 5, layer: 'configuration', narrated: true,
    fault: 'a defensive clamp silently raised requested values',
    inferred: 'the parameter optimum was inside the tested range',
    check: 'assert effective value equals requested value' },
  { id: 6, layer: 'provenance', narrated: true,
    fault: 'a results file spanned a change of objective',
    inferred: 'a severe solver regression',
    check: 'version the metric in every row' },
  { id: 7, layer: 'provenance', narrated: false,
    fault: 'a runner honoured a label on one invocation form and ignored it on the other',
    inferred: 'none; a batch became unattributable',
    check: 'reject unused arguments' },
  { id: 8, layer: 'provenance', narrated: true,
    fault: 'before and after measured on different machines',
    inferred: 'a $550\\times$ speed-up',
    check: 'record the machine in the row; refuse cross-machine ratios' },
  { id: 9, layer: 'analysis', narrated: true,
    fault: 'a lower-tail statistic included infeasible runs',
    inferred: 'a dispersion scale wrong by half',
    check: 'assert the statistic\'s precondition in code' },
  { id: 10, layer: 'analysis', narrated: false,
    fault: 'a goodness-of-fit reported rounded up',
    inferred: 'a power law where the model was misspecified',
    check: 'report the fit as measured, not as a certificate' },
  { id: 11, layer: 'orchestration', narrated: false,
    fault: 'a batch was read before it finished',
    inferred: 'an unbalanced design read as a result',
    check: 'assert balanced cells before analysing' },
  { id: 12, layer: 'reliability', narrated: true,
    fault: 'a rare failure mode sat below the sample resolution',
    inferred: 'a solver without that failure mode',
    check: 'size the sample for rare events separately' },
  { id: 13, layer: 'reporting', narrated: true,
    fault: 'a figure script measured at build time',
    inferred: 'a memory figure that changed between builds',
    check: 'measure, store, then render; build twice and diff' },
  { id: 14, layer: 'reporting', narrated: false,
    fault: 'a universal quantifier generalised from one instance',
    inferred: 'a formula said to match everywhere',
    check: 'compute quantified claims over the full data set' }
];

const DECLARED = 14;   // \incCount in the paper, in words: fourteen
if (INCIDENTS.length !== DECLARED) {
  throw new Error(`the table holds ${INCIDENTS.length} incidents and the paper declares ` +
    `${DECLARED}. One of the two is stale; fix the paper's count and this constant together.`);
}
const ids = INCIDENTS.map((x) => x.id);
if (ids.some((x, i) => x !== i + 1)) {
  throw new Error(`incident ids are not 1..${DECLARED} in order: ${ids.join(', ')}`);
}

const rows = INCIDENTS.map((x) =>
  `${x.id}${x.narrated ? '$^{*}$' : ''} & ${x.layer} & ${x.fault} & ${x.inferred} & ${x.check} \\\\`);

const narrated = INCIDENTS.filter((x) => x.narrated).length;

writeFileSync(`${OUT}/incidents-summary.tex`, `% generated by _scripts/incidentsummary.mjs — do not edit
\\begin{table*}[t]
\\centering
\\caption{All ${DECLARED} measurement failures, by the software layer that produced each. The
${narrated} marked $^{*}$ are described in the running text. \`\`Misleading inference'' is the
conclusion the faulty number supported, or would have supported had it not been caught.}
\\label{tab:incidents}
\\footnotesize
\\begin{tabular}{@{}r l p{42mm} p{34mm} p{40mm}@{}}
\\toprule
\\# & layer & fault & misleading inference & cheapest safeguard \\\\
\\midrule
${rows.join('\n')}
\\bottomrule
\\end{tabular}
\\end{table*}
`);

const word = (k) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'][k] ?? String(k);
writeFileSync(`${OUT}/incident-facts.tex`,
  ['% generated by _scripts/incidentsummary.mjs — do not edit',
   `\\newcommand{\\incCount}{${word(DECLARED)}}`,
   `\\newcommand{\\incNarrated}{${word(narrated)}}`,
   `\\newcommand{\\incLayers}{${word(new Set(INCIDENTS.map((x) => x.layer)).size)}}`
  ].join('\n') + '\n');

console.log(`${DECLARED} incidents, ${narrated} narrated, ` +
  `${new Set(INCIDENTS.map((x) => x.layer)).size} layers`);
console.log(`wrote ${OUT}/incidents-summary.tex, ${OUT}/incident-facts.tex`);
