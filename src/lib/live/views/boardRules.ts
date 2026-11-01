/**
 * The version of the rules the boards are built by, apart from the rest of what a published board
 * is (`boardShape.ts`, which re-exports it): League Standings' answers from the server are read
 * against it (`leagueAnswers.ts`) at start, and only Team Rankings reads the boards themselves.
 */

/**
 * The version of the rules that turn a stored pool into boards, raised by any change meant to move
 * a board's numbers, rows or order: the commit that says so under "Pin, then change" raises it too,
 * and `boardParity.test.ts` keeps one fingerprint of the fixture's boards for each. A publish of
 * boards records it (`BuiltFrom.rules`), and one under older rules than the boards already
 * published writes nothing, so code left running after a failed deploy cannot undo newer boards.
 * It only ever goes up: undoing a change that raised it raises it again, with a fingerprint of its
 * own, or every publish after would be refused as older. What a row says about its club beside
 * its numbers (`BoardFacts`) moves no number, row or order, so it raises nothing here; a change to
 * that shape raises `LIVE_SCHEMA`.
 *
 * It was raised once without moving anything, to 3, as a barrier to the publishers from before the
 * boards' shape (`BOARD_SHAPE`). Those know nothing of a shape. One still running once the boards
 * carried a fit (a rebuild or a nightly on the older build, a GitHub re-run of an older run, which
 * checks out that run's own commit, or a rollback) found the boards stale or current by their rules
 * alone, which were its own, so its publish was let through: it wrote boards with no fit over them,
 * and a meta that had dropped the shape it could not read, and members went without what each game
 * did until a publisher of the new build ran again (found by Codex on #371). A raise of the rules is
 * the one thing such a publisher stands aside for, its rebuild before it builds and its publish
 * before it writes, and neither its rebuilds nor its nightly count that as a failure. So 3 moved no
 * number, row or order, and `boardParity.test.ts` holds it to 2's fingerprint. A device of a build
 * from before it labels the boards as built by another version of the app (`liveLabel`) until it
 * loads a newer build, which is so.
 *
 * A later change of shape needs no such raise: every build that records the shape refuses a publish
 * of an older shape than the boards published, as it refuses one under older rules.
 *
 * 1: the boards as L2 first built them. 2: a league team said not to be in Team Rankings carried
 * onto a club of its own (`offClubIdFor`), not onto a club of its name. 3: nothing moved; raised so
 * that the publishers from before the boards' shape stand aside for boards that carry a fit
 * (`BOARD_SHAPE` 1). 4: a year of age worth what it measured at each level (`AGE_STEP_RUNS`),
 * four runs from 9U to 10U, rather than two runs at every level. 5: a club removed automatically as
 * plainly made up, and every game naming it, are left off every board (`autoRemoved.ts`).
 * 6: a bounded one-run deduction for observed circular opponent schedules (`circularSchedule.ts`).
 * 7: each club's rating starts at its league's level, below average by as much as the league keeps
 * to itself (`scheduleCommunities.ts`), and 6's deduction is gone; a row says where it started
 * (`levelPrior`, `outsideGames`) and carries no `scheduleDeduction`.
 * 8: a third copy of a game that already counts (`ScoutGame.countedElsewhere`) is left off every
 * board, so the club it names is credited with the game once.
 * 9: a game won by 31 to 39 runs counts, as a result; only a win by forty or more is suspected of
 * being made up (`IMPLAUSIBLE_MARGIN`), the user's line of 21 October 2026.
 * 10: a club whose web of games five games out reaches fewer than a tenth of the typical club's is
 * listed after every club whose web reaches that many (`teamRankings/opponentWeb.ts`), the owner's
 * rule of 26 October 2026; no number moves, only the order and the places.
 */
export const BOARD_RULES = 10;
