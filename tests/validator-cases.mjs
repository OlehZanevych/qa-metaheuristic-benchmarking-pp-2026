/**
 * The validator test cases, as data, with stable identifiers.
 *
 *   V01..V16  the sixteen micro-tests of the article's Table 1. Each is a minimal schedule fragment
 *             that satisfies every rule ("valid") and a copy of it carrying exactly one injected
 *             violation ("mutated"). V04 and V07 are standalone legality checks: the table row
 *             describes the valid arrangement and its expected result is that nothing is raised.
 *   B01..B16  boundary cases added in the revision (equality at time bounds, half-open interval
 *             endpoints, inactive weeks, several simultaneous conflicts, capacity equality, missing
 *             and duplicate placements, malformed identifiers). Each is a single fragment with an
 *             expected counter vector.
 *
 * Every expectation is a FULL counter vector: a counter not named must be zero. The counters and
 * their units are those of src/validator/validate.mjs:
 *   lecturerConflicts, groupConflicts, roomConflicts  one per pair of classes of one entity on one
 *       day whose weeks overlap and whose intervals overlap;
 *   groupTravel, lecturerTravel  one per such non-overlapping pair whose gap is shorter than the
 *       directed journey from the earlier to the later class;
 *   abstractRoomOverflow  one per (abstract room, day, week of the two-week cycle, distinct start)
 *       at which the students present exceed the capacity -- so a weekly class counts twice;
 *   unplaced, duplicates, badRoom, badBellSet  one per offending requirement or placement;
 *   constraintBreaches  NOT_BEFORE/NOT_AFTER one per offending class, UNAVAILABLE one per
 *       (window, class) overlap, MAX_CLASSES_PER_DAY one per (entity, day, week) over the cap.
 * H is the sum of the first six; a schedule is feasible when H = 0 and every filter counter is 0.
 */
export const base = () => ({
  academicHourMinutes: 40,
  classTimes: [
    { id: 't1', setId: 'main', ordinal: 1, startTime: '08:30' },
    { id: 't2', setId: 'main', ordinal: 2, startTime: '10:10' },
    { id: 't3', setId: 'main', ordinal: 3, startTime: '11:50' },
    { id: 'p1', setId: 'pe', ordinal: 1, startTime: '08:00' }
  ],
  rooms: ['r1', 'r2', 'r3'],
  roomBuilding: [['r1', 'b1'], ['r2', 'b1'], ['r3', 'b2']],
  buildingTravel: [['b1>b2', 30], ['b2>b1', 5]],   // directed and asymmetric on purpose
  abstractRooms: [{ id: 'ar-sport', capacity: 40, buildingId: 'b1' }],
  universityCommuteMinutes: 60, abstractRoomTravelMinutes: 15,
  lecturerConstraints: [], groupConstraints: [], roomConstraints: [],
  fixedEntries: [], requirements: []
});
export const req = (key, o = {}) => ({ key, lecturerIds: ['L1'], groupIds: ['G1'], roomIds: [], durationHours: 2,
  classStartTimeSetId: 'main', isOnline: false, abstractRoomId: null, studentsCount: 20, ...o });
export const put = (key, day, timeId, roomId, weekParity = 'EVERY') => ({ key, dayOfWeek: day, classStartTimeId: timeId, roomId, weekParity });
const withReqs = (rs, extra = {}) => { const p = base(); p.requirements = rs; return Object.assign(p, extra); };

export const COUNTERS = ['lecturerConflicts', 'groupConflicts', 'roomConflicts', 'groupTravel', 'lecturerTravel',
  'abstractRoomOverflow', 'lecturerWindows', 'groupWindows', 'mixedOnlineDays',
  'unplaced', 'badRoom', 'badBellSet', 'constraintBreaches', 'duplicates'];
export const vector = (expect = {}) => Object.fromEntries(COUNTERS.map((k) => [k, expect[k] ?? 0]));

