#!/usr/bin/env bash
# Reproduces every rerunnable experiment of the article, then the analysis.
#
#   ./run_all.sh            everything (about 7 hours on two cores)
#   ./run_all.sh --quick    the tests and a smoke run only (a few minutes)
#
# Move-budget designs are deterministic: they may run two at a time, and their schedules, costs
# and move counts reproduce exactly on any machine. Wall-clock designs are measurements of the
# host: they run one at a time with nothing else on the machine, and their numbers will differ
# from the article's on other hardware.
set -euo pipefail
cd "$(dirname "$0")"
export NODE_NO_WARNINGS=1
mkdir -p results logs

node tests/validator-tests.mjs
node tests/mutations.mjs
if [ "${1:-}" = "--quick" ]; then
  node tests/generator-selftest.mjs --quick
  echo "quick check passed"; exit 0
fi
node tests/generator-selftest.mjs
node tests/generator-identity.mjs

# Phase 1: deterministic move-budget designs, two processes at a time.
for d in T3-moves B-moves L-sweep; do
  node experiments/run.mjs --design $d --shard 0/2 > logs/$d.0.log 2>&1 &
  node experiments/run.mjs --design $d --shard 1/2 > logs/$d.1.log 2>&1
  wait
  cat results/$d.part0.jsonl results/$d.part1.jsonl > results/$d.jsonl
done

# Phase 2: measurements of the host, strictly one at a time.
for d in drift T3-wall30-blocked T3-wall60-blocked T3-wall30-shuffled B-wall60 B-wall300; do
  node experiments/run.mjs --design $d > logs/$d.log 2>&1
done

node analysis/identity.mjs
node analysis/analyse.mjs
node analysis/tables.mjs
for f in archive/reconstruct/*.mjs; do (cd archive/reconstruct && node "$(basename "$f")" > /dev/null); done
echo "done: results/summary.json, results/tex/*.tex, archive/reconstructed/*"
