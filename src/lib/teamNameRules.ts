/**
 * The words in a team's name that say it is not a baseball team the pool should hold.
 *
 * Two kinds. A name can say the page is not a team at all — a practice, a scrimmage, a test, a
 * tryout, a scorekeeper's or a camera's account, an old page somebody marked do not use — or that
 * the team plays another game, wiffle ball or softball. Both are read off the name alone, because
 * nothing else in a GameChanger record says either: it is a baseball platform and reports every
 * page as a baseball team, at an ordinary age, with an ordinary-looking record.
 *
 * Here, in one place, because every side of the app asks: the list parse, which leaves these out
 * of a pasted export before a request is spent on one; the import, which refuses a schedule and
 * decides what a game against one is; the tidy, which deletes a pulled page already in the pool;
 * the nightly sweep's name sign (`obviousFakes.ts`); and the waiting list's order
 * (`agelessQueue.ts`). Each reads its own subset of the same words, so a word moved here moves
 * everywhere at once.
 *
 * Measured on the desktop crawl's team export of 24 September 2026 (266,350 rows) and the Team
 * Rankings backup of 11 October 2026, every pattern below checked against every distinct name in
 * the pool (147,114) by a second implementation, which gave the same verdict on all of them. The
 * fifteen word groups together read 2,138 rows of the export (0.80%), 692 of them with no players
 * at all, and 534 GameChanger teams in the pool, in 533 clubs; 79 of those clubs were ranked, and
 * none was on the owner's list of clubs that are real.
 */

/**
 * A name with its joins split apart, so a word run into another reads as a word of its own.
 *
 * Every rule is asked of both forms, the name as written and this, because each catches names the
 * other misses. Only the split form reads a word run into a number or a capital: four numbered
 * placeholder pages, a test page numbered 1, a test page written in one word after a stray letter,
 * a practice page numbered 2, a "Dont Use" run into its age, an "InterSquad" run into its club's
 * initials. Only the raw form reads a word somebody capitalised in the middle, a "PracTice" and a
 * "DO NOt USE" in the export, because the split breaks those in two.
 */
export const splitName = (name: string): string =>
  name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/_/g, " ");

/** The word groups that say a page is not a team, each named by its first word. */
export type NotATeamWord =
  | "practice"
  | "scrimmage"
  | "test"
  | "demo"
  | "sample"
  | "fake"
  | "delete"
  | "placeholder"
  | "duplicate"
  | "void"
  | "tryout"
  | "stats"
  | "stream"
  | "intrasquad";

/**
 * What the import does with a game whose opponent is so named, on another club's schedule.
 *
 * - `drop`: the game goes, as a game against a wiffle team does. The result is not a game between
 *   two teams: a practice, a scrimmage, a tryout, a camera's account playing itself.
 * - `slot`: the game is filed against a slot of its own, as a game against "TBD" is. These names
 *   mark a real team's old page, and dropping the game would take a real result off the other
 *   club's record: 14 of the 45 games filed against the void and do-not-use pages in the backup of
 *   11 October 2026 are listed by the other club's own schedule too.
 */
export type OpponentGate = "drop" | "slot";

/**
 * One word group: what it matches, what it leaves alone, and what a game against it does.
 *
 * Every pattern takes the `i` flag and not the `u` flag, so `\b` is a plain ASCII word boundary,
 * as it was where these were measured; and not the `g` flag, which carries state from one `test`
 * to the next.
 */
export type NameRule<Word extends string = string> = {
  word: Word;
  pattern: RegExp;
  /** A name this matches, in either form, is not refused whatever the pattern says. */
  exempt?: RegExp;
  opponent: OpponentGate;
};

/*
 * The counts beside each rule are a row of the export counted once, under the first rule it meets
 * in this order; "full" is nine or more players and two or more staff; "confirmed" is a game in the
 * pool another pulled club's own schedule lists too.
 */

/**
 * Practice. 336 export rows (69 with no players, 87 full); 104 GameChanger teams in the pool,
 * holding 97 games, 60 scored, one confirmed; 22 ranked clubs. Plural and "practising" because
 * those are the accounts the bare word missed, a fall's practices. The word boundary keeps out the
 * 28 chiropractic sponsors in the export; a family-practice sponsor names three rec teams.
 */
