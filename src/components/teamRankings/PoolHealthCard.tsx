import { useMemo, useState, useSyncExternalStore } from "react";
import { isPullLive, watchPull } from "../../lib/pullSession";
import type { GcImportState } from "../../lib/gameChangerImport";
import { describeTidy } from "../../lib/gameChangerImport";
import {
  loadAgeRightClubs,
  loadKeptApart,
  loadRealClubs,
  storedGamesByYear,
} from "../../lib/teamRankingsStorage";
import type { PoolCommand } from "../../lib/live/commands";
import { storedPool, writtenAnswers, type CommandRun } from "../../lib/live/runPoolCommand";
import { poolHealthSummary } from "../../lib/poolHealthSummary";
import type { WrongAgeClub } from "../../lib/wrongAge";
import type { UnrealClub } from "../../lib/unrealClubs";
import { todayIsoDay } from "../../lib/date";
import { unpulledClubsCsv } from "../../lib/unpulledClubs";
import { poolNamesCsvFilename, poolNamesCsvParts } from "../../lib/poolNamesCsv";
import { standInFixturesCsvFilename, standInFixturesCsvParts } from "../../lib/standInFixturesCsv";
import { downloadCsv, fileDay } from "../../lib/download";
import { usePoolTidy, type PoolInspection, type TidyOutcome } from "../../hooks/usePoolTidy";
import { TidyProgressView } from "./TidyProgressView";
import {
  PoolHealthView,
  type BulkAgeResult,
  type GamesDropped,
  type PoolHealthActions,
  type PoolHealthAnswers,
} from "./PoolHealthView";
import { button } from "../../styles/tokens";

type PoolHealthCardProps = {
  pool: GcImportState;
  tidyStamp: string;
  /** Saves a tidied pool and stamps it, so the work is not done again for nothing. */
  onTidied: (outcome: TidyOutcome) => void;
  /**
   * Folds one entry into another, asking first. Answers whether it happened, so a list of them
   * can drop the one that did and keep the ones the user said no to.
   */
  onMergeTeams: (fromTeamId: string, intoTeamId: string) => Promise<boolean>;
  /**
   * Throws these rows out and remembers them, so the next pull of the same schedule does not file
   * them again. See `deletedGames.ts` for why a deletion has to be remembered rather than done.
   */
  onDropGames: (ids: readonly string[], why?: GamesDropped) => Promise<boolean>;
  /**
   * Throws a club out: the team, every row it is in, and its GameChanger ids, so a pull refuses
   * its schedule rather than rebuilding it. See `deletedGames.ts`.
   */
  onDropClub: (club: UnrealClub) => Promise<boolean>;
  /**
   * Says a game won by more than `IMPLAUSIBLE_MARGIN` runs really was played that way, so it counts
   * and leaves the list (`ScoutGame.scoreConfirmed`).
   */
  onConfirmScore: (gameId: string) => Promise<boolean>;
  /** Opens a club's own panel, for a list that names clubs to look at. */
  onOpenTeam?: (teamId: string) => void;
  /**
   * Files a club at another level in a squad year and holds it there, as its own panel does
   * (`setClubAge`, pinned). Answers whether it happened, so the list can drop the club.
   */
  onSetAge?: (teamId: string, level: number, year: number) => boolean;
  /** Confirms and files all the evidence-backed suggestions as one saved, undoable change. */
  onSetAges?: (clubs: readonly WrongAgeClub[]) => Promise<BulkAgeResult | null>;
  /** Runs a command on the pool as the page runs every edit, saying so when the store refuses it. */
  runCommand: (command: PoolCommand) => CommandRun;
};

/** The answers as this browser has them stored. */
const storedAnswers = (): PoolHealthAnswers => ({
  realClubs: loadRealClubs(),
  ageRight: loadAgeRightClubs(),
  keptApart: loadKeptApart(),
});

