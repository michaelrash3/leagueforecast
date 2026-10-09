import { useMemo, useState, type ReactNode } from "react";
import type { GcSeasonPairing, GcTwinSquad } from "../../lib/gameChangerImport";
import { GC_PAIRING_EVIDENCE_LABEL } from "../../lib/gcPairingEvidence";
import type { PoolHealth } from "../../lib/poolHealth";
import {
  aheadWorstFirst,
  clubOf,
  type HealthGame,
  type PoolHealthSummary,
} from "../../lib/poolHealthSummary";
import { TO_PULL_DRAWN, type PoolLists } from "../../lib/poolLists";
import { IMPLAUSIBLE_MARGIN, segmentOn } from "../../lib/teamRankings";
import { apartKey, isKeptApart, type KeptApart } from "../../lib/keptApart";
import type { WrongAgeClub } from "../../lib/wrongAge";
import type { UnrealClub } from "../../lib/unrealClubs";
import { gcTeamPageUrl } from "../../lib/gameChangerApi";
import { downloadCsv, fileDay } from "../../lib/download";
import { countedTwiceCsv, countedTwiceCsvFilename } from "../../lib/countedTwice";
import { button, card, pill } from "../../styles/tokens";

/**
 * Pool health as it is drawn, from what it is told rather than from a pool it holds: what the pool
 * shows as it opens (`PoolHealthSummary`), the answers already given, what "Check the pool" found,
 * and what each button does. The device's own card works these out from the pool in this browser
 * (`PoolHealthCard`); the live page's asks the server for them and sends each button as an edit
 * (`LivePoolHealthCard`). So the two are one card, drawn alike.
 */

export type BulkAgeResult = {
  changedTeamIds: string[];
  failed: number;
};

/** Why a list's rows are being thrown out, which is what the question before it says. */
export type GamesDropped = "ahead" | "implausible";

/** The answers the lists leave out, by GameChanger id (the pairs by `apartKey`). */
export type PoolHealthAnswers = {
  realClubs: ReadonlySet<string>;
  ageRight: ReadonlySet<string>;
  keptApart: KeptApart;
};

/** What "Check the pool" found: the numbers, how many could be settled now, and the lists. */
export type PoolHealthInspection = {
  health: PoolHealth;
  settleable: number;
  lists: PoolLists;
  /**
   * How many clubs are worth pulling, where the lists hold only the ones drawn (`TO_PULL_DRAWN`),
   * as the server sends them; absent where they hold every one.
   */
  toPullCount?: number;
};

/** A club as a question about it names it. */
export type ClubNamed = { id: string; name: string };

/** What each of the card's buttons does: each answers whether it happened. */
export type PoolHealthActions = {
  /** Adds and takes ids on one of the answer lists; the card is told the lists as they then stand. */
  answer: (
    list: keyof PoolHealthAnswers,
    add: string[],
    remove: string[]
  ) => Promise<boolean> | boolean;
  /**
   * Throws these rows out and remembers them, so the next pull of the same schedule does not file
   * them again. See `deletedGames.ts` for why a deletion has to be remembered rather than done.
   */
  dropGames: (ids: readonly string[], why: GamesDropped) => Promise<boolean>;
  /**
   * Throws a club out: the team, every row it is in, and its GameChanger ids, so a pull refuses
   * its schedule rather than rebuilding it. See `deletedGames.ts`.
   */
  dropClub: (club: UnrealClub) => Promise<boolean>;
  /**
   * Says a game won by more than `IMPLAUSIBLE_MARGIN` runs really was played that way, so it counts
   * and leaves the list (`ScoutGame.scoreConfirmed`).
   */
  confirmScore: (game: HealthGame) => Promise<boolean>;
  /** Folds one club into another, asking first. */
  merge: (from: ClubNamed, into: ClubNamed) => Promise<boolean>;
  /**
   * Files a club at the age its evidence points to in its squad year and holds it there, as its
   * own panel does (`setClubAge`, pinned).
   */
  setAge?: (club: WrongAgeClub) => Promise<boolean> | boolean;
  /** Confirms and files all the evidence-backed suggestions as one saved, undoable change. */
  setAges?: (clubs: readonly WrongAgeClub[]) => Promise<BulkAgeResult | null>;
  /**
   * Opens a club's own panel, for a list that names clubs to look at, with the squad year its row
   * is of where the row says one: the live page reads a club's card by year, and opened a club of
   * another year on the board's, which has no card of it.
   */
  openTeam?: (teamId: string, year?: number) => void;
  /** Downloads every club worth pulling, as a file. */
  downloadToPull: () => void;
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
    <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="font-bold text-slate-950 dark:text-white">
      {value}
      {note ? (
        <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{note}</span>
      ) : null}
    </dd>
  </>
);

