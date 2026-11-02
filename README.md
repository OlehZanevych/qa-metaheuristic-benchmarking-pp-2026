# qa-metaheuristic-benchmarking-pp-2026

Reproduction package for

> O. B. Zanevych, V. M. Kukharskyy. *Quality Assurance for Metaheuristic Benchmarking: Hidden
> Feasible Solutions, Independent Validation and Reproducibility Safeguards.* Problems in
> Programming (Проблеми програмування), 2026.

It contains everything needed to check the article's claims: the instance generator with its
retained feasibility witnesses, the independent validator with its micro-tests, boundary cases and
seeded faults, the timetabling solver exactly as used, the experiment designs and runner, every run
record, the analysis that turns the records into the article's tables and numbers, and the archived
historical records of the development work together with the scripts that reconstruct the
historical figures the article quotes.

The package is plain JavaScript for Node.js. It has **no dependencies**: nothing to install.

## Requirements

* Node.js **22.13 or later** (the solver is TypeScript and is loaded with Node's built-in
  `module.stripTypeScriptTypes`). Checked with Node 22.22 on Linux x86-64.
* Two CPU cores and about 2 GB of memory for the full run.

## Quick start

```bash
npm test            # validator tests, mutation analysis, quick generator self-test and identity check (about a minute)
npm run analyse     # rebuilds results/summary.json and results/tex/*.tex from the stored run records
npm run reconstruct # rebuilds the historical figures in archive/reconstructed/ from archive/records/
./run_all.sh        # repeats every experiment, then the analysis (about 7 hours on two cores)
```

`npm run analyse` and `npm run reconstruct` only read stored records, so they reproduce the
article's numbers exactly and in seconds. `./run_all.sh` re-executes the experiments themselves.

## What reproduces exactly and what does not

| result | rerun on another machine |
|---|---|
| validator tests, mutation analysis, generator self-test, generator identity | identical |
| move-budget runs (designs `T3-moves`, `B-moves`, `L-sweep`, `drift` schedules) | identical schedules, costs and move counts; elapsed times differ |
| wall-clock runs (`T3-wall30-blocked`, `T3-wall60-blocked`, `T3-wall30-shuffled`, `B-wall60`, `B-wall300`) | **different**: a wall-clock run measures the host. Expect other moves per second, other costs and possibly other signs |
| tables and numbers from stored records (`npm run analyse`, `npm run reconstruct`) | identical |

A move-budget run with a fixed instance seed, solver seed and budget produced the same schedule on
the original arm64 host and on the x86-64 host of the reproduction runs (`results/identity.json`).
That is an observation for two environments, not a guarantee for all.

## Layout

```
src/solver/timetable-solver.ts   the solver, verbatim (configurations differ only by documented options)
src/generator/build.mjs, emit.mjs  hidden-feasible instance generator (Pass 1 builds the schedule, Pass 2 derives the rules)
src/validator/validate.mjs        independent validator: nine counters and five filters
src/lib/                          solver loader (rejects unknown or silently changed options), provenance, statistics
tests/validator-cases.mjs         V01-V16 (Table 2 of the article) and boundary cases B01-B16, with expected counter vectors
tests/validator-tests.mjs         runs them                        -> results/validator-tests.json
tests/mutations.mjs               seeded faults M1-M7 against the final, article and initial suites -> results/mutations.json
tests/generator-selftest.mjs      re-scores every retained witness; boundary configurations; SHA-256 of instances and witnesses
                                                                   -> results/generator-selftest.json
tests/generator-identity.mjs      released generator vs the generator of the historical records (tests/reference/)
                                                                   -> results/generator-identity.json
experiments/designs.mjs           the experimental designs R3-R7, fixed before execution
experiments/run.mjs               runner: --design NAME [--shard i/k] [--dry]   -> results/NAME.jsonl
analysis/identity.mjs             reproduction runs vs archived move-budget runs -> results/identity.json
analysis/analyse.mjs              paired effects, 95 % intervals, interaction, L sweep, timing -> results/summary.json,
                                                                   results/paired-observations.csv
analysis/tables.mjs               LaTeX tables and macros of the article     -> results/tex/
analysis/safeguards.json          the eight safeguards S1-S8 and their executable checks (Table 7)
archive/records/                  historical run records H1-H4, unchanged
archive/incidents.json            the fourteen incidents (Table 6); archive/INCIDENTS.md maps each to its evidence
archive/reconstruct/              scripts that rebuild the historical figures -> archive/reconstructed/
results/                          every run record of the reproduction and the derived files
```

## Run records

Each line of `results/<design>.jsonl` is one run: design, configuration, requested **and effective**
solver options, instance seed, solver seed, budget type and value, moves made, elapsed time, moves
per second, whether the budget was spent, execution order and position, start time, validator
counters (feasibility, hard violations, soft cost), the metric version, the SHA-256 of the solver,
generator and validator sources, and the runtime environment (Node version, CPU model, core count,
memory; the host name only as a hash). Canary runs carry `"canary": true`.

`results/paired-observations.csv` lists every matched pair behind every effect in the article.

## Estimand

For an ablated configuration A and the complete solver B on replicate *i* (generator seed *i*,
solver seed 20 260 802 + *i*), with both runs feasible:
*d<sub>i</sub>* = *S<sub>i</sub>*(A) − *S<sub>i</sub>*(B), *r<sub>i</sub>* = 100 *d<sub>i</sub>* / *S<sub>i</sub>*(B).
The reported effect is the mean of *r<sub>i</sub>* with a two-sided 95 % Student-*t* interval.
Positive means that removing the component makes the soft cost worse. Feasibility is reported as
counts. The interaction of two components is
*I<sub>i</sub>* = *S*<sub>11</sub> − *S*<sub>10</sub> − *S*<sub>01</sub> + *S*<sub>00</sub> over the four matched configurations.

The analysis refuses to run on a design with missing cells or on a run that did not spend its
budget (pass `--partial` to inspect an incomplete design).

## Provenance of the code

See [PROVENANCE.md](PROVENANCE.md): where each source file comes from, and the one change made to
the generator (a guard that was missing from the travel check; it never fires and leaves every
instance byte-identical).

## Licence

MIT, see [LICENSE](LICENSE).