// ---- V01..V16: the article's Table 1 ---------------------------------------------------------
// kind: 'pair' (valid + mutated), legality: what the valid half asserts when it is itself a test,
// row: 'valid' when the table row describes the legal arrangement (standalone legality check).
export const PAIRS = [
  { id: 'V01', family: 'lecturer conflict', what: 'same lecturer, two rooms, one bell',
    valid: () => ({ p: withReqs([req('a'), req('b', { groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r2')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b', { groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't1', 'r2')] }),
    expect: { lecturerConflicts: 1 } },
  { id: 'V02', family: 'group conflict', what: 'same group in two places at one bell',
    valid: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r2')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't1', 'r2')] }),
    expect: { groupConflicts: 1 } },
  { id: 'V03', family: 'room conflict', what: 'two cohorts in one room at one bell',
    valid: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'], groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'], groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't1', 'r1')] }),
    expect: { roomConflicts: 1 } },
  { id: 'V04', family: 'parity', what: 'one room, one bell, alternating weeks: legal', row: 'valid',
    legality: 'two classes in one room on alternating weeks do not collide',
    valid: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'], groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1', 'NUMERATOR'), put('b', 1, 't1', 'r1', 'DENOMINATOR')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'], groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1', 'NUMERATOR'), put('b', 1, 't1', 'r1', 'NUMERATOR')] }),
    expect: { roomConflicts: 1 } },
  { id: 'V05', family: 'group travel', what: 'b1 to b2 needs 30 min; the gap is 20',
    legality: 'a journey that fits the gap raises nothing',
    valid: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'] })]), s: [put('a', 1, 't1', 'r3'), put('b', 1, 't2', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r3')] }),
    expect: { groupTravel: 1 } },
  { id: 'V06', family: 'lecturer travel', what: 'the same journey, charged to the lecturer',
    legality: 'the same journey, charged to the lecturer, likewise raises nothing',
    valid: () => ({ p: withReqs([req('a'), req('b', { groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r3'), put('b', 1, 't2', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b', { groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r3')] }),
    expect: { lecturerTravel: 1 } },
  { id: 'V07', family: 'directed travel, reverse order', what: 'later class listed first; legal direction', row: 'valid',
    legality: 'a directed journey is read in time order, not in the order the rows appear',
    valid: () => ({ p: withReqs([req('x'), req('y', { lecturerIds: ['L2'] })]), s: [put('y', 1, 't2', 'r1'), put('x', 1, 't1', 'r3')] }),
    mutated: () => ({ p: withReqs([req('x'), req('y', { lecturerIds: ['L2'] })]), s: [put('y', 1, 't2', 'r3'), put('x', 1, 't1', 'r1')] }),
    expect: { groupTravel: 1 } },
  { id: 'V08', family: 'abstract-room capacity', what: 'sport hall capacity of 40 students is exceeded',
    valid: () => ({ p: withReqs([req('a', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', studentsCount: 20 }),
      req('b', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', studentsCount: 20, lecturerIds: ['L2'], groupIds: ['G2'] })]),
      s: [put('a', 1, 'p1', null), put('b', 1, 'p1', null)] }),
    mutated: () => ({ p: withReqs([req('a', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', studentsCount: 20 }),
      req('b', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', studentsCount: 21, lecturerIds: ['L2'], groupIds: ['G2'] })]),
      s: [put('a', 1, 'p1', null), put('b', 1, 'p1', null)] }),
    expect: { abstractRoomOverflow: 2 }, note: 'one per week of the two-week cycle: both classes run every week' },
  { id: 'V09', family: 'room eligibility', what: 'a room outside the permitted set',
    valid: () => ({ p: withReqs([req('a', { roomIds: ['r1', 'r2'] })]), s: [put('a', 1, 't1', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a', { roomIds: ['r1', 'r2'] })]), s: [put('a', 1, 't1', 'r3')] }),
    expect: { badRoom: 1 } },
  { id: 'V10', family: 'time-grid eligibility', what: 'a class restricted to one time grid is placed on an incompatible time grid',
    valid: () => ({ p: withReqs([req('a')]), s: [put('a', 1, 't1', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a')]), s: [put('a', 1, 'p1', 'r1')] }),
    expect: { badBellSet: 1 } },
  { id: 'V11', family: 'not_before', what: 'a class starts before the permitted start time of its lecturer or group',
    valid: () => ({ p: withReqs([req('a')], { lecturerConstraints: [['L1', [{ type: 'NOT_BEFORE', dayOfWeek: null, value: '08:30' }]]] }), s: [put('a', 1, 't1', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a')], { lecturerConstraints: [['L1', [{ type: 'NOT_BEFORE', dayOfWeek: null, value: '10:00' }]]] }), s: [put('a', 1, 't1', 'r1')] }),
    expect: { constraintBreaches: 1 } },
  { id: 'V12', family: 'not_after', what: 'a class ends after the permitted end time of its lecturer or group',
    valid: () => ({ p: withReqs([req('a')], { groupConstraints: [['G1', [{ type: 'NOT_AFTER', dayOfWeek: null, value: '18:00' }]]] }), s: [put('a', 1, 't1', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a')], { groupConstraints: [['G1', [{ type: 'NOT_AFTER', dayOfWeek: null, value: '09:00' }]]] }), s: [put('a', 1, 't1', 'r1')] }),
    expect: { constraintBreaches: 1 } },
  { id: 'V13', family: 'unavailable', what: 'a class overlaps an interval during which its lecturer or group is unavailable',
    valid: () => ({ p: withReqs([req('a')], { lecturerConstraints: [['L1', [{ type: 'UNAVAILABLE', dayOfWeek: 1, value: '14:00-16:00' }]]] }), s: [put('a', 1, 't1', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a')], { lecturerConstraints: [['L1', [{ type: 'UNAVAILABLE', dayOfWeek: 1, value: '08:00-09:00' }]]] }), s: [put('a', 1, 't1', 'r1')] }),
    expect: { constraintBreaches: 1 } },
  { id: 'V14', family: 'max_classes_per_day', what: 'a lecturer or group is assigned a third class when its daily limit is two',
    valid: () => ({ p: withReqs([req('a'), req('b'), req('c')], { lecturerConstraints: [['L1', [{ type: 'MAX_CLASSES_PER_DAY', dayOfWeek: null, value: 3 }]]] }),
      s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r1'), put('c', 1, 't3', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b'), req('c')], { lecturerConstraints: [['L1', [{ type: 'MAX_CLASSES_PER_DAY', dayOfWeek: null, value: 2 }]]] }),
      s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r1'), put('c', 1, 't3', 'r1')] }),
    expect: { constraintBreaches: 2 }, note: 'one per week of the two-week cycle: the three classes run every week' },
  { id: 'V15', family: 'unplaced requirement', what: 'a requirement with no placement',
    valid: () => ({ p: withReqs([req('a'), req('b')]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a'), req('b')]), s: [put('a', 1, 't1', 'r1')] }),
    expect: { unplaced: 1 } },
  { id: 'V16', family: 'duplicate placement', what: 'one requirement placed twice',
    valid: () => ({ p: withReqs([req('a')]), s: [put('a', 1, 't1', 'r1')] }),
    mutated: () => ({ p: withReqs([req('a')]), s: [put('a', 1, 't1', 'r1'), put('a', 1, 't2', 'r2')] }),
    expect: { duplicates: 1 } }
];

// ---- B01..B16: boundary cases (single fragments) ---------------------------------------------
const nb = (v, day = null) => [['L1', [{ type: 'NOT_BEFORE', dayOfWeek: day, value: v }]]];
export const SINGLES = [
  { id: 'B01', what: 'NOT_BEFORE equal to the class start (08:30 vs 08:30) is satisfied',
    f: () => ({ p: withReqs([req('a')], { lecturerConstraints: nb('08:30') }), s: [put('a', 1, 't1', 'r1')] }), expect: {} },
  { id: 'B02', what: 'NOT_AFTER equal to the class end (09:50) is satisfied',
    f: () => ({ p: withReqs([req('a')], { groupConstraints: [['G1', [{ type: 'NOT_AFTER', dayOfWeek: null, value: '09:50' }]]] }), s: [put('a', 1, 't1', 'r1')] }), expect: {} },
  { id: 'B03', what: 'UNAVAILABLE windows ending at the class start and starting at its end do not overlap it (half-open intervals)',
    f: () => ({ p: withReqs([req('a')], { lecturerConstraints: [['L1', [{ type: 'UNAVAILABLE', dayOfWeek: 1, value: '07:00-08:30' }, { type: 'UNAVAILABLE', dayOfWeek: 1, value: '09:50-11:00' }]]] }), s: [put('a', 1, 't1', 'r1')] }), expect: {} },
  { id: 'B04', what: 'a travel gap exactly equal to the journey is sufficient',
    f: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'] })], { buildingTravel: [['b1>b2', 20], ['b2>b1', 5]] }), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r3')] }), expect: {} },
  { id: 'B05', what: 'one minute less than the journey is a violation (gap 20, journey 21)',
    f: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'] })], { buildingTravel: [['b1>b2', 21], ['b2>b1', 5]] }), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't2', 'r3')] }), expect: { groupTravel: 1 } },
  { id: 'B06', what: 'abstract-room demand equal to capacity (20 + 20 = 40) is legal',
    f: () => ({ p: withReqs([req('a', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe' }), req('b', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', lecturerIds: ['L2'], groupIds: ['G2'] })]),
      s: [put('a', 1, 'p1', null), put('b', 1, 'p1', null)] }), expect: {} },
  { id: 'B07', what: 'classes on inactive weeks do not share capacity (20 numerator + 21 denominator, capacity 40)',
    f: () => ({ p: withReqs([req('a', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe' }), req('b', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', studentsCount: 21, lecturerIds: ['L2'], groupIds: ['G2'] })]),
      s: [put('a', 1, 'p1', null, 'NUMERATOR'), put('b', 1, 'p1', null, 'DENOMINATOR')] }), expect: {} },
  { id: 'B08', what: 'a biweekly overflow counts once (41 students, numerator weeks only)',
    f: () => ({ p: withReqs([req('a', { abstractRoomId: 'ar-sport', classStartTimeSetId: 'pe', studentsCount: 41 })]), s: [put('a', 1, 'p1', null, 'NUMERATOR')] }), expect: { abstractRoomOverflow: 1 } },
  { id: 'B09', what: 'three simultaneous classes of one lecturer are three conflicting pairs',
    f: () => ({ p: withReqs([req('a'), req('b', { groupIds: ['G2'] }), req('c', { groupIds: ['G3'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't1', 'r2'), put('c', 1, 't1', 'r3')] }), expect: { lecturerConflicts: 3 } },
  { id: 'B10', what: 'two co-taught classes at one bell conflict once per shared lecturer',
    f: () => ({ p: withReqs([req('a', { lecturerIds: ['L1', 'L2'] }), req('b', { lecturerIds: ['L1', 'L2'], groupIds: ['G2'] })]), s: [put('a', 1, 't1', 'r1'), put('b', 1, 't1', 'r2')] }), expect: { lecturerConflicts: 2 } },
  { id: 'B11', what: 'a daily cap of one is respected by a numerator and a denominator class on the same day',
    f: () => ({ p: withReqs([req('a'), req('b')], { lecturerConstraints: [['L1', [{ type: 'MAX_CLASSES_PER_DAY', dayOfWeek: null, value: 1 }]]] }), s: [put('a', 1, 't1', 'r1', 'NUMERATOR'), put('b', 1, 't2', 'r1', 'DENOMINATOR')] }), expect: {} },
  { id: 'B12', what: 'an empty schedule leaves every requirement unplaced and raises nothing else',
    f: () => ({ p: withReqs([req('a'), req('b'), req('c')]), s: [] }), expect: { unplaced: 3 } },
  { id: 'B13', what: 'an identical duplicate placement is counted once and creates no conflict with itself',
    f: () => ({ p: withReqs([req('a')]), s: [put('a', 1, 't1', 'r1'), put('a', 1, 't1', 'r1')] }), expect: { duplicates: 1 } },
  { id: 'B14', what: 'a placement for an unknown requirement is ignored, so the real requirement is unplaced',
    f: () => ({ p: withReqs([req('a')]), s: [put('zz', 1, 't1', 'r1')] }), expect: { unplaced: 1 } },
  { id: 'B15', what: 'an unknown start-time identifier and an unknown room identifier are rejected',
    f: () => ({ p: withReqs([req('a'), req('b', { lecturerIds: ['L2'], groupIds: ['G2'] })]), s: [put('a', 1, 'tx', 'r1'), put('b', 1, 't1', 'rx')] }), expect: { badBellSet: 1, badRoom: 1 } },
  { id: 'B16', what: 'a day-specific NOT_BEFORE overrides the general one (10:00 on Monday, 08:00 otherwise)',
    f: () => ({ p: withReqs([req('a'), req('b')], { lecturerConstraints: [['L1', [{ type: 'NOT_BEFORE', dayOfWeek: null, value: '08:00' }, { type: 'NOT_BEFORE', dayOfWeek: 1, value: '10:00' }]]] }),
      s: [put('a', 1, 't1', 'r1'), put('b', 2, 't1', 'r1')] }), expect: { constraintBreaches: 1 } }
];