/**
 * What the lists have had done to them since the look that found them: the clubs folded away,
 * which no offer names once gone, and the clubs filed at their age. A new look starts again.
 */
type SinceLook = { folded: ReadonlySet<string>; aged: ReadonlySet<string> };
const NOTHING_SINCE: SinceLook = { folded: new Set(), aged: new Set() };

/** An offer to fold one club into another: the two by this pool's ids and by GameChanger's. */
type Offer = { fromTeamId: string; toTeamId: string; fromGcId: string; toGcId: string };

/** Whether an offer still stands: neither kept apart, nor naming a club folded away since. */
const stillOffered =
  (apart: KeptApart, folded: ReadonlySet<string>) =>
  (offer: Offer): boolean =>
    !isKeptApart(apart, offer.fromGcId, offer.toGcId) &&
    !folded.has(offer.fromTeamId) &&
    !folded.has(offer.toTeamId);

/**
 * What the pool is actually made of, and what is waiting to be fixed.
 *
 * There was nothing anywhere that would tell you a pool of two hundred thousand games had eleven
 * thousand results still filed against "TBD" — the code that settles them worked, it had just
 * never finished running, and a pool in that state looks exactly like a pool in good order. These
 * are the numbers that say which.
 */
export function PoolHealthView({
  summary,
  answers,
  inspection,
  looking,
  canLook,
  onLook,
  held,
  actions,
  beside,
  under,
  foot,
}: {
  summary: PoolHealthSummary;
  answers: PoolHealthAnswers;
  inspection: PoolHealthInspection | null;
  /** Whether "Check the pool" is under way, and whether it can be pressed now. */
  looking: boolean;
  canLook: boolean;
  onLook: () => void;
  /**
   * Whether the edits that change the pool are held off: while a pull is running here, both would
   * write the whole pool, and the one that finished second would overwrite what the other saved.
   */
  held: boolean;
  actions: PoolHealthActions;
  /** Beside "Check the pool": the device's own Settle. */
  beside?: ReactNode;
  /** Under the buttons: what holds the edits off, and the tidy's progress. */
  under?: ReactNode;
  /** At the foot: what the last tidy did, and the files only the device's own pool can make. */
  foot?: ReactNode;
}) {
  const health = inspection?.health ?? null;
  const settleable = inspection?.settleable ?? 0;
  const emptied = summary.holdings.filter((holding) => holding.emptied);

  // A new look starts the lists again; until then, what was done to them is taken off them.
  const [lookedAt, setLookedAt] = useState(inspection);
  const [since, setSince] = useState<SinceLook>(NOTHING_SINCE);
  if (lookedAt !== inspection) {
    setLookedAt(inspection);
    setSince(NOTHING_SINCE);
  }
  const lists = inspection?.lists ?? null;
  /**
   * One club sitting in the pool as two entries of the same season.
   *
   * These were offered only on the screen that comes up when a pull finishes — so a club split in
   * two was findable for about a minute, and after that the pool simply had two of it, ranked
   * separately, each holding part of the same season's games.
   */
  const duplicates = useMemo(
    () => lists?.duplicates.filter(stillOffered(answers.keptApart, since.folded)) ?? null,
    [lists, answers.keptApart, since.folded]
  );
  /** One squad on GameChanger twice under two names: two clubs posting the same games. */
  const twins = useMemo(
    () => lists?.twins.filter(stillOffered(answers.keptApart, since.folded)) ?? null,
    [lists, answers.keptApart, since.folded]
  );
  /** Clubs holding one game twice: two counted games within the hour with one result. */
  const twice = lists?.twice ?? null;
  const toPull = lists?.toPull ?? null;
  const toPullCount = inspection?.toPullCount ?? toPull?.length ?? 0;
  /** Clubs whose name and opponents say they play at another age than they are filed at. */
  const wrongAge = useMemo(
    () => lists?.wrongAge.filter((club) => !since.aged.has(club.teamId)) ?? null,
    [lists, since.aged]
  );
  const [allWrongAge, setAllWrongAge] = useState(false);
  /**
   * The clubs the user has said are filed at the right age, by GameChanger id: a club that really
   * does play up or down, an answer given once, as a club vouched for as real is.
   */
  const misfiled = useMemo(
    () =>
      wrongAge?.filter((club) => !club.gcTeamIds.some((id) => answers.ageRight.has(id))) ?? null,
    [wrongAge, answers.ageRight]
  );
  /** The clubs the list would still name but for the user's word that their age is right. */
  const keptAtAge = useMemo(
    () => wrongAge?.filter((club) => club.gcTeamIds.some((id) => answers.ageRight.has(id))) ?? [],
    [wrongAge, answers.ageRight]
  );
  const [showKeptAtAge, setShowKeptAtAge] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);
  const [settingAges, setSettingAges] = useState(false);

  /**
   * The rows with a score on a day that has not happened.
   *
   * You cannot score a game early. A schedule can be opened ahead of time by accident, but it
   * comes back without a score — so a scored row dated in the future is a wrong date or an
   * invention, and a nationwide pool carries both: one club here held a 106-13 record built
   * entirely on games nobody had played, and another was called "Test team".
   */
  const datedAhead = summary.datedAhead;

  /*
   * The clubs those rows belong to, worst first, but for the ones the user has said are real, by
   * GameChanger id, which stay off the list: an answer given once, as a club thrown out stays
   * thrown out. `keptReal` are the clubs the list would still name but for that word, so it can be
   * taken back: an answer given by mistake on a club that is plainly made up was otherwise for
   * good, with nothing on the page to undo it.
   *
   * Deleting the rows one at a time is endless while the club that invented them is still in the
   * pull list: the next run files a fresh set. The club is the thing to delete, and the share of
   * its record that is impossible is what says whether it is a club at all — "Test team" with 68
   * of 68 is not one; a side with 3 of 40 has some wrong dates on it.
   */
  const { unreal, keptReal } = useMemo(() => {
    const vouched = (club: UnrealClub) =>
      (club.gcTeamIds.length > 0 ? club.gcTeamIds : [club.teamId]).some((id) =>
        answers.realClubs.has(id)
      );
    return {
      unreal: summary.suspected.filter((club) => !vouched(club)),
      keptReal: summary.suspected.filter(vouched),
    };
  }, [summary.suspected, answers.realClubs]);
  const [showKeptReal, setShowKeptReal] = useState(false);

  /**
   * Games won by more than `IMPLAUSIBLE_MARGIN` runs, the widest first: none of them counts, and
   * each is here to be deleted or vouched for (`isImplausibleScore`).
   */
  const implausible = summary.implausible;
  const [allImplausible, setAllImplausible] = useState(false);

  /**
   * The rows themselves, the worst club's first: each row sits where the club that filed it sits
   * on the list below, and a club's rows run in date order. So the rows on screen are the ones
   * doing the most damage, and each one says whose schedule to open to see it.
   */
  const aheadRows = useMemo(() => aheadWorstFirst(summary, unreal), [summary, unreal]);
  const [allClubs, setAllClubs] = useState(false);

  const teamName = (teamId: string) => clubOf(summary, teamId)?.name ?? teamId;

  /**
   * Says the two are two clubs, and means it for good.
   *
   * Recorded against the GameChanger ids rather than this pool's, because those are what the next
   * pull brings back unchanged — see `keptApart.ts`. Without it the same handful of namesakes come
   * back on this list after every pull, and a list that re-asks a question already answered is a
   * list that stops being read.
   */
  const keepApart = (pairing: { fromGcId: string; toGcId: string }) =>
    void actions.answer("keptApart", [apartKey(pairing.fromGcId, pairing.toGcId)], []);

  /**
   * Files a listed club at the age its evidence points to, and takes it off the list if that
   * happened. The level is pinned, as setting it on the club's panel does, so the next pull keeps
   * it there.
   */
  const setAge = async (club: WrongAgeClub) => {
    if (!(await actions.setAge?.(club))) return;
    setSince((was) => ({ ...was, aged: new Set([...was.aged, club.teamId]) }));
  };

  const setAllAges = async () => {
    if (!actions.setAges || !misfiled?.length) return;
    setSettingAges(true);
    const result = await actions.setAges(misfiled);
    setSettingAges(false);
    if (!result) return;
    setSince((was) => ({ ...was, aged: new Set([...was.aged, ...result.changedTeamIds]) }));
  };

  /** The age it is filed at is right: it plays up or down. Remembered against its GameChanger ids. */
  const ageIsRight = (club: WrongAgeClub) => void actions.answer("ageRight", club.gcTeamIds, []);

  /** Takes the user's word that a club's age is right back: it goes on the list again. */
  const ageIsWrongAfterAll = (club: WrongAgeClub) =>
    void actions.answer("ageRight", [], club.gcTeamIds);

  /** Throws out every row scored on a day that has not happened. The caller asks first. */
  const dropDatedAhead = async () => {
    if (datedAhead.length === 0) return;
    setDropping("games");
    try {
      await actions.dropGames(
        datedAhead.map((game) => game.id),
        "ahead"
      );
    } finally {
      setDropping(null);
    }
  };

  /** Throws out the games won by more than thirty runs, these ones or all of them. */
  const dropImplausible = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    setDropping(ids.length === 1 ? ids[0]! : "implausible");
    try {
      await actions.dropGames(ids, "implausible");
    } finally {
      setDropping(null);
    }
  };

  /** Counts a game won by more than thirty runs after all, because the user says it was real. */
  const confirmScore = async (game: HealthGame) => {
    setDropping(game.id);
    try {
      await actions.confirmScore(game);
    } finally {
      setDropping(null);
    }
  };

  /**
   * Takes a club off the list for good because the user says it is real: remembered by its
   * GameChanger ids, as a club thrown out is, so the next pull does not put it back.
   */
  const confirmClub = (club: UnrealClub) =>
    void actions.answer(
      "realClubs",
      club.gcTeamIds.length > 0 ? club.gcTeamIds : [club.teamId],
      []
    );

  /** Takes the user's word that a club is real back: it goes on the list again. */
  const unconfirmClub = (club: UnrealClub) =>
    void actions.answer("realClubs", [], [club.teamId, ...club.gcTeamIds]);

  /** Throws out a club outright: the team, its rows, and its GameChanger ids. */
  const dropClub = async (club: UnrealClub) => {
    setDropping(club.teamId);
    try {
      await actions.dropClub(club);
    } finally {
      setDropping(null);
    }
  };

  /**
   * Folds one club into another, and takes every offer naming the one folded away off the lists
   * only if it actually happened: the club is gone, and Check the pool again works the rest out
   * afresh.
   */
  const foldAway = async (key: string, from: ClubNamed, into: ClubNamed) => {
    setMerging(key);
    try {
      if (!(await actions.merge(from, into))) return;
      setSince((was) => ({ ...was, folded: new Set([...was.folded, from.id]) }));
    } finally {
      setMerging(null);
    }
  };

  /** Folds one of the pairs in. */
  const fold = (pairing: GcSeasonPairing) =>
    foldAway(
      `${pairing.fromTeamId}>${pairing.toTeamId}`,
      { id: pairing.fromTeamId, name: pairing.fromTeamName },
      { id: pairing.toTeamId, name: pairing.toTeamName }
    );

  /** Folds one of the two into the other, keeping the one the user picked. */
  const foldTwin = (offer: GcTwinSquad, keep: "from" | "to") => {
    const from = { id: offer.fromTeamId, name: offer.fromTeamName };
    const to = { id: offer.toTeamId, name: offer.toTeamName };
    return foldAway(
      `${offer.fromTeamId}>${offer.toTeamId}`,
      keep === "to" ? from : to,
      keep === "to" ? to : from
    );
  };

  /**
   * The list as a file. A to-do rather than an import format: GameChanger has no id for any of
   * these — that is why they are on the list — so it carries what it takes to find them.
   */
  const downloadTwice = () => {
    if (!twice || twice.length === 0) return;
    downloadCsv(countedTwiceCsvFilename(fileDay()), countedTwiceCsv(twice));
  };

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Pool health
      </h2>
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
        <button type="button" onClick={onLook} disabled={!canLook} className={button.ghost}>
          {looking ? "Looking…" : health ? "Look again" : "Check the pool"}
        </button>
        {beside}
      </div>

      {under}

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

      {summary.holdings.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            What each squad year holds
          </h3>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {summary.holdings.map((holding) => (
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
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Scored on a day that has not happened
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(datedAhead.length)}</strong>{" "}
            {datedAhead.length === 1 ? "game carries" : "games carry"} a score on a date still to
            come. A game cannot be scored early — a schedule opened ahead of time comes back without
            one — so each of these is a wrong date or an invention. None of them counts toward a
            record or a rating, but each stays in the pool, and comes back on the next pull, until
            it is deleted.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {aheadRows.slice(0, 6).map(({ game, filer, gcId }) => (
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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Drawing 6 of {count(datedAhead.length)}, the worst club&rsquo;s first.
            </p>
          )}
          <button
            type="button"
            onClick={() => void dropDatedAhead()}
            disabled={dropping !== null || held}
            className={`${button.ghost} mt-3 text-sm`}
          >
            {dropping === "games" ? "Deleting…" : `Delete ${plural(datedAhead.length, "game")}`}
          </button>

          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Deleted for good: each one is remembered by its GameChanger id, so the next pull of that
            schedule does not file it again. A date corrected on GameChanger does not bring it back
            either — if one of these turns out to be a real game, add it by hand.
          </p>
        </div>
      )}

      {implausible.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Won by more than {IMPLAUSIBLE_MARGIN} runs
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(implausible.length)}</strong>{" "}
            {implausible.length === 1 ? "game has" : "games have"} one side winning by more than{" "}
            {IMPLAUSIBLE_MARGIN} runs — {count(Math.round(implausible[0]!.margin))} at the most. A
            margin like that is almost always a typo or a game that never happened, so none of these
            counts toward a rating or a record. Delete the ones that are not real; if one really was
            played that way, say so and it counts.
          </p>
          <ul className="mt-2 space-y-1">
            {(allImplausible ? implausible : implausible.slice(0, 12)).map(({ game }) => {
              const filer = game.filers[0] ?? game.teamAId;
              const gcId = clubOf(summary, filer)?.gcId;
              return (
                <li key={game.id} className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {game.date ?? "No date"}
                  </span>
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
                  )}{" "}
                  <button
                    type="button"
                    onClick={() => void dropImplausible([game.id])}
                    disabled={dropping !== null || held}
                    className={`${button.ghost} text-xs`}
                  >
                    {dropping === game.id ? "Working…" : "Delete"}
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => void confirmScore(game)}
                    disabled={dropping !== null || held}
                    className={`${button.ghost} text-xs`}
                  >
                    It&rsquo;s real
                  </button>
                </li>
              );
            })}
          </ul>
          {implausible.length > 12 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {allImplausible
                ? `All ${count(implausible.length)}, the widest first. `
                : `Drawing 12 of ${count(implausible.length)}, the widest first. `}
              <button
                type="button"
                onClick={() => setAllImplausible((shown) => !shown)}
                className="underline hover:text-slate-950 dark:hover:text-white"
              >
                {allImplausible ? "Show the widest 12" : `Show all ${count(implausible.length)}`}
              </button>
            </p>
          )}
          <button
            type="button"
            onClick={() => void dropImplausible(implausible.map(({ game }) => game.id))}
            disabled={dropping !== null || held}
            className={`${button.ghost} mt-3 text-sm`}
          >
            {dropping === "implausible"
              ? "Deleting…"
              : `Delete all ${plural(implausible.length, "game")}`}
          </button>
        </div>
      )}

      {(unreal.length > 0 || keptReal.length > 0) && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Clubs that may not be real
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The clubs whose own schedules filed the games above: first the ones posting wins by more
            than {IMPLAUSIBLE_MARGIN} runs, then the ones scoring games on days that have not
            happened. Deleting the rows while the club that files them is still in the pull list
            only lasts until the next run. A club that is all impossible games is not a club:
            deleting one takes its whole schedule with it and refuses its GameChanger id from then
            on. A club you know is real can be taken off this list instead, for good; its impossible
            games still count for nothing.
          </p>
          <ul className="mt-2 space-y-1">
            {(allClubs ? unreal : unreal.slice(0, 12)).map((club) => (
              <li key={club.teamId} className="text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-200">{club.name}</span>{" "}
                {club.gcTeamIds.map((gcId, at) => (
                  <a
                    key={gcId}
                    href={gcTeamPageUrl(gcId)}
                    target="_blank"
                    rel="noreferrer"
                    className="mr-1 text-slate-500 dark:text-slate-400 underline hover:text-slate-950 dark:hover:text-white"
                  >
                    {club.gcTeamIds.length > 1 ? `schedule ${at + 1}` : "schedule"}
                  </a>
                ))}
                <span className="text-slate-500 dark:text-slate-400">
                  {[club.city, club.state].filter(Boolean).join(", ")}
                </span>{" "}
                {club.implausible > 0 && (
                  <>
                    <span className={pill("red")}>
                      {plural(club.implausible, "win")} by more than {IMPLAUSIBLE_MARGIN}
                    </span>{" "}
                  </>
                )}
                {club.ahead > 0 && (
                  <>
                    <span className={pill(club.ahead === club.played ? "amber" : "emerald")}>
                      {count(club.ahead)} of {plural(club.played, "played game")} impossible
                    </span>{" "}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void dropClub(club)}
                  disabled={dropping !== null || held}
                  className={`${button.ghost} text-xs`}
                >
                  {dropping === club.teamId ? "Deleting…" : "Delete club"}
                </button>{" "}
                <button
                  type="button"
                  onClick={() => confirmClub(club)}
                  disabled={dropping !== null}
                  className={`${button.ghost} text-xs`}
                >
                  It&rsquo;s real
                </button>
              </li>
            ))}
          </ul>
          {unreal.length > 12 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
          {keptReal.length > 0 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {plural(keptReal.length, "club")} you said {keptReal.length === 1 ? "is" : "are"} real{" "}
              {keptReal.length === 1 ? "is" : "are"} kept off this list.{" "}
              <button
                type="button"
                onClick={() => setShowKeptReal((shown) => !shown)}
                className="underline hover:text-slate-950 dark:hover:text-white"
              >
                {showKeptReal ? "Hide them" : "Show them"}
              </button>
            </p>
          )}
          {showKeptReal && keptReal.length > 0 && (
            <ul className="mt-1 space-y-1" aria-label="Clubs you said are real">
              {keptReal.map((club) => (
                <li key={club.teamId} className="text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">{club.name}</span>{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    {[club.city, club.state].filter(Boolean).join(", ")}
                  </span>{" "}
                  <button
                    type="button"
                    onClick={() => unconfirmClub(club)}
                    className={`${button.ghost} text-xs`}
                  >
                    Put it back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {duplicates && duplicates.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
                  <span className="text-slate-500 dark:text-slate-400">
                    into {pairing.toTeamName}
                  </span>{" "}
                  <span className={pill(pairing.confidence === "strong" ? "emerald" : "amber")}>
                    {[
                      ...(pairing.sameName ? ["same name"] : []),
                      ...pairing.evidence.map((item) => GC_PAIRING_EVIDENCE_LABEL[item]),
                    ].join(" · ")}
                  </span>{" "}
                  <button
                    type="button"
                    onClick={() => void fold(pairing)}
                    disabled={merging !== null || held}
                    className={`${button.ghost} text-xs`}
                  >
                    {merging === key ? "Folding…" : "Fold in"}
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => keepApart(pairing)}
                    disabled={merging !== null || held}
                    className={`${button.ghost} text-xs`}
                  >
                    Not the same
                  </button>
                </li>
              );
            })}
          </ul>
          {duplicates.length > 10 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Drawing 10 of {count(duplicates.length)}. Check the pool again after folding these in
              for the rest.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
                  <span className="text-slate-500 dark:text-slate-400">and</span>{" "}
                  <span className="font-bold text-slate-700 dark:text-slate-200">
                    {offer.toTeamName}
                  </span>{" "}
                  <span className={pill("amber")}>
                    {plural(offer.shared.length, "game")} in common
                  </span>
                  <p className="mt-1 text-slate-500 dark:text-slate-400">
                    GameChanger: {offer.fromTeamName} {recordLabel(offer.fromRecord)}
                    {offer.fromPlayers === undefined
                      ? ""
                      : `, ${plural(offer.fromPlayers, "player")}`}
                    {" · "}
                    {offer.toTeamName} {recordLabel(offer.toRecord)}
                    {offer.toPlayers === undefined ? "" : `, ${plural(offer.toPlayers, "player")}`}
                  </p>
                  <ul className="mt-1 text-slate-500 dark:text-slate-400">
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
                      disabled={merging !== null || held}
                      className={`${button.ghost} text-xs`}
                    >
                      {merging === key ? "Folding…" : `Keep ${offer.toTeamName}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void foldTwin(offer, "from")}
                      disabled={merging !== null || held}
                      className={`${button.ghost} text-xs`}
                    >
                      {`Keep ${offer.fromTeamName}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => keepApart(offer)}
                      disabled={merging !== null || held}
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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Drawing 10 of {count(twins.length)}. Check the pool again after these for the rest.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Clubs credited twice with one game
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(twice.length)}</strong> times a club holds two counted games on one day
            that start within the hour of each other, with the same result. A club plays one game at
            a time, so that is one game entered twice — nearly always against two entries for one
            opponent: a club on GameChanger twice, a name spelled two ways, or a stand-in beside the
            club it stands for. Up to three hours apart counts too where one of the two is not on
            the club&rsquo;s own schedule — a club set up twice on GameChanger often lists a game at
            two clocks — and those are marked <strong>past the hour</strong>: a doubleheader fits
            them as well, so check them on GameChanger, and one may be a copy to leave out rather
            than two entries to fold.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400">
            {twice.slice(0, 10).map((group) => (
              <li key={`${group.teamId}|${group.games[0]?.gameId ?? group.date}`}>
                {actions.openTeam ? (
                  <button
                    type="button"
                    onClick={() => actions.openTeam?.(group.teamId, segmentOn(group.date).year)}
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
                {group.wide && (
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {" "}
                    — past the hour, check on GameChanger
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={downloadTwice} className={`${button.ghost} mt-3 text-sm`}>
            Download the list ({count(twice.length)})
          </button>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Nothing is changed for you. Open a club to see both games. Where the opponent is one
            squad set up twice on GameChanger, the list of those above offers to fold the two once
            they post the same games; the file names both entries of every one.
          </p>
        </div>
      )}

      {((misfiled && misfiled.length > 0) || keptAtAge.length > 0) && (
        <div
          className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800"
          data-testid="pool-wrong-age"
        >
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Filed at the wrong age?
          </h3>
          {misfiled && misfiled.length > 0 && (
            <>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                <strong>{count(misfiled.length)}</strong> pulled{" "}
                {misfiled.length === 1 ? "club is" : "clubs are"} filed at one age in{" "}
                {misfiled[0]?.year} and {misfiled.length === 1 ? "plays" : "play"} another.
                GameChanger&apos;s age field decides the board a club sits on, and a club that sets
                it wrong sits on the wrong board all season: every game against the age it really
                plays reads as playing up or down, and its rating carries an edge it never earned.
                Listed on evidence, not a guess — its squad&apos;s name and most of its opponents,
                or its opponents alone, week after week.
              </p>
              {actions.setAge && actions.setAges && (
                <button
                  type="button"
                  onClick={() => void setAllAges()}
                  disabled={held || settingAges}
                  className={`${button.ghost} mt-2 text-sm`}
                >
                  {settingAges ? "Approving…" : "Approve all changes"}
                </button>
              )}
              <ul className="mt-2 space-y-1">
                {(allWrongAge ? misfiled : misfiled.slice(0, 12)).map((club) => {
                  const up = club.suggested > club.filed;
                  return (
                    <li key={club.teamId} className="text-xs text-slate-500 dark:text-slate-400">
                      {actions.openTeam ? (
                        <button
                          type="button"
                          onClick={() => actions.openTeam?.(club.teamId, club.year)}
                          className="font-bold text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {club.name}
                        </button>
                      ) : (
                        <span className="font-bold text-slate-700 dark:text-slate-200">
                          {club.name}
                        </span>
                      )}
                      {club.state ? ` · ${club.state}` : ""}{" "}
                      <span className={pill("amber")}>
                        filed {club.filed}U, plays {club.suggested}U
                      </span>{" "}
                      {club.reason === "name"
                        ? `its name says ${club.suggested}U; ${club.opponentsAtSuggested} of ${plural(club.opponentsKnown, "opponent")} at ${club.suggested}U`
                        : `${club.opponentsAtSuggested} of ${plural(club.opponentsKnown, "opponent")} at ${club.suggested}U, over ${plural(club.weeks, "week")}`}{" "}
                      {actions.setAge && (
                        <>
                          <button
                            type="button"
                            onClick={() => void setAge(club)}
                            disabled={held || settingAges}
                            className={`${button.ghost} text-xs`}
                          >
                            Set {club.suggested}U
                          </button>{" "}
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => ageIsRight(club)}
                        className={`${button.ghost} text-xs`}
                      >
                        {up ? "It plays up" : "It plays down"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {misfiled.length > 12 && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {allWrongAge
                    ? `All ${count(misfiled.length)}, the furthest off first. `
                    : `Drawing 12 of ${count(misfiled.length)}, the furthest off first. `}
                  <button
                    type="button"
                    onClick={() => setAllWrongAge((shown) => !shown)}
                    className="underline hover:text-slate-950 dark:hover:text-white"
                  >
                    {allWrongAge ? "Show the first 12" : `Show all ${count(misfiled.length)}`}
                  </button>
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Nothing is changed for you. <strong>Set</strong> files the club at that age for the
                year and holds it there through later pulls, as setting it on the club&apos;s own
                panel does, with an undo. <strong>It plays up</strong> (or down) says the age it is
                filed at is right, and is remembered against its GameChanger ids, so it is not asked
                again. A club whose age was set by hand is never listed.
              </p>
            </>
          )}
          {keptAtAge.length > 0 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {plural(keptAtAge.length, "club")} you said{" "}
              {keptAtAge.length === 1 ? "plays" : "play"} at the age{" "}
              {keptAtAge.length === 1 ? "it is" : "they are"} filed at{" "}
              {keptAtAge.length === 1 ? "is" : "are"} kept off this list.{" "}
              <button
                type="button"
                onClick={() => setShowKeptAtAge((shown) => !shown)}
                className="underline hover:text-slate-950 dark:hover:text-white"
              >
                {showKeptAtAge ? "Hide them" : "Show them"}
              </button>
            </p>
          )}
          {showKeptAtAge && keptAtAge.length > 0 && (
            <ul className="mt-1 space-y-1" aria-label="Clubs you said are at the right age">
              {keptAtAge.map((club) => (
                <li key={club.teamId} className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-bold text-slate-700 dark:text-slate-200">{club.name}</span>
                  {club.state ? ` · ${club.state}` : ""} · filed {club.filed}U{" "}
                  <button
                    type="button"
                    onClick={() => ageIsWrongAfterAll(club)}
                    className={`${button.ghost} text-xs`}
                  >
                    Put it back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {toPull && toPullCount > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Clubs worth pulling next
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(toPullCount)}</strong> clubs are named on schedules you have pulled and
            have no schedule of their own here. Nothing in the pool can identify them — only pulling
            them can. Each one you add turns its games into a real result on both sides.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {toPull.slice(0, TO_PULL_DRAWN).map((club) => (
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
          <button
            type="button"
            onClick={actions.downloadToPull}
            className={`${button.ghost} mt-3 text-sm`}
          >
            Download the list ({count(toPullCount)})
          </button>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Ordered by how much each is holding up. The file carries the name, where the clubs that
            named it are from, the age level and season, and who played it — enough to find the team
            on GameChanger and paste its id into the next pull.
          </p>
        </div>
      )}

      {foot}
    </div>
  );
}
