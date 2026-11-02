/**
 * Boundary configurations of the generator (used by generator-selftest.mjs and
 * generator-identity.mjs): very small instances, every constraint type at its maximum share, every
 * class biweekly, no room restriction, half of the lecturers external, and tight room supply (which
 * can make the requested size unattainable -- the theorem must still hold for what is emitted).
 * Each configuration is generated with seeds 1-5.
 */
export const BOUNDARY = [
  ...[10, 30, 50, 100].map((n) => ({ n, opts: {} })),
  { n: 800, opts: { lecturerConstraintShare: 1, groupConstraintShare: 1, roomConstraintShare: 1 } },
  { n: 800, opts: { biweeklyShare: 1 } },
  { n: 800, opts: { unrestrictedShare: 1 } },
  { n: 800, opts: { externalShare: 0.5 } },
  { n: 800, opts: { roomSlack: 0.3 } },
  { n: 3200, opts: { roomSlack: 0.3, lecturerConstraintShare: 1, groupConstraintShare: 1, roomConstraintShare: 1 } }
];
export const BOUNDARY_SEEDS = [1, 2, 3, 4, 5];
