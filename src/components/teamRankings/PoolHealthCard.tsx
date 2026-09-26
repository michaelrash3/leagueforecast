import { useMemo, useSyncExternalStore } from "react";
import { isPullLive, watchPull } from "../../lib/pullSession";
import { useState } from "react";
import type { GcImportState, GcSeasonPairing, GcTwinSquad } from "../../lib/gameChangerImport";
import {
  describeTidy,
  proposeSeasonPairings,
  proposeTwinSquads,
  GC_PAIRING_EVIDENCE_LABEL,
} from "../../lib/gameChangerImport";
import type { PoolHealth } from "../../lib/poolHealth";
import { squadYearHoldings } from "../../lib/poolHealth";
import { loadKeptApart, saveKeptApart, storedGamesByYear } from "../../lib/teamRankingsStorage";
import { keepApart as apartAfter } from "../../lib/keptApart";
import { isDatedAhead } from "../../lib/deletedGames";
import { clubsByGcId, filedBy, unrealClubs, type UnrealClub } from "../../lib/unrealClubs";
import { gcTeamPageUrl } from "../../lib/gameChangerApi";
import { todayIsoDay } from "../../lib/date";
import { unpulledClubs, unpulledClubsCsv } from "../../lib/unpulledClubs";
import { poolNamesCsvFilename, poolNamesCsvParts } from "../../lib/poolNamesCsv";
import { standInFixturesCsvFilename, standInFixturesCsvParts } from "../../lib/standInFixturesCsv";
import { downloadCsv, fileDay } from "../../lib/download";
import { usePoolTidy, type TidyOutcome } from "../../hooks/usePoolTidy";
import {
  countedTwice,
  countedTwiceCsv,
  countedTwiceCsvFilename,
  type CountedTwice,
} from "../../lib/countedTwice";
import { TidyProgressView } from "./TidyProgressView";
import { button, card, pill } from "../../styles/tokens";

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
  onDropGames: (ids: readonly string[]) => Promise<boolean>;
  /**
   * Throws a club out: the team, every row it is in, and its GameChanger ids, so a pull refuses
   * its schedule rather than rebuilding it. See `deletedGames.ts`.
   */
  onDropClub: (club: UnrealClub) => Promise<boolean>;
  /** Opens a club's own panel, for a list that names clubs to look at. */
  onOpenTeam?: (teamId: string) => void;
};

const count = (value: number) => value.toLocaleString();

const plural = (value: number, noun: string) => `${count(value)} ${noun}${value === 1 ? "" : "s"}`;

/** A GameChanger record as a person reads one: wins, losses, and ties where there were any. */
const recordLabel = (record: { win: number; loss: number; tie: number } | undefined) =>
  record ? `${record.win}-${record.loss}${record.tie ? `-${record.tie}` : ""}` : "no record";

/** A page with no date belongs to no squad year; it still has to be called something. */
const yearLabel = (year: number | undefined) => (year === undefined ? "No year" : String(year));

const Row = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <>
    <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="font-bold text-slate-950 dark:text-white">
      {value}
      {note ? <span className="ml-2 text-xs font-normal text-slate-500">{note}</span> : null}
    </dd>
  </>
);

/**
 * What the pool is actually made of, and what is waiting to be fixed.
 *
 * There was nothing anywhere that would tell you a pool of two hundred thousand games had eleven
 * thousand results still filed against "TBD" — the code that settles them worked, it had just
 * never finished running, and a pool in that state looks exactly like a pool in good order. These
 * are the numbers that say which.
 */
