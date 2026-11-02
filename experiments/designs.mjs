/**
 * The experimental designs, fixed before any of the runs in results/ was made (1 November 2026).
 *
 * A configuration is the complete solver with documented options changed (never a source edit).
 * The sampling unit is the replicate r = 1..R: replicate r uses generator seed r (a different
 * generated instance) and solver seed 20260802 + r, and every configuration of a design is run on
 * every replicate, so configurations are paired on the instance and on the initial solver seed.
 */
export const CONFIGS = {
  'full':             { opts: {},                                          label: 'complete solver (baseline)' },
  'no-chain':         { opts: { chainRate: 0 },                            label: 'ejection chain removed' },
  'no-taper':         { opts: { chainOffAfter: 2_000_000_000 },            label: 'ejection chain never disabled (theta = infinity)' },
  'no-hot':           { opts: { hotShare: 0 },                             label: 'min-conflicts selection removed' },
  'no-rcl':           { opts: { roomSample: 1_000_000, roomScanFullBelow: 1_000_000 }, label: 'restricted candidate list removed' },
  'no-swap':          { opts: { swapRate: 0 },                             label: 'targeted swap removed' },
  'fixed-weight':     { opts: { hardWeight: 1e8 },                         label: 'fixed hard-violation weight (omega = 1e8)' },
  'short-history':    { opts: { lahcLength: 50 },                          label: 'short acceptance history (L = 50)' },
  'long-history':     { opts: { lahcLength: 5000 },                        label: 'long acceptance history (L = 5000)' },
  'greedy-accept':    { opts: { lahcLength: 1 },                           label: 'late acceptance removed (L = 1)' },
  'no-swap-no-chain': { opts: { swapRate: 0, chainRate: 0 },               label: 'targeted swap and ejection chain removed' },
  'L2':   { opts: { lahcLength: 2 },   label: 'L = 2' },
  'L5':   { opts: { lahcLength: 5 },   label: 'L = 5' },
  'L10':  { opts: { lahcLength: 10 },  label: 'L = 10' },
  'L20':  { opts: { lahcLength: 20 },  label: 'L = 20' },
  'L200': { opts: { lahcLength: 200 }, label: 'L = 200' }
};

// The nine configurations of the article's Table 3. "short-history" is L = 50 because that is what
// the historical "greedy" row actually ran under the silent clamp of Incident 5.
const TABLE3 = ['full', 'no-chain', 'no-taper', 'no-hot', 'no-rcl', 'no-swap', 'fixed-weight', 'short-history', 'long-history'];
const BUDGET = ['full', 'no-chain', 'greedy-accept', 'no-swap', 'no-rcl'];
const R5 = [1, 2, 3, 4, 5], R10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// A canary is a short fixed job (complete solver, n = 3200, replicate 1, 300 000 moves) run at the
// start, the middle and the end of every wall-clock batch: its moves per second track the host.
export const CANARY = { config: 'full', n: 3200, rep: 1, budget: { moves: 300_000 } };

export const DESIGNS = {
  // Table 3 replication at n = 3200: the same nine configurations under three protocols, plus the
  // wall-clock budget run in randomised order so that order and budget type are not confounded.
  'T3-wall30-blocked':  { n: 3200,  reps: R5,  configs: TABLE3, budget: { timeMs: 30_000 },  order: 'blocked',  canary: true },
  'T3-wall60-blocked':  { n: 3200,  reps: R5,  configs: TABLE3, budget: { timeMs: 60_000 },  order: 'blocked',  canary: true },
  'T3-wall30-shuffled': { n: 3200,  reps: R5,  configs: TABLE3, budget: { timeMs: 30_000 },  order: 'shuffled', canary: true },
  'T3-moves':           { n: 3200,  reps: R10, configs: [...TABLE3, 'greedy-accept', 'no-swap-no-chain'], budget: { moves: 1_500_000 }, order: 'shuffled' },
  // Budget dependence at n = 12 800: four mechanisms at two wall-clock budgets and one move budget.
  'B-wall60':           { n: 12800, reps: R5,  configs: BUDGET, budget: { timeMs: 60_000 },  order: 'shuffled', canary: true },
  'B-wall300':          { n: 12800, reps: R5,  configs: BUDGET, budget: { timeMs: 300_000 }, order: 'shuffled', canary: true },
  // Move budget at n = 12 800: the budget comparison, the 2x2 interaction (10 replicates) and the
  // acceptance-history sweep.
  'B-moves':            { n: 12800, reps: R10, configs: [...BUDGET, 'no-swap-no-chain'], budget: { moves: 3_000_000 }, order: 'shuffled' },
  'L-sweep':            { n: 12800, reps: R5,  configs: ['L2', 'L5', 'L10', 'L20', 'short-history', 'L200'], budget: { moves: 3_000_000 }, order: 'shuffled' },
  // Timing variability: six executions of identical work (n = 12 800, replicate 1, 10^6 moves --
  // the historical probe's design), alternating the progress callback on and off.
  'drift':              { n: 12800, reps: [1], configs: ['full'], budget: { moves: 1_000_000 }, order: 'repeat6' }
};
