/**
 * Loading and checking run records before any statistic is computed from them (safeguards 6 and 7
 * of the article). A set of records is accepted only when it is exactly the design's plan:
 *
 *  - every planned run (and canary) is present exactly once, and nothing else is: a duplicate that
 *    replaces a missing cell is rejected, not hidden by a correct row count;
 *  - every record agrees with its plan cell: configuration, size, replicate, instance and solver
 *    seeds, budget type and value, execution position, requested options;
 *  - the effective options are the ones the released code runs for that cell;
 *  - the metric version is the current one, and the solver, generator and validator sources are
 *    the released ones or are declared equivalent in analysis/provenance-equivalence.json (with
 *    the evidence for the equivalence);
 *  - the budget was spent, and the feasibility flag agrees with the counters (and, in records of
 *    schema 2, with the five filters).
 *
 * Any violation is an error that names the offending records; nothing is silently dropped.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DESIGNS } from '../experiments/designs.mjs';
import { planOf, requestedOptions, sameJson } from '../experiments/plan.mjs';
import { effectiveOptions } from '../src/lib/solver.mjs';
import { CODE, METRIC_VERSION } from '../src/lib/provenance.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EQUIV = JSON.parse(readFileSync(join(ROOT, 'analysis/provenance-equivalence.json'), 'utf8'));

export const readJsonl = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Records of a design in a directory (the merged file), or null when the file does not exist. */
export function loadDesign(dir, name) {
  const f = join(dir, `${name}.jsonl`);
  return existsSync(f) ? readJsonl(f) : null;
}

/** Is a recorded source hash the released one, or declared equivalent to it? */
export function acceptedSource(part, hash, equivalence = EQUIV) {
  if (hash === CODE[part]) return true;
  return (equivalence[part] ?? []).some((e) => e.sha256 === hash && e.equivalentTo === CODE[part]);
}

/**
 * Checks the records of one design. `mod` is the loaded solver module (for its default options).
 * With `partial`, missing planned runs are allowed (to inspect an unfinished batch); every other
 * rule still applies. Returns { main, canaries }; throws with the list of problems otherwise.
 */
export function checkDesign(name, rows, mod, { partial = false, equivalence = EQUIV, metricVersion = METRIC_VERSION } = {}) {
  const plan = planOf(name);
  const byKey = new Map(plan.map((j) => [j.key, j]));
  const problems = [];
  const count = new Map();
  for (const r of rows) count.set(r.key, (count.get(r.key) ?? 0) + 1);
  for (const [k, c] of count) {
    if (c > 1) problems.push(`${k}: recorded ${c} times`);
    if (!byKey.has(k)) problems.push(`${k}: not a planned run of ${name}`);
  }
  if (!partial) for (const j of plan) if (!count.has(j.key)) problems.push(`${j.key}: planned but missing`);
  for (const r of rows) {
    const j = byKey.get(r.key);
    if (!j) continue;
    const want = { design: name, config: j.config, n: j.n, rep: j.rep, canary: !!j.canary, tag: j.tag ?? null,
      orderIndex: j.orderIndex, instanceSeed: j.rep, solverSeed: requestedOptions(j).seed,
      budgetType: j.budget.moves ? 'moves' : 'wall', budget: j.budget.moves ?? j.budget.timeMs, callback: j.callback };
    for (const [k, v] of Object.entries(want)) if (r[k] !== v) problems.push(`${r.key}: ${k} = ${JSON.stringify(r[k])}, the plan says ${JSON.stringify(v)}`);
    const req = requestedOptions(j);
    if (!sameJson(r.requestedOptions, req)) problems.push(`${r.key}: requested options ${JSON.stringify(r.requestedOptions)} differ from the plan ${JSON.stringify(req)}`);
    let eff = null;
    try { eff = effectiveOptions(mod, req); } catch (e) { problems.push(`${r.key}: ${e.message}`); }
    if (eff && !sameJson(r.effectiveOptions, eff)) problems.push(`${r.key}: effective options ${JSON.stringify(r.effectiveOptions)} differ from what the released code runs ${JSON.stringify(eff)}`);
    if (r.metricVersion !== metricVersion) problems.push(`${r.key}: metric version "${r.metricVersion}" is not "${metricVersion}"`);
    for (const part of ['solver', 'generator', 'validator']) {
      if (!acceptedSource(part, r.code?.[part], equivalence)) problems.push(`${r.key}: ${part} source ${String(r.code?.[part]).slice(0, 12)} is neither the released one nor declared equivalent`);
    }
    if (r.budgetSpent !== true) problems.push(`${r.key}: did not spend its budget`);
    const schema = r.schema ?? 1;
    if (schema === 1) {
      if (r.feasible && r.hard !== 0) problems.push(`${r.key}: marked feasible with ${r.hard} hard violations`);
    } else if (schema === 2) {
      if (!r.filters || !r.scheduleHash || !r.runId) problems.push(`${r.key}: schema 2 record without filters, schedule hash or run id`);
      else {
        const clean = r.hard === 0 && Object.values(r.filters).every((x) => x === 0);
        if (r.feasible !== clean) problems.push(`${r.key}: feasible = ${r.feasible} but hard = ${r.hard}, filters = ${JSON.stringify(r.filters)}`);
      }
    } else problems.push(`${r.key}: unknown record schema ${schema}`);
  }
  if (problems.length) {
    throw new Error(`${name}: ${problems.length} problem(s) in the records -- refusing to analyse them\n  ` +
      problems.slice(0, 25).join('\n  ') + (problems.length > 25 ? `\n  ... ${problems.length - 25} more` : ''));
  }
  return { main: rows.filter((r) => !r.canary), canaries: rows.filter((r) => r.canary) };
}

/** Is this design one the article reports? */
export const reported = (name) => !DESIGNS[name].smoke;
