#!/usr/bin/env bash
# Waits for phase 1, installs the guarded generator, runs the generator checks, then phase 2 alone.
cd /home/claude/work/bi/app/qa-metaheuristic-benchmarking-pp-2026
export NODE_NO_WARNINGS=1
while [ ! -f logs/PHASE1_DONE ]; do sleep 20; done
for d in T3-moves B-moves L-sweep; do cat results/$d.part0.jsonl results/$d.part1.jsonl > results/$d.jsonl; done
if ! grep -q guardFired src/generator/build.mjs; then cp /tmp/gchk/build.guard.mjs src/generator/build.mjs; echo "guarded generator installed $(date -u +%FT%TZ)" >> logs/driver.log; fi
node tests/generator-identity.mjs > logs/generator-identity.log 2>&1; echo "generator-identity exit $? $(date -u +%FT%TZ)" >> logs/driver.log
node tests/generator-selftest.mjs > logs/generator-selftest.log 2>&1; echo "generator-selftest exit $? $(date -u +%FT%TZ)" >> logs/driver.log
node tests/validator-tests.mjs > logs/validator-tests.log 2>&1; echo "validator-tests exit $? $(date -u +%FT%TZ)" >> logs/driver.log
node tests/mutations.mjs > logs/mutations.log 2>&1; echo "mutations exit $? $(date -u +%FT%TZ)" >> logs/driver.log
echo "phase2 start $(date -u +%FT%TZ)" >> logs/driver.log
for d in drift T3-wall30-blocked T3-wall60-blocked T3-wall30-shuffled B-wall60 B-wall300; do
  node experiments/run.mjs --design $d >> logs/$d.log 2>&1
  echo "$d done $(date -u +%FT%TZ)" >> logs/driver.log
done
echo "phase2 end $(date -u +%FT%TZ)" >> logs/driver.log
touch logs/PHASE2_DONE
