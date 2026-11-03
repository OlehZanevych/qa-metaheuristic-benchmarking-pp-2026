#!/usr/bin/env bash
# Three separate operations. The article's run records in results/ are never modified by any of them.
#
#   ./run_all.sh tables                 recompute the article's numbers and tables from the supplied
#                                       records in results/ (seconds; byte-identical results/tex/*.tex)
#   ./run_all.sh fresh [DIR]            run the tests, then execute every experiment of the article anew
#                                       into a NEW directory (default runs/fresh-<UTC time>), then analyse
#                                       it there (about 7 hours on two cores). Refuses a directory that
#                                       already holds records.
#   ./run_all.sh resume DIR             continue an interrupted fresh experiment in DIR: only the missing
#                                       runs are made, after checking that the records already in DIR come
#                                       from the same code, metric version, options (and, for wall-clock
#                                       designs, host type); then analyse DIR
#   ./run_all.sh smoke [DIR]            a fresh run of the small `smoke` design (seconds), checked like any
#                                       other record set; shows the whole pipeline working on new records
#
# Move-budget runs are deterministic: with the same instance seed, solver seed and budget they
# reproduced the archived results of the development hosts on a second processor architecture
# (results/identity.json lists exactly what was compared). That is an observation for the
# environments used, not a guarantee for every machine. Wall-clock runs measure the host: they run
# one at a time with nothing else on the machine, and their numbers will differ on other hardware.
set -euo pipefail
cd "$(dirname "$0")"
export NODE_NO_WARNINGS=1
MODE="${1:-}"
stamp() { date -u +%Y%m%dT%H%M%SZ; }
fresh_dir() {
  local d="$1"
  if [ -e "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
    echo "$d already exists and is not empty: a fresh experiment needs a new directory (use 'resume $d' to continue it)" >&2; exit 2
  fi
  case "$(cd "$(dirname "$d")" 2>/dev/null && pwd)/$(basename "$d")" in
    "$PWD/results"|"$PWD/results/"*|"$PWD/archive"|"$PWD/archive/"*) echo "results/ and archive/ hold the article's records; choose another directory" >&2; exit 2;;
  esac
  mkdir -p "$d/logs"
}
tests() {   # test outputs go to $RESULTS_DIR
  node tests/validator-tests.mjs
  node tests/mutations.mjs
  node tests/safeguard-tests.mjs
  node tests/generator-selftest.mjs
  node tests/generator-identity.mjs
}
experiments() {   # a fresh execution of every design into $1
  local d="$1"
  # Phase 1: deterministic move-budget designs, two processes at a time, merged afterwards.
  for x in T3-moves B-moves L-sweep; do
    node experiments/run.mjs --design $x --out-dir "$d" --shard 0/2 > "$d/logs/$x.0.log" 2>&1 &
    node experiments/run.mjs --design $x --out-dir "$d" --shard 1/2 > "$d/logs/$x.1.log" 2>&1
    wait
    cat "$d/$x.part0.jsonl" "$d/$x.part1.jsonl" > "$d/$x.jsonl"
  done
  # Phase 2: measurements of the host, strictly one at a time.
  for x in drift T3-wall30-blocked T3-wall60-blocked T3-wall30-shuffled B-wall60 B-wall300; do
    node experiments/run.mjs --design $x --out-dir "$d" > "$d/logs/$x.log" 2>&1
  done
}
analyse() {   # analysis of the records in $1; outputs written next to them
  node analysis/identity.mjs --results "$1"
  node analysis/analyse.mjs --results "$1"
  node analysis/tables.mjs --results "$1"
}

case "$MODE" in
  tables)
    analyse results
    (cd archive/reconstruct && for f in *.mjs; do node "$f" > /dev/null; done)
    echo "done: results/summary.json, results/tex/*.tex, archive/reconstructed/*"
    ;;
  fresh)
    D="${2:-runs/fresh-$(stamp)}"; fresh_dir "$D"
    export RESULTS_DIR="$D"
    tests
    experiments "$D"
    analyse "$D"
    echo "done: $D (records, summary.json, tex/); compare with results/ to see what reproduced"
    ;;
  resume)
    D="${2:?usage: ./run_all.sh resume DIR}"
    [ -d "$D" ] || { echo "$D does not exist" >&2; exit 2; }
    export RESULTS_DIR="$D"
    # a shard with records continues (compatibility checked by the runner); a missing shard starts
    for x in T3-moves B-moves L-sweep; do
      for s in 0 1; do
        if [ -s "$D/$x.part$s.jsonl" ]; then node experiments/run.mjs --design $x --out-dir "$D" --shard $s/2 --resume >> "$D/logs/$x.$s.log" 2>&1 &
        else node experiments/run.mjs --design $x --out-dir "$D" --shard $s/2 >> "$D/logs/$x.$s.log" 2>&1 & fi
      done
      wait
      cat "$D/$x.part0.jsonl" "$D/$x.part1.jsonl" > "$D/$x.jsonl"
    done
    for x in drift T3-wall30-blocked T3-wall60-blocked T3-wall30-shuffled B-wall60 B-wall300; do
      if [ -s "$D/$x.jsonl" ]; then node experiments/run.mjs --design $x --out-dir "$D" --resume >> "$D/logs/$x.log" 2>&1
      else node experiments/run.mjs --design $x --out-dir "$D" >> "$D/logs/$x.log" 2>&1; fi
    done
    analyse "$D"
    echo "done: $D"
    ;;
  smoke)
    D="${2:-runs/smoke-$(stamp)}"; fresh_dir "$D"
    node experiments/run.mjs --design smoke --out-dir "$D" | tee "$D/logs/smoke.log"
    node --input-type=module -e "
      import { checkDesign, loadDesign } from './analysis/records.mjs';
      import { loadSolver } from './src/lib/solver.mjs';
      const rows = loadDesign('$D', 'smoke');
      checkDesign('smoke', rows, await loadSolver());
      console.log('smoke: ' + rows.length + ' new records pass the record checks; first run ' + rows[0].runId + ' started ' + rows[0].startedAt);"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 1;;
esac
