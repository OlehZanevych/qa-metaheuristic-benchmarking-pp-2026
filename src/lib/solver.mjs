/**
 * Loads the timetable solver exactly as it ships in the application (src/solver/timetable-solver.ts,
 * a byte-for-byte copy of lnu-timetable's timetable-ui/src/app/timetable-solver.ts), by stripping
 * its TypeScript type annotations with Node's own `module.stripTypeScriptTypes` and importing the
 * result. Nothing in the solver is edited: every ablated configuration is the same file run with
 * one documented option changed.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SOLVER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'solver', 'timetable-solver.ts');
let cached = null;

export async function loadSolver() {
  if (cached) return cached;
  if (typeof stripTypeScriptTypes !== 'function') {
    throw new Error('Node.js >= 22.13 is required (module.stripTypeScriptTypes is missing)');
  }
  const src = readFileSync(SOLVER_PATH, 'utf8');
  const js = stripTypeScriptTypes(src, { mode: 'strip', sourceUrl: pathToFileURL(SOLVER_PATH).href });
  cached = await import(`data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`);
  return cached;
}

/** The emitted instance stores Maps as arrays of pairs (so it serialises); the solver wants Maps. */
export function hydrate(problem) {
  return { ...problem,
    lecturerConstraints: new Map(problem.lecturerConstraints),
    groupConstraints: new Map(problem.groupConstraints),
    roomConstraints: new Map(problem.roomConstraints),
    roomBuilding: new Map(problem.roomBuilding),
    buildingTravel: new Map(problem.buildingTravel) };
}

/**
 * The options a run will actually execute with, and a check that they are the ones requested.
 *
 * The solver merges the caller's options over DEFAULT_OPTIONS and then applies exactly one clamp
 * (`lahcLength = max(1, ·)`). A request the solver would silently change is rejected here rather
 * than run under the wrong name -- the failure behind Incident 5 of the article.
 */
const KNOWN = new Set(['maxIterations', 'timeLimitMs', 'stagnationLimit', 'lahcLength', 'swapRate', 'seed',
  'chainRate', 'chainOffAfter', 'hotShare', 'roomSample', 'roomScanFullBelow', 'hardWeight']);
export function effectiveOptions(mod, requested) {
  for (const k of Object.keys(requested)) {
    if (!KNOWN.has(k)) throw new Error(`unknown solver option "${k}" (rejected rather than ignored)`);
    if (typeof requested[k] !== 'number' || !Number.isFinite(requested[k])) throw new Error(`option ${k} must be a finite number`);
  }
  const eff = { ...mod.DEFAULT_OPTIONS, ...requested };
  if (eff.lahcLength !== undefined && Math.max(1, eff.lahcLength) !== eff.lahcLength) {
    throw new Error(`lahcLength ${eff.lahcLength} would be clamped by the solver; refusing to run it`);
  }
  return eff;
}
