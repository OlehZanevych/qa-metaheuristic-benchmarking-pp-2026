#!/usr/bin/env bash
cd /home/claude/work/bi/app/qa-metaheuristic-benchmarking-pp-2026
export NODE_NO_WARNINGS=1
echo "B-wall300 resumed $(date -u +%FT%TZ) after a host restart" >> logs/driver.log
node experiments/run.mjs --design B-wall300 >> logs/B-wall300.log 2>&1
echo "B-wall300 done $(date -u +%FT%TZ)" >> logs/driver.log
echo "phase2 end $(date -u +%FT%TZ)" >> logs/driver.log
touch logs/PHASE2_DONE
node tests/generator-identity.mjs > logs/generator-identity.log 2>&1; echo "generator-identity (with boundary) exit $? $(date -u +%FT%TZ)" >> logs/driver.log
node tests/generator-selftest.mjs > logs/generator-selftest.log 2>&1; echo "generator-selftest exit $? $(date -u +%FT%TZ)" >> logs/driver.log
touch logs/ALL_DONE