const PRACTICE: NameRule<"practice"> = {
  word: "practice",
  pattern: /\bpractic(?:e|es|ing)\b|\bpractise[sd]?\b/i,
  exempt: /\bfamily\s+practice\b/i,
  opponent: "drop",
};

/**
 * Scrimmage. 100 rows (8 empty, 60 full); 34 pool teams, 39 games, 33 scored, 9 confirmed; 14
 * ranked clubs. Real squads playing real scrimmages, here because a scrimmage result is not a
 * game rather than because the teams are made up. The misspelling "scrimage" is meant: 4 rows.
 */
const SCRIMMAGE: NameRule<"scrimmage"> = {
  word: "scrimmage",
  pattern: /\bscrimm?ag(?:e|es|ing)\b|\bscrims?\b/i,
  opponent: "drop",
};

/**
 * Test. 767 rows (313 empty, 38 full); 200 pool teams, 132 games, 50 scored, one confirmed; 3
 * ranked clubs. An Austin organisation is called TEST: 10 teams in the pool, written "TEST Black",
 * "TEST Red", "Test Blaze", with 20 confirmed games, so a name that opens with the word before one
 * of its colours is left alone; so are Skiles Test, a place, and a test-prep sponsor. "Tests" and
 * "Testers" are not read, because "Testers" is a real team's name.
 */
const TEST: NameRule<"test"> = {
  word: "test",
  pattern: /\btest(?:ing)?\b/i,
  exempt: /^\W*test\s+(?:black|red|blaze)\b|\bskiles\s+test\b|\btest\s*prep\b/i,
  opponent: "drop",
};

/**
 * Demo. 20 rows (7 empty, none full); 3 pool teams, one game, none scored. "Demo & Renovation" is a
 * sponsor, and "Demo Dawgs" a fourteen-player squad, which a Fall Minors team run together as
 * "DemoDogs" would meet only in the split form.
 */
const DEMO: NameRule<"demo"> = {
  word: "demo",
  pattern: /\bdemo\b/i,
  exempt: /\bdemo\.?\s*(?:&|and)\s*renovation\b|\bdemo\s*d(?:aw|o)gs\b/i,
  opponent: "drop",
};

/**
 * Sample, dummy, example. 20 rows (3 empty, one full); 2 pool teams, no games. Singular only: the
 * plural "Samples" is in two real teams' names and "Dummies" is a team's name.
 */
const SAMPLE: NameRule<"sample"> = {
  word: "sample",
  pattern: /\bsample\b|\bdummy\b|\bexample\b/i,
  opponent: "drop",
};

/**
 * Fake. 86 rows (17 empty, 9 full); 8 pool teams, 22 games, all scored, 2 confirmed; 4 ranked
 * clubs. A "Fake and Bake" squad is a pun on a tanning salon, and plays.
 */
const FAKE: NameRule<"fake"> = {
  word: "fake",
  pattern: /\bfakes?\b/i,
  exempt: /\bfake\s*(?:&|and|n)\s*bake\b/i,
  opponent: "drop",
};

/**
 * Delete. 70 rows (53 empty, 6 full); 17 pool teams, 3 games, all scored and confirmed; 3 ranked
 * clubs. Its three scored games are three 18U pages, renamed Delete, playing each other: a real
 * team's old page, so a game against one is kept on a slot.
 */
const DELETE: NameRule<"delete"> = {
  word: "delete",
  pattern: /\bdelet(?:e|ed|es|ing)\b/i,
  opponent: "slot",
};

/**
 * Placeholder. 66 rows (56 empty, none full); 4 pool teams, 5 games, 4 scored and all 4
 * confirmed, though nobody can say which real team stood behind them; 3 ranked clubs.
 */
const PLACEHOLDER: NameRule<"placeholder"> = {
  word: "placeholder",
  pattern: /\bplace\s*-?\s*holders?\b/i,
  opponent: "slot",
};

/**
 * Duplicate, copy of. 22 rows (6 empty, 6 full); 7 pool teams, one game, unscored. Bare "copy" is
 * not read: a printing sponsor, a copy centre and a team waiting on an age carry it.
 */