/**
 * Pool health on the pool in this browser (`PoolHealthView` draws it): what it shows as it opens
 * worked out here from the pool in hand, "Check the pool" and the tidy run in a worker
 * (`usePoolTidy`), and each button an edit of the page's (`runCommand`). The tidy that settles
 * results and the files of the whole pool are only here, where the whole pool is.
 */
export function PoolHealthCard({
  pool,
  tidyStamp,
  onTidied,
  onMergeTeams,
  onDropGames,
  onDropClub,
  onConfirmScore,
  onOpenTeam,
  onSetAge,
  onSetAges,
  runCommand,
}: PoolHealthCardProps) {
  const { ageGroups, teams, games } = pool;
  /*
   * What the card shows as it opens, from the pool in hand. What each squad year holds comes from
   * the stored sizes rather than from the pool, so it costs nothing to show. It is the one place a
   * year that has lost its games can be seen at all: emptying a year drops it from storage instead
   * of writing it empty, so the games have no gap to find — only the age groups still say the year
   * was ever there.
   */
  const summary = useMemo(
    () => poolHealthSummary({ ageGroups, teams, games }, todayIsoDay(), storedGamesByYear()),
    [ageGroups, teams, games]
  );
  /*
   * A pull keeps running when its panel is closed, so this card can be looking at a pool that is
   * still moving. A tidy started now would write the whole pool over what the pull has since
   * saved — and the pull's cursor has already recorded those teams as settled, so a resume would
   * not fetch them again.
   */
  const pullLive = useSyncExternalStore(watchPull, isPullLive, () => false);
  const { inspect, tidy, busy, progress } = usePoolTidy();
  const [inspection, setInspection] = useState<PoolInspection | null>(null);
  const [lastTidy, setLastTidy] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState(storedAnswers);

  /**
   * The worker's answer, with the answers as stored now: one given elsewhere while it worked (a
   * pair kept apart where a pull ended, say) is honoured by the lists it found.
   */
  const show = (found: PoolInspection) => {
    setAnswers(storedAnswers());
    setInspection(found);
  };

  const look = async () => {
    const found = await inspect(pool, tidyStamp);
    // Null means the panel went away mid-look, so there is nobody left to show it to.
    if (!found) return;
    setLastTidy(null);
    show(found);
  };

  const run = async () => {
    const outcome = await tidy(pool);
    // Refused because something else has the pool. The button is disabled while a pull is running,
    // so this is the narrow case of another tidy already going — nothing to say, nothing to do.
    if (!outcome) return;
    onTidied(outcome);
    setLastTidy(describeTidy({ ...outcome.tidy, state: outcome.state }));
    const found = await inspect(outcome.state, "");
    if (!found) return;
    show(found);
  };

  const actions: PoolHealthActions = {
    /**
     * Adds and takes ids on one of the user's answer lists, as a command (`commands.ts`): the card
     * shows only an answer that was kept, the list as it now stands.
     */
    answer: (list, add, remove) => {
      const done = runCommand({ kind: "answers", list, add, remove });
      if (!done.ok) return false;
      const now = new Set(writtenAnswers(done, list) ?? storedPool.answers(list));
      setAnswers((held) => ({ ...held, [list]: now }));
      return true;
    },
    dropGames: (ids, why) => onDropGames(ids, why),
    dropClub: onDropClub,
    confirmScore: (game) => onConfirmScore(game.id),
    merge: (from, into) => onMergeTeams(from.id, into.id),
    ...(onSetAge
      ? { setAge: (club: WrongAgeClub) => onSetAge(club.teamId, club.suggested, club.year) }
      : {}),
    ...(onSetAges ? { setAges: onSetAges } : {}),
    ...(onOpenTeam ? { openTeam: onOpenTeam } : {}),
    downloadToPull: () => {
      const toPull = inspection?.lists.toPull ?? [];
      if (toPull.length === 0) return;
      downloadCsv("Clubs_To_Pull.csv", unpulledClubsCsv(toPull));
    },
  };

  /**
   * The pool's own names, for measuring a rule against the teams it must not break.
   *
   * Nothing in the app reads this file: it goes to `scripts/agelessSweep.ts`, which cannot ask
   * "what would this rule do to a team that already works?" from the backlog alone. Ids, names
   * and the age already filed — no games, so a hundred thousand teams is a few megabytes rather
   * than the hundreds the whole-browser backup runs to.
   */
  const downloadPoolNames = () => {
    downloadCsv(poolNamesCsvFilename(fileDay()), poolNamesCsvParts(teams, ageGroups, games));
  };

  /**
   * Every row with a stand-in on one side, and the rows at the same instant or on the same day
   * that could be its other half — what joining a stand-in to its club by the fixture is measured on, since the
   * whole-browser backup that holds the games is too large to hand over. Ten seconds or so on a
   * pool of real size, so it breathes between chunks and says how far along it is.
   */
  const [fixturesProgress, setFixturesProgress] = useState<number | null>(null);
  const downloadStandInFixtures = async () => {
    setFixturesProgress(0);
    try {
      const parts = await standInFixturesCsvParts(teams, ageGroups, games, (searched, of) => {
        setFixturesProgress(Math.floor((100 * searched) / of));
        return new Promise((resolve) => setTimeout(resolve, 0));
      });
      downloadCsv(standInFixturesCsvFilename(fileDay()), parts);
    } finally {
      setFixturesProgress(null);
    }
  };

  const health = inspection?.health ?? null;
  const settleable = inspection?.settleable ?? 0;
  return (
    <PoolHealthView
      summary={summary}
      answers={answers}
      inspection={inspection}
      looking={busy === "inspect"}
      canLook={busy === null && games.length > 0}
      onLook={() => void look()}
      held={pullLive}
      actions={actions}
      beside={
        health &&
        settleable > 0 && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy !== null || pullLive}
            className={button.primary}
          >
            {busy === "tidy" ? "Tidying…" : `Settle ${settleable.toLocaleString()} of them`}
          </button>
        )
      }
      under={
        <>
          {pullLive && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              A pull is running, so this waits. Both write the whole pool, and the one that finishes
              second would overwrite what the other had just saved.
            </p>
          )}
          {(busy === "tidy" || progress.steps.length > 0 || progress.now) && (
            <>
              {busy === "tidy" && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Walking every game, several times over. On a nationwide pool this takes a while —
                  the page stays usable while it runs.
                </p>
              )}
              <TidyProgressView watch={progress} running={busy === "tidy"} />
            </>
          )}
        </>
      }
      foot={
        <>
          {lastTidy && (
            <ul className="mt-3 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {lastTidy.length === 0 ? (
                <li>Nothing left to do.</li>
              ) : (
                lastTidy.map((line) => <li key={line}>{line}</li>)
              )}
            </ul>
          )}

          {teams.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={downloadPoolNames}
                className={`${button.ghost} text-sm`}
              >
                Download the pool names ({teams.length.toLocaleString()})
              </button>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                For measuring a rule against the teams it must not break. Ids, names and the age
                each team is already filed under — no games, so it is a few megabytes rather than
                the hundreds a whole-browser backup runs to. Nothing in the app reads it: it is the
                file the ageless sweep needs to answer &ldquo;what would this rule do to a team that
                already works?&rdquo;, which cannot be asked of the backlog alone.
              </p>
              <button
                type="button"
                onClick={() => void downloadStandInFixtures()}
                disabled={fixturesProgress !== null}
                className={`${button.ghost} mt-3 text-sm`}
              >
                {fixturesProgress === null
                  ? "Download the stand-in fixtures"
                  : `Searching the stand-in rows… ${fixturesProgress}%`}
              </button>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Every result filed against a stand-in or a TBD, and beside it any other club&apos;s
                row at the same start time, or the same day, that could be the other half of the
                same game — spelling slips and all — with the same searches run a week either side
                as a check on chance. Nothing in the app reads it: it is what measures joining a
                stand-in to its club by the game rather than the name. Takes ten seconds or so on a
                large pool.
              </p>
            </div>
          )}
        </>
      }
    />
  );
}
