/**
 * What every result row records about where it came from (safeguard 6 of the article).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const METRIC_VERSION = 'validator-v1 (src/validator/validate.mjs; soft = rounded window and online-mix counts)';

const sha = (p) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');
export const CODE = {
  solver: sha('src/solver/timetable-solver.ts'),
  generator: createHash('sha256').update(readFileSync(join(ROOT, 'src/generator/build.mjs')))
    .update(readFileSync(join(ROOT, 'src/generator/emit.mjs'))).digest('hex'),
  validator: sha('src/validator/validate.mjs')
};

export function environment() {
  const cpus = os.cpus();
  return {
    node: process.version, platform: `${os.platform()} ${os.release()}`, arch: os.arch(),
    cpuModel: cpus[0]?.model ?? 'unknown', logicalCpus: cpus.length,
    memGiB: Math.round(os.totalmem() / 2 ** 30),
    host: createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12)
  };
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
