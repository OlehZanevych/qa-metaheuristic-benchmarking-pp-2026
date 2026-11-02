# Provenance of the code and the records

Every run record stores the SHA-256 of the solver, of the generator (`build.mjs` followed by
`emit.mjs`) and of the validator that produced it (field `code`), so any row can be matched to the
exact sources below.

## Sources

| file | origin | SHA-256 |
|---|---|---|
| `src/solver/timetable-solver.ts` | the solver of the university information system (lnu-timetable), copied verbatim; identical, apart from comments, to `v20-shipped.ts`, the variant that produced the historical records | `174bb3b7d0aa07ee472c3c1c5aca2bf62a706a0395ac63bc3bfe8f3812adc03f` |
| `src/validator/validate.mjs` | the independent validator of the study, unchanged | `9ec966fff5d364248ebabeee23608117970a48f45689a3fa47431997cf3c76c8` |
| `src/generator/emit.mjs` | the instance emitter (Pass 2) of the study, unchanged | `e6d0a25e07dc6ae48ec67bb31b3a64c0fd0cf30115ceaed6b0eaa7b578542874` |
| `src/generator/build.mjs` | the schedule builder (Pass 1) of the study **with one added guard** (below) | `ac0ca6431546d274fcc0bc4d3b09ef0b1663c71fbe125b54902df18d042ec939` |
| `tests/reference/build.mjs` | the schedule builder exactly as used for the historical records (a header comment added) | `6a480dc25d6ad371eeee70a3bde690da7e3dc086b1155d737c4e7308580060ea` |

Generator hash as recorded in the rows (`code.generator`, SHA-256 of `build.mjs` then `emit.mjs`):

* `1098c58e92fa1f86c0f0e4fd508b40865383e2f21b5ddefb27dc87a8fb46f499`: the builder before the guard.
  Carried by the move-budget designs `T3-moves`, `B-moves` and `L-sweep`, which ran first.
* `0db315ee99e81b6c7a7c5dfb07753abebc4885ce991a7c3fc9fe0529b2e0363b`: the released builder with the
  guard. Carried by `drift` and the wall-clock designs, which ran after it was installed.

Both builders emit byte-identical instances for every size and seed used in the study:
`tests/generator-identity.mjs` compares them on 13 sizes (10 to 31 000 sessions) x 20 seeds and
requires identical output and a guard that never fires (`results/generator-identity.json`). The
two hashes therefore describe the same instances.

## The guard

Writing out the travel step of the feasibility proof (Proposition 1 of the article) exposed one
case the original builder did not check: a physical-education session is checked at creation
against the walk between the sports complex and the cohort's home building, but if the cohort has an
online class on the same day, the journey between the sports complex and that class is the commute
(80 minutes). A cohort's PE day coincides with its online day only for cohort indices congruent to
5 modulo 6 (both on Saturday), and at the study's sizes and parameters the main fill ends before
Saturday. The released builder rejects such a PE session (`guardFired` counts how often). It never
fires on the 260 instances of the study's configuration; on the 50 boundary instances of
`tests/boundary-configs.mjs` (tight room supply pushes the fill into Saturday) it fires 45 times,
always on a session the original builder also rejected, so those instances are byte-identical too
(`results/generator-identity.json`, field `boundary`).

## Historical records

`archive/records/` holds the result files of the development work exactly as stored (H1-H4 in
Table 3 of the article): solver benchmark runs (`results*.jsonl`, `payload.jsonl`), wall-clock and
move-budget ablation batches (`ablation-*.jsonl`), portfolio runs (`portfolio*.jsonl`), the
workload-allocation benchmark (`workload-bench/`) and approximation and bound experiments of the
same project that the article does not use. They were produced with the historical builder and the
solver above on the development hosts (an arm64 container; Incident 8 also involves an x86-64
container). Some of them are the contaminated measurements described in the article and are kept
for that reason. `archive/reconstruct/` contains the scripts that computed the historical figures,
with only their input and output paths changed; their outputs in `archive/reconstructed/` are
byte-identical to the figures of the article's earlier version.

## Reproduction runs

Made on 1-2 November 2026 on one host: Linux x86-64, Intel Xeon 2.1 GHz, two logical CPUs, 8 GiB,
Node.js 22.22.0 (each row records it in `env`). Move-budget designs ran two processes at a time;
the host was restarted during `B-moves` (runs already written were kept; the runner resumes
by skipping recorded keys, and move-budget results do not depend on order or timing). The drift
and wall-clock designs ran afterwards, one process at a time; no other experiment ran on the host meanwhile.
The host was restarted a second time during `B-wall300`, after its first canary and six runs; the
remaining runs were made after the restart in the same randomised order, so that design has a gap
of about fifteen minutes in its timeline (visible in `startedAt`). Its canaries were run at the
recorded positions as usual.
