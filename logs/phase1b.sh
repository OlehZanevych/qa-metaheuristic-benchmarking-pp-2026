#!/usr/bin/env bash
cd /home/claude/work/bi/app/qa-metaheuristic-benchmarking-pp-2026
export NODE_NO_WARNINGS=1
echo "phase1 resumed $(date -u +%FT%TZ) after a host restart" >> logs/driver.log
for d in B-moves L-sweep; do
  node experiments/run.mjs --design $d --shard 0/2 >> logs/$d.0.log 2>&1 &
  node experiments/run.mjs --design $d --shard 1/2 >> logs/$d.1.log 2>&1
  wait
  echo "$d done $(date -u +%FT%TZ)" >> logs/driver.log
done
echo "phase1 end $(date -u +%FT%TZ)" >> logs/driver.log
touch logs/PHASE1_DONE