const DUPLICATE: NameRule<"duplicate"> = {
  word: "duplicate",
  pattern: /\bduplicates?\b|\bdupe\b|\bcopy\s+of\b|\baccidental\s+copy\b/i,
  opponent: "slot",
};

/**
 * Void, do not use, DNU. 362 rows (118 empty, 132 full); 93 pool teams, 45 games, 19 scored, 14
 * confirmed; 8 ranked clubs. Real teams' abandoned pages, one of them now named void and do not
 * use both under a club that plays on, so a game against one is kept on a slot. The void and
 * do-not-use part is the waiting list's own `VOID_NAME` (`agelessTriage.ts`).
 */
const VOID: NameRule<"void"> = {
  word: "void",
  pattern: /\bvoid(?:ed)?\b|\bdo\s*n[o'’]?t\s*use\b|\bdnu\b/i,
  opponent: "slot",
};

/**
 * Tryout, workout, evaluation. 80 rows (19 empty, 32 full); 24 pool teams, 5 games, 4 scored, one
 * confirmed; 5 ranked clubs. No false hit was found: the evaluation squads in the pool only play
 * each other.
 */
const TRYOUT: NameRule<"tryout"> = {
  word: "tryout",
  pattern:
    /\btry\s*-?\s*outs?\b|\bwork\s*-?\s*outs?\b|\bevaluations?\b|\bevals?\b|\bassessments?\b/i,
  opponent: "drop",
};

/**
 * Stats, scorekeeping. 48 rows (3 empty, 17 full); 16 pool teams, 38 games, 29 scored, none
 * confirmed; 10 ranked clubs. "All Stats" is a misspelling of All Stars, and bare "stat" is not
 * read: two sponsors carry it, and one squad written "Stat - …" has 4 confirmed games.
 */
const STATS: NameRule<"stats"> = {
  word: "stats",
  pattern:
    /\bstats\b|\bstat\s*-?\s*(?:keep(?:er|ing)?|track(?:er|ing)?|book)s?\b|\bscore\s*-?\s*(?:book|keep(?:ing|ers?)?)s?\b|\bscoring\b/i,
  exempt: /\ball[\s-]*stats?\b/i,
  opponent: "drop",
};

/**
 * Live stream, camera. 11 rows (3 empty, 4 full); 5 pool teams, 20 games, 7 scored, 2 confirmed; 2
 * ranked clubs. A squad that says it plays "with streaming" is advertising, not a camera. Bare
 * "stream" is not read: it is a town's name in more than one state.
 */
const STREAM: NameRule<"stream"> = {
  word: "stream",
  pattern: /\blive\s*-?\s*stream(?:s|ing)?\b|\bstreaming\b|\bcameras?\b/i,
  exempt: /\bw(?:\/|ith)\s*streaming\b/i,
  opponent: "drop",
};

/**
 * Intrasquad, intersquad. 18 rows (none empty, 9 full); 4 pool teams, 3 games, 2 scored; 2 ranked
 * clubs. A squad playing itself is not a result for anybody.
 */
const INTRASQUAD: NameRule<"intrasquad"> = {
  word: "intrasquad",
  pattern: /\bint(?:ra|er)\s*-?\s*squads?\b/i,
  opponent: "drop",
};

/** The word groups that say a page is not a team, in the order a name is read against them. */
export const NOT_A_TEAM_RULES: readonly NameRule<NotATeamWord>[] = [
  PRACTICE,
  SCRIMMAGE,
  TEST,
  DEMO,
  SAMPLE,
  FAKE,
  DELETE,
  PLACEHOLDER,
  DUPLICATE,
  VOID,
  TRYOUT,
  STATS,
  STREAM,
  INTRASQUAD,
];

/**
 * Softball, fastpitch, slowpitch, kickball: another game. 132 rows (17 empty, 62 full); 13 pool
 * teams pulled from GameChanger, 87 games, 11 scored: 10 against other softball sides, and 1 that
 * a baseball club's own schedule lists too, which goes from that club's record, since a game
 * against a softball side is not a baseball result. 3 ranked clubs, one of them a "Slow Pitch"
 * squad that is a judgement call. A name that says baseball as well is a programme fielding both,
 * a 6U side written "Baseball/Softball" or a baseball and softball league: 7 rows, left alone. Read
 * as `isNotBaseball` reads wiffle ball, not as a page that is no team.
 */
const SOFTBALL: NameRule<"softball"> = {
  word: "softball",
  pattern: /\bsoft\s*-?\s*ball\b|\bfast\s*-?\s*pitch\b|\bslow\s*-?\s*pitch\b|\bkick\s*-?\s*ball\b/i,
  exempt: /\bbase\s*-?\s*ball\b/i,
  opponent: "drop",
};

/** All fifteen, in the order they were measured: what a second implementation is checked against. */
export const NAME_RULES: readonly NameRule[] = [...NOT_A_TEAM_RULES, SOFTBALL];

/** The rule a name hit, the words of the name it hit on as the name writes them, and the gate. */
export type NameRuleHit<Word extends string = string> = {
  word: Word;
  text: string;
  opponent: OpponentGate;
};

/**
 * The first of `rules` a name hits, or null: a rule's pattern matching either form of the name and
 * its exemption matching neither.
 */
export const firstRuleHit = <Word extends string>(
  name: unknown,
  rules: readonly NameRule<Word>[]
): NameRuleHit<Word> | null => {
  if (typeof name !== "string" || !name) return null;
  const split = splitName(name);
  for (const rule of rules) {
    if (rule.exempt && (rule.exempt.test(name) || rule.exempt.test(split))) continue;
    const text = rule.pattern.exec(name)?.[0] ?? rule.pattern.exec(split)?.[0];
    if (text !== undefined) return { word: rule.word, text, opponent: rule.opponent };
  }
  return null;
};

/** The word group a name hits that says the page is not a team, or null. */
export const notATeamWord = (name: unknown): NameRuleHit<NotATeamWord> | null =>
  firstRuleHit(name, NOT_A_TEAM_RULES);

/**
 * Wiffle ball and blitzball.
 *
 * Wiffle ball is a different game — a plastic ball, a plastic bat, and scores that say nothing
 * about how a baseball team would fare. Nine such teams were in a 48,035-team export, filed under
 * ordinary age groups (10U to 16U) in five states. Both spellings, because the export carries
 * eight "Wiffle" to one "Whiffle", and the compound with them; no baseball word contains the
 * sequence, so matching it anywhere in the name costs nothing in false positives.
 *
 * Blitzball is the same kind of game, a plastic ball thrown to curve. The export of 24 September
 * 2026 carried 93 names with "blitz" joined to "ball" among 266,350 teams, against 46 baseball
 * clubs simply called Blitz, so the word is only read joined to "ball". Run together it is always
 * the game, "Blitzballers" included; written apart it has to end at "ball", because "Blitz Ballers"
 * is as likely to be a baseball team's pun as the game, and refusing a real club leaves nothing
 * behind to notice it by. That reads 91 of the 93, and none of the 46.
 */
const WIFFLE = /wh?iffle|blitzball|blitz[\s_-]+ball(?![a-z])/i;

/**
 * A name that says the team is not playing baseball: wiffle ball, blitzball, or softball and the
 * games beside it. The baseball exemption is the softball words' alone; "Wiffle Baseball" is
 * still wiffle ball.
 */
export const isNotBaseball = (name: unknown): boolean =>
  typeof name === "string" && (WIFFLE.test(name) || firstRuleHit(name, [SOFTBALL]) !== null);

/**
 * The words the nightly sweep's name sign reads (`obviousFakes.ts`): void, test and demo, the
 * user's list of 11 October 2026, with each rule's own exemptions and both forms of the name. The
 * sign had a pattern of its own until 17 October 2026, and on the backup of 11 October it read 249
 * pulled clubs by name, all 10 of the Austin organisation called TEST's among them. Read through
 * the rules it reads 300: those 10 fewer, and 61 more, pages marked do not use or DNU and words
 * run into another.
 */
const MADE_UP_RULES: readonly NameRule<NotATeamWord>[] = [TEST, DEMO, VOID];

/** The word of the name sign's a name has, as the name writes it, or null. */
export const madeUpHit = (name: unknown): NameRuleHit<NotATeamWord> | null =>
  firstRuleHit(name, MADE_UP_RULES);
