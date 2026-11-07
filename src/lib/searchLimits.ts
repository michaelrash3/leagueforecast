/*
 * How few games a season must have left before each exact search runs on the render path. They
 * lived at the top of App.tsx while App was the only place that ran these searches; the hooks that
 * App's sections moved into run some of them too, so the limits sit here, where both can read them.
 */

// Keep the synchronous exact solver capped below browser-freezing schedule sizes.
// The solver branches exponentially over every unfinished game (including ties),
// so larger schedules should continue showing the paused message until this
// computation moves off the React render path.
export const EXACT_MAGIC_REMAINING_GAME_LIMIT = 15;
// One-game seed swing projections are O(remaining games²) because each game
// needs away-win and home-win season projections. On a freshly imported full
// schedule this can otherwise block the browser before the confirmation toast
// and first render complete.
export const EXACT_SCENARIO_REMAINING_GAME_LIMIT = 60;
// The needed results for the followed team (`neededResults`): one exact search per side of each
// game left, so asked only once the season is this close to done.
export const NEEDS_REMAINING_GAME_LIMIT = 10;
