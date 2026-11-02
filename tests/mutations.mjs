#!/usr/bin/env node
/**
 * Mutation testing of the validator test suite: is each test load-bearing?
 *
 * Each mutant is a copy of src/validator/validate.mjs with one line replaced by a plausible wrong
 * version (the source file itself is never modified). The suite is run against the copy three
 * ways, and the cases that fail are recorded, so every mutant is identified by the tests that
 * catch it:
 *   final    all V and B cases (the suite as it stands);
 *   article  V01..V16 (the sixteen cases of the article's Table 1);
 *   initial  V01..V16 without V07 -- the suite before the reverse-order travel case was added.
 * The seven mutants were written to probe that suite, so the 7/7 result is regression evidence
 * for these specific faults, not an estimate of general fault-detection power.
 *
 * Writes results/mutations.json; exits 1 if any mutant survives the final suite.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SINGLES } from './validator-cases.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const original = readFileSync(join(ROOT, 'src/validator/validate.mjs'), 'utf8');
export const MUTANTS = [
  ['M1', 'biweekly parity ignored', 'if (!weeksOverlap(a.parity, c.parity)) continue;', 'if (false) continue;'],
  ['M2', 'directed journey read in input order rather than chronological order', 'const [f, l] = a.s <= c.s ? [a, c] : [c, a];', 'const [f, l] = [a, c];'],
  ['M3', 'room eligibility not enforced', 'else if (q.roomIds.length && !q.roomIds.includes(p.roomId)) F.badRoom++;', 'else if (false) F.badRoom++;'],
  ['M4', 'NOT_AFTER compared with the start of a class rather than its end', 'if (na && ev.e > toMin(na.value)) F.constraintBreaches++;', 'if (na && ev.s > toMin(na.value)) F.constraintBreaches++;'],
  ['M5', 'time-grid (bell-set) membership not enforced', 'if (t.setId !== q.classStartTimeSetId) F.badBellSet++;', 'if (false) F.badBellSet++;'],
  ['M6', 'abstract-room capacity loosened by 100', 'if (sum > cap) V.abstractRoomOverflow++;', 'if (sum > cap + 100) V.abstractRoomOverflow++;'],
  ['M7', 'duplicate placements not detected', 'if (seen.has(p.key)) { F.duplicates++; continue; }', 'if (false) { F.duplicates++; continue; }']
];
const bIds = SINGLES.map((c) => c.id).join(',');
const SUITES = { final: '', article: bIds, initial: `V07,${bIds}` };

function failingCases(vpath, exclude) {
  try {
    execFileSync(process.execPath, [join(ROOT, 'tests/validator-tests.mjs')],
      { stdio: 'pipe', env: { ...process.env, VALIDATOR: vpath, EXCLUDE: exclude, NODE_NO_WARNINGS: '1' } });
    return [];
  } catch (e) {
    return [...new Set([...String(e.stdout).matchAll(/FAIL ([VB]\d\d)/g)].map((m) => m[1]))];
  }
}

const dir = mkdtempSync(join(tmpdir(), 'validator-mutants-'));
const out = [];
try {
  // the unmutated validator must pass every suite, or the experiment means nothing
  const clean = join(dir, 'validate.mjs'); writeFileSync(clean, original);
  for (const [s, ex] of Object.entries(SUITES)) if (failingCases(clean, ex).length) throw new Error(`the unmutated validator fails the ${s} suite`);
  for (const [id, label, from, to] of MUTANTS) {
    if (original.split(from).length !== 2) throw new Error(`${id}: mutation target is not unique in validate.mjs`);
    const p = join(dir, `${id}.mjs`); writeFileSync(p, original.replace(from, to));
    const row = { id, label, from, to };
    for (const [s, ex] of Object.entries(SUITES)) { const f = failingCases(p, ex); row[s] = { caught: f.length > 0, failingCases: f }; }
    out.push(row);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }

mkdirSync(join(ROOT, 'results'), { recursive: true });
writeFileSync(join(ROOT, 'results/mutations.json'), JSON.stringify(out, null, 1));
for (const r of out) console.log(`${r.id} ${r.label.padEnd(72)} final:${r.final.caught ? 'caught by ' + r.final.failingCases.join(',') : 'SURVIVED'} | initial:${r.initial.caught ? 'caught' : 'survived'}`);
const n = (s) => out.filter((r) => r[s].caught).length;
console.log(`mutants caught: final ${n('final')}/${out.length}, article ${n('article')}/${out.length}, initial ${n('initial')}/${out.length}`);
if (n('final') !== out.length) process.exit(1);