export function PoolHealthCard({
  pool,
  tidyStamp,
  onTidied,
  onMergeTeams,
  onDropGames,
  onDropClub,
  onOpenTeam,
}: PoolHealthCardProps) {
  /*
   * What each squad year holds, from the stored sizes rather than from the pool in hand, so it
   * costs nothing to show. It is the one place a year that has lost its games can be seen at all:
   * emptying a year drops it from storage instead of writing it empty, so the games have no gap
   * to find — only the age groups still say the year was ever there.
   */
  const holdings = useMemo(
    () => squadYearHoldings(pool.ageGroups, pool.teams, storedGamesByYear()),
    [pool.ageGroups, pool.teams]
  );
  const emptied = holdings.filter((holding) => holding.emptied);
  /*
   * A pull keeps running when its panel is closed, so this card can be looking at a pool that is
   * still moving. A tidy started now would write the whole pool over what the pull has since
   * saved — and the pull's cursor has already recorded those teams as settled, so a resume would
   * not fetch them again.
   */
  const pullLive = useSyncExternalStore(watchPull, isPullLive, () => false);
  const { inspect, tidy, busy, progress } = usePoolTidy();
  const [health, setHealth] = useState<PoolHealth | null>(null);
  const [settleable, setSettleable] = useState(0);
  const [lastTidy, setLastTidy] = useState<string[] | null>(null);
  const [toPull, setToPull] = useState<ReturnType<typeof unpulledClubs> | null>(null);
  /**
   * One club sitting in the pool as two entries of the same season.
   *
   * Worked out when the button is pressed rather than on render: it walks every game once and
   * every GameChanger link against the few that share its name, which is nothing on a club's pool
   * and is not free on a nationwide one.
   *
   * These were offered only on the screen that comes up when a pull finishes — so a club split in
   * two was findable for about a minute, and after that the pool simply had two of it, ranked
   * separately, each holding part of the same season's games.
   */
  const [duplicates, setDuplicates] = useState<GcSeasonPairing[] | null>(null);
  /**
   * One squad on GameChanger twice under two names: two clubs posting the same games. Found the
   * same way, when the button is pressed, since it walks every timed game once.
   */
  const [twins, setTwins] = useState<GcTwinSquad[] | null>(null);
  /** Clubs holding one game twice: two counted games within the hour with one result. */
  const [twice, setTwice] = useState<CountedTwice[] | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);

  /**
   * The rows with a score on a day that has not happened.
   *
   * You cannot score a game early. A schedule can be opened ahead of time by accident, but it
   * comes back without a score — so a scored row dated in the future is a wrong date or an
   * invention, and a nationwide pool carries both: one club here held a 106-13 record built
   * entirely on games nobody had played, and another was called "Test team".
   *
   * Worked out from the pool in hand rather than from the inspection, because the inspection
   * counts them and this needs the rows themselves to delete.
   */
  const datedAhead = useMemo(() => {
    const today = todayIsoDay();
    return pool.games.filter((game) => isDatedAhead(game, today));
  }, [pool.games]);

  /**
   * The clubs those rows belong to, worst first.
   *
   * Deleting the rows one at a time is endless while the club that invented them is still in the
   * pull list: the next run files a fresh set. The club is the thing to delete, and the share of
   * its record that is impossible is what says whether it is a club at all — "Test team" with 68
   * of 68 is not one; a side with 3 of 40 has some wrong dates on it.
   */
  const unreal = useMemo(() => unrealClubs(pool, todayIsoDay()), [pool]);

  /**
   * The rows themselves, the worst club's first: each row sits where the club that filed it sits
   * on the list below, and a club's rows run in date order. So the rows on screen are the ones
   * doing the most damage, and each one says whose schedule to open to see it.
   */
  const aheadWorstFirst = useMemo(() => {
    const rank = new Map(unreal.map((club, at) => [club.teamId, at]));
    const clubOfGcId = clubsByGcId(pool.teams);
    const byId = new Map(pool.teams.map((team) => [team.id, team]));
    return datedAhead
      .map((game) => {
        const filers = filedBy(game, clubOfGcId);
        const worst = filers.reduce(
          (best, teamId) =>
            (rank.get(teamId) ?? Infinity) < (rank.get(best) ?? Infinity) ? teamId : best,
          filers[0] ?? game.teamAId
        );
        const gcId = byId.get(worst)?.gcTeams?.[0]?.teamId;
        return { game, at: rank.get(worst) ?? Infinity, filer: worst, gcId };
      })
      .sort((a, b) => a.at - b.at || (a.game.date ?? "").localeCompare(b.game.date ?? ""));
  }, [datedAhead, unreal, pool.teams]);
  const [allClubs, setAllClubs] = useState(false);

  const sameSeasonPairs = (state: GcImportState) =>
    proposeSeasonPairings(state.teams, state.games, loadKeptApart()).filter(
      (pairing) => pairing.kind === "same-season"
    );

  const look = async () => {
    const found = await inspect(pool, tidyStamp);
    // Null means the panel went away mid-look, so there is nobody left to show it to.
    if (!found) return;
    setHealth(found.health);
    setSettleable(found.settleable);
    setLastTidy(null);
    setToPull(unpulledClubs(pool));
    setDuplicates(sameSeasonPairs(pool));
    setTwins(proposeTwinSquads(pool.teams, pool.games, loadKeptApart()));
    setTwice(countedTwice(pool.teams, pool.games));
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
    setHealth(found.health);
    setSettleable(found.settleable);
    setToPull(unpulledClubs(outcome.state));
    setDuplicates(sameSeasonPairs(outcome.state));
    setTwins(proposeTwinSquads(outcome.state.teams, outcome.state.games, loadKeptApart()));
    setTwice(countedTwice(outcome.state.teams, outcome.state.games));
  };

  /**
   * Says the two are two clubs, and means it for good.
   *
   * Recorded against the GameChanger ids rather than this pool's, because those are what the next
   * pull brings back unchanged — see `keptApart.ts`. Without it the same handful of namesakes come
   * back on this list after every pull, and a list that re-asks a question already answered is a
   * list that stops being read.
   */
  const keepApart = (pairing: GcSeasonPairing) => {
    saveKeptApart(apartAfter(loadKeptApart(), pairing.fromGcId, pairing.toGcId));
    setDuplicates((current) =>
      (current ?? []).filter(
        (entry) => entry.fromGcId !== pairing.fromGcId || entry.toGcId !== pairing.toGcId
      )
    );
  };

  const teamName = (teamId: string) =>
    pool.teams.find((team) => team.id === teamId)?.name ?? teamId;

  /** Throws out every row scored on a day that has not happened. The caller asks first. */
  const dropDatedAhead = async () => {
    if (datedAhead.length === 0) return;
    setDropping("games");
    try {
      await onDropGames(datedAhead.map((game) => game.id));
    } finally {
      setDropping(null);
    }
  };

  /** Throws out a club outright: the team, its rows, and its GameChanger ids. */
  const dropClub = async (club: UnrealClub) => {
    setDropping(club.teamId);
    try {
      await onDropClub(club);
    } finally {
      setDropping(null);
    }
  };

  /** Folds one of the pairs in, and takes it off the list only if it actually happened. */
  const fold = async (pairing: GcSeasonPairing) => {
    const key = `${pairing.fromTeamId}>${pairing.toTeamId}`;
    setMerging(key);
    try {
      const done = await onMergeTeams(pairing.fromTeamId, pairing.toTeamId);
      if (!done) return;
      setDuplicates((current) =>
        (current ?? []).filter(
          (entry) =>
            entry.fromTeamId !== pairing.fromTeamId && entry.toTeamId !== pairing.fromTeamId
        )
      );
    } finally {
      setMerging(null);
    }
  };

  /** The two as two clubs, for good: remembered against the GameChanger ids, as above. */
  const keepTwinsApart = (offer: GcTwinSquad) => {
    saveKeptApart(apartAfter(loadKeptApart(), offer.fromGcId, offer.toGcId));
    setTwins((current) =>
      (current ?? []).filter(
        (entry) => entry.fromGcId !== offer.fromGcId || entry.toGcId !== offer.toGcId
      )
    );
  };

  /**
   * Folds one of the two into the other, keeping the one the user picked. A fold changes which
   * games each club holds, so an offer that named the club folded away is taken off the list too:
   * Check the pool again works the rest out afresh.
   */
  const foldTwin = async (offer: GcTwinSquad, keep: "from" | "to") => {
    const [goneId, keptId] =
      keep === "to" ? [offer.fromTeamId, offer.toTeamId] : [offer.toTeamId, offer.fromTeamId];
    const key = `${offer.fromTeamId}>${offer.toTeamId}`;
    setMerging(key);
    try {
      const done = await onMergeTeams(goneId, keptId);
      if (!done) return;
      setTwins((current) =>
        (current ?? []).filter(
          (entry) => entry !== offer && entry.fromTeamId !== goneId && entry.toTeamId !== goneId
        )
      );
    } finally {
      setMerging(null);
    }
  };

  /**
   * The list as a file. A to-do rather than an import format: GameChanger has no id for any of
   * these — that is why they are on the list — so it carries what it takes to find them.
   */
  const downloadTwice = () => {
    if (!twice || twice.length === 0) return;
    downloadCsv(countedTwiceCsvFilename(fileDay()), countedTwiceCsv(twice));
  };

  const downloadToPull = () => {
    if (!toPull || toPull.length === 0) return;
    downloadCsv("Clubs_To_Pull.csv", unpulledClubsCsv(toPull));
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
    downloadCsv(
      poolNamesCsvFilename(fileDay()),
      poolNamesCsvParts(pool.teams, pool.ageGroups, pool.games)
    );
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
      const parts = await standInFixturesCsvParts(
        pool.teams,
        pool.ageGroups,
        pool.games,
        (searched, of) => {
          setFixturesProgress(Math.floor((100 * searched) / of));
          return new Promise((resolve) => setTimeout(resolve, 0));
        }
      );
      downloadCsv(standInFixturesCsvFilename(fileDay()), parts);
    } finally {
      setFixturesProgress(null);
    }
  };

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Pool health</h2>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        What the pool is made of, and what the tidy could still settle. A result filed against a
        stand-in counts for nobody — the club that played it is sitting on the other side&apos;s
        schedule, waiting to be matched.
      </p>

      {emptied.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm font-black text-red-700 dark:text-red-300">
            {emptied.length === 1
              ? `${yearLabel(emptied[0]?.year)} has lost its games`
              : `${count(emptied.length)} squad years have lost their games: ${emptied
                  .map((holding) => yearLabel(holding.year))
                  .join(", ")}`}
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            Its pages and its teams are still here, and not one game is stored against it. That is
            not what an unpulled year looks like — a year nobody has pulled has no teams either.
            Restore a backup from before it went, or pull that year again.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void look()}
          disabled={busy !== null || pool.games.length === 0}
          className={button.ghost}
        >
          {busy === "inspect" ? "Looking…" : health ? "Look again" : "Check the pool"}
        </button>
        {health && settleable > 0 && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy !== null || pullLive}
            className={button.primary}
          >
            {busy === "tidy" ? "Tidying…" : `Settle ${count(settleable)} of them`}
          </button>
        )}
      </div>

      {pullLive && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          A pull is running, so this waits. Both write the whole pool, and the one that finishes
          second would overwrite what the other had just saved.
        </p>
      )}

      {(busy === "tidy" || progress.steps.length > 0 || progress.now) && (
        <>
          {busy === "tidy" && (
            <p className="mt-2 text-xs text-slate-500">
              Walking every game, several times over. On a nationwide pool this takes a while — the
              page stays usable while it runs.
            </p>
          )}
          <TidyProgressView watch={progress} running={busy === "tidy"} />
        </>
      )}

      {health && (
        <div className="mt-4 text-sm">
          <p>
            {health.tidied ? (
              <span className={pill("emerald")}>Tidied</span>
            ) : (
              <span className={pill("amber")}>Not tidied since it last changed</span>
            )}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <Row
              label="Games"
              value={count(health.games)}
              note={`${count(health.played)} played`}
            />
            <Row
              label="Clubs"
              value={count(health.clubs)}
              note={`of ${count(health.teams)} entries`}
            />
            <Row
              label="Known only by name"
              value={count(health.nameOnly)}
              note="never pulled; an opponent, never ranked"
            />
            <Row label="Stand-ins" value={count(health.placeholders)} note="a TBD names nobody" />
            <Row
              label="Results against a stand-in"
              value={count(health.standInPlayed)}
              note={`of ${count(health.standInGames)} such games`}
            />
            {health.undated > 0 && (
              <Row
                label="No date"
                value={count(health.undated)}
                note="cannot be placed in a season"
              />
            )}
            {health.futureDated > 0 && (
              <Row
                label="Results dated ahead"
                value={count(health.futureDated)}
                note="scored, on a day that has not happened"
              />
            )}
          </dl>

          <p className="mt-3 text-sm">
            {settleable > 0 ? (
              <>
                <strong>{count(settleable)}</strong> of those can be settled right now — the other
                side&apos;s schedule names the club and the scores mirror.
              </>
            ) : health.standInPlayed > 0 ? (
              <>
                None of them can be settled from what is here: nobody has pulled the other side of
                those games yet.
              </>
            ) : (
              <>Nothing is waiting.</>
            )}
          </p>
        </div>
      )}

      {holdings.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            What each squad year holds
          </h3>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {holdings.map((holding) => (
              <li key={String(holding.year)}>
                <span
                  className={
                    holding.emptied
                      ? "font-bold text-red-700 dark:text-red-300"
                      : "font-bold text-slate-700 dark:text-slate-200"
                  }
                >
                  {yearLabel(holding.year)}
                </span>
                {" — "}
                {plural(holding.pages, "page")}, {plural(holding.teams, "team")},{" "}
                {plural(holding.games, "game")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {datedAhead.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            Scored on a day that has not happened
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(datedAhead.length)}</strong>{" "}
            {datedAhead.length === 1 ? "game carries" : "games carry"} a score on a date still to
            come. A game cannot be scored early — a schedule opened ahead of time comes back without
            one — so each of these is a wrong date or an invention, and every one of them is
            counting in a record and a rating right now.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {aheadWorstFirst.slice(0, 6).map(({ game, filer, gcId }) => (
              <li key={game.id}>
                <span className="font-bold text-slate-700 dark:text-slate-200">{game.date}</span>
                {" — "}
                {teamName(game.teamAId)} {game.teamAScore}–{game.teamBScore}{" "}
                {teamName(game.teamBId)}
                {gcId && (
                  <>
                    {" · "}
                    <a
                      href={gcTeamPageUrl(gcId)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-slate-950 dark:hover:text-white"
                    >
                      {teamName(filer)}&rsquo;s schedule
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
          {datedAhead.length > 6 && (
            <p className="mt-2 text-xs text-slate-500">
              Drawing 6 of {count(datedAhead.length)}, the worst club&rsquo;s first.
            </p>
          )}
          <button
            type="button"
            onClick={() => void dropDatedAhead()}
            disabled={dropping !== null || pullLive}
            className={`${button.ghost} mt-3 text-sm`}
          >
            {dropping === "games" ? "Deleting…" : `Delete ${plural(datedAhead.length, "game")}`}
          </button>

          {unreal.length > 0 && (
            <>
              <h4 className="mt-4 text-xs font-black uppercase tracking-wide text-slate-500">
                The clubs they belong to
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                Deleting the rows while the club that files them is still in the pull list only
                lasts until the next run. A club that is all impossible games is not a club:
                deleting one takes its whole schedule with it and refuses its GameChanger id from
                then on.
              </p>
              <ul className="mt-2 space-y-1">
                {(allClubs ? unreal : unreal.slice(0, 12)).map((club) => (
                  <li key={club.teamId} className="text-xs">
                    <span className="font-bold text-slate-700 dark:text-slate-200">
                      {club.name}
                    </span>{" "}
                    {club.gcTeamIds.map((gcId, at) => (
                      <a
                        key={gcId}
                        href={gcTeamPageUrl(gcId)}
                        target="_blank"
                        rel="noreferrer"
                        className="mr-1 text-slate-500 underline hover:text-slate-950 dark:hover:text-white"
                      >
                        {club.gcTeamIds.length > 1 ? `schedule ${at + 1}` : "schedule"}
                      </a>
                    ))}
                    <span className="text-slate-500">
                      {[club.city, club.state].filter(Boolean).join(", ")}
                    </span>{" "}
                    <span className={pill(club.ahead === club.played ? "amber" : "emerald")}>
                      {count(club.ahead)} of {plural(club.played, "played game")} impossible
                    </span>{" "}
                    <button
                      type="button"
                      onClick={() => void dropClub(club)}
                      disabled={dropping !== null || pullLive}
                      className={`${button.ghost} text-xs`}
                    >
                      {dropping === club.teamId ? "Deleting…" : "Delete club"}
                    </button>
                  </li>
                ))}
              </ul>
              {unreal.length > 12 && (
                <p className="mt-2 text-xs text-slate-500">
                  {allClubs
                    ? `All ${count(unreal.length)}, worst first. `
                    : `Drawing 12 of ${count(unreal.length)}, worst first. `}
                  <button
                    type="button"
                    onClick={() => setAllClubs((shown) => !shown)}
                    className="underline hover:text-slate-950 dark:hover:text-white"
                  >
                    {allClubs ? "Show the worst 12" : `Show all ${count(unreal.length)}`}
                  </button>
                </p>
              )}
            </>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Deleted for good: each one is remembered by its GameChanger id, so the next pull of that
            schedule does not file it again. A date corrected on GameChanger does not bring it back
            either — if one of these turns out to be a real game, add it by hand.
          </p>
        </div>
      )}

      {duplicates && duplicates.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            One club, listed twice
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(duplicates.length)}</strong>{" "}
            {duplicates.length === 1 ? "club is" : "clubs are"} here as two entries of the same
            season at the same age. GameChanger gives a team a new id every season, so a club that
            makes one, leaves it and makes another ends up with two — and the games of one season
            are split between them, with each side ranked on half a record.
          </p>
          <ul className="mt-2 space-y-2">
            {duplicates.slice(0, 10).map((pairing) => {
              const key = `${pairing.fromTeamId}>${pairing.toTeamId}`;
              return (
                <li key={key} className="text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {pairing.fromTeamName}
                  </span>{" "}
                  <span className="text-slate-500">into {pairing.toTeamName}</span>{" "}
                  <span className={pill(pairing.confidence === "strong" ? "emerald" : "amber")}>
                    {[
                      ...(pairing.sameName ? ["same name"] : []),
                      ...pairing.evidence.map((item) => GC_PAIRING_EVIDENCE_LABEL[item]),
                    ].join(" · ")}
                  </span>{" "}
                  <button
                    type="button"
                    onClick={() => void fold(pairing)}
                    disabled={merging !== null || pullLive}
                    className={`${button.ghost} text-xs`}
                  >
                    {merging === key ? "Folding…" : "Fold in"}
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => keepApart(pairing)}
                    disabled={merging !== null || pullLive}
                    className={`${button.ghost} text-xs`}
                  >
                    Not the same
                  </button>
                </li>
              );
            })}
          </ul>
          {duplicates.length > 10 && (
            <p className="mt-2 text-xs text-slate-500">
              Drawing 10 of {count(duplicates.length)}. Check the pool again after folding these in
              for the rest.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Never done for you, however certain it looks. A club running an A and a B squad at one
            age names them the same thing in the same town, and folding those two together costs the
            club half its history — so the same name exactly, the same age, the same town, the same
            state and two coaches in common is what puts a pair on this list, and you say whether it
            is right. <strong>Not the same</strong> is remembered against the two GameChanger ids,
            so the pair is never offered again — not after the next pull, and not after a reset.
          </p>
        </div>
      )}

      {twins && twins.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            One squad on GameChanger twice
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(twins.length)}</strong>{" "}
            {twins.length === 1 ? "pair of teams posts" : "pairs of teams post"} the same games: at
            least two against the same opponent at the same minute with the same result, and never a
            game against each other. Most are one squad set up twice — a coach&apos;s own team and a
            parent&apos;s, or a tournament desk&apos;s copy — and each of those games counts twice
            for every club that played it.
          </p>
          <ul className="mt-2 space-y-3">
            {twins.slice(0, 10).map((offer) => {
              const key = `${offer.fromTeamId}>${offer.toTeamId}`;
              return (
                <li key={key} className="text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {offer.fromTeamName}
                  </span>{" "}
                  <span className="text-slate-500">and</span>{" "}
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {offer.toTeamName}
                  </span>{" "}
                  <span className={pill("amber")}>
                    {plural(offer.shared.length, "game")} in common
                  </span>
                  <p className="mt-1 text-slate-500">
                    GameChanger: {offer.fromTeamName} {recordLabel(offer.fromRecord)}
                    {offer.fromPlayers === undefined
                      ? ""
                      : `, ${plural(offer.fromPlayers, "player")}`}
                    {" · "}
                    {offer.toTeamName} {recordLabel(offer.toRecord)}
                    {offer.toPlayers === undefined ? "" : `, ${plural(offer.toPlayers, "player")}`}
                  </p>
                  <ul className="mt-1 text-slate-500">
                    {offer.shared.slice(0, 3).map((game) => (
                      <li key={`${game.date}|${game.startTs}|${game.opponentName}`}>
                        {game.date} v {game.opponentName}, {game.ownScore}-{game.opponentScore}
                      </li>
                    ))}
                    {offer.shared.length > 3 && <li>and {count(offer.shared.length - 3)} more</li>}
                  </ul>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => void foldTwin(offer, "to")}
                      disabled={merging !== null || pullLive}
                      className={`${button.ghost} text-xs`}
                    >
                      {merging === key ? "Folding…" : `Keep ${offer.toTeamName}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void foldTwin(offer, "from")}
                      disabled={merging !== null || pullLive}
                      className={`${button.ghost} text-xs`}
                    >
                      {`Keep ${offer.fromTeamName}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => keepTwinsApart(offer)}
                      disabled={merging !== null || pullLive}
                      className={`${button.ghost} text-xs`}
                    >
                      Not the same
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {twins.length > 10 && (
            <p className="mt-2 text-xs text-slate-500">
              Drawing 10 of {count(twins.length)}. Check the pool again after these for the rest.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Never done for you. <strong>Keep</strong> folds the other team into the one you keep,
            with its games and its GameChanger link, so pick the name the squad goes by. Two squads
            of one club can share a tournament&apos;s opponents too, which is why a pair that ever
            played each other, or had two games within the hour, is never offered.{" "}
            <strong>Not the same</strong> is remembered against the two GameChanger ids, so the pair
            is not offered again.
          </p>
        </div>
      )}

      {twice && twice.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            Clubs credited twice with one game
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(twice.length)}</strong> times a club holds two counted games on one day
            that start within the hour of each other, with the same result. A club plays one game at
            a time, so that is one game entered twice — nearly always against two entries for one
            opponent: a club on GameChanger twice, a name spelled two ways, or a stand-in beside the
            club it stands for.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {twice.slice(0, 10).map((group) => (
              <li key={`${group.teamId}|${group.games[0]?.gameId ?? group.date}`}>
                {onOpenTeam ? (
                  <button
                    type="button"
                    onClick={() => onOpenTeam(group.teamId)}
                    className="font-bold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {group.teamName}
                  </button>
                ) : (
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {group.teamName}
                  </span>
                )}
                {` — ${group.date}, ${group.own}-${group.opponent} v `}
                {group.games.map((game) => game.opponentName).join(" and v ")}
                {group.minutesApart === 0
                  ? ", at the same start"
                  : `, ${plural(group.minutesApart, "minute")} apart`}
              </li>
            ))}
          </ul>
          <button type="button" onClick={downloadTwice} className={`${button.ghost} mt-3 text-sm`}>
            Download the list ({count(twice.length)})
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Nothing is changed for you. Open a club to see both games. Where the opponent is one
            squad set up twice on GameChanger, the list of those above offers to fold the two once
            they post the same games; the file names both entries of every one.
          </p>
        </div>
      )}

      {toPull && toPull.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            Clubs worth pulling next
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(toPull.length)}</strong> clubs are named on schedules you have pulled and
            have no schedule of their own here. Nothing in the pool can identify them — only pulling
            them can. Each one you add turns its games into a real result on both sides.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {toPull.slice(0, 5).map((club) => (
              <li key={club.teamId}>
                <span className="font-bold text-slate-700 dark:text-slate-200">{club.name}</span>
                {" — "}
                {club.played} result{club.played === 1 ? "" : "s"} waiting
                {club.states.length > 0 ? ` · ${club.states.join(", ")}` : ""}
                {club.levels.length > 0
                  ? ` · ${club.levels.map((level) => `${level}U`).join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
          <button type="button" onClick={downloadToPull} className={`${button.ghost} mt-3 text-sm`}>
            Download the list ({count(toPull.length)})
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Ordered by how much each is holding up. The file carries the name, where the clubs that
            named it are from, the age level and season, and who played it — enough to find the team
            on GameChanger and paste its id into the next pull.
          </p>
        </div>
      )}

      {lastTidy && (
        <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
          {lastTidy.length === 0 ? (
            <li>Nothing left to do.</li>
          ) : (
            lastTidy.map((line) => <li key={line}>{line}</li>)
          )}
        </ul>
      )}

      {pool.teams.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button type="button" onClick={downloadPoolNames} className={`${button.ghost} text-sm`}>
            Download the pool names ({count(pool.teams.length)})
          </button>
          <p className="mt-2 text-xs text-slate-500">
            For measuring a rule against the teams it must not break. Ids, names and the age each
            team is already filed under — no games, so it is a few megabytes rather than the
            hundreds a whole-browser backup runs to. Nothing in the app reads it: it is the file the
            ageless sweep needs to answer &ldquo;what would this rule do to a team that already
            works?&rdquo;, which cannot be asked of the backlog alone.
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
          <p className="mt-2 text-xs text-slate-500">
            Every result filed against a stand-in or a TBD, and beside it any other club&apos;s row
            at the same start time, or the same day, that could be the other half of the same game —
            spelling slips and all — with the same searches run a week either side as a check on
            chance. Nothing in the app reads it: it is what measures joining a stand-in to its club
            by the game rather than the name. Takes ten seconds or so on a large pool.
          </p>
        </div>
      )}
    </div>
  );
}
