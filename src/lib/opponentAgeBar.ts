/**
 * How many distinct opponents have to name an age before their names settle a team's level.
 *
 * Counted per opponent rather than per game, because a tournament against the same club four times
 * is one club's opinion and not four. Three is where the evidence stops being a coincidence: over
 * a 48,035-team export 90.4% of names carry a readable age label, so a team with any schedule at
 * all almost always has three, and three independent names agreeing is not something a mislabelled
 * squad produces by accident.
 *
 * In a module of its own so the waiting list's readings (`agelessQueue`, `agelessTriage`) can share
 * it without importing the import, which reads them.
 */
export const MIN_OPPONENT_AGE_EVIDENCE = 3;
