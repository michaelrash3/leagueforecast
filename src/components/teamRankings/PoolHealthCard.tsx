import { useMemo, useSyncExternalStore } from "react";
import { isPullLive, watchPull } from "../../lib/pullSession";
import { useState } from "react";
import type { GcImportState, GcSeasonPairing } from "../../lib/gameChangerImport";
import {
  describeTidy,
  proposeSeasonPairings,
  GC_PAIRING_EVIDENCE_LABEL,
} from "../../lib/gameChangerImport";
import type { PoolHealth } from "../../lib/poolHealth";
import { squadYearHoldings } from "../../lib/poolHealth";
import { loadKeptApart, saveKeptApart, storedGamesByYear } from "../../lib/teamRankingsStorage";
import { keepApart as apartAfter } from "../../lib/keptApart";
import { unpulledClubs, unpulledClubsCsv } from "../../lib/unpulledClubs";
import { usePoolTidy, type TidyOutcome } from "../../hooks/usePoolTidy";
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
};

const count = (value: number) => value.toLocaleString();

const plural = (value: number, noun: string) => `${count(value)} ${noun}${value === 1 ? "" : "s"}`;

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
export function PoolHealthCard({ pool, tidyStamp, onTidied, onMergeTeams }: PoolHealthCardProps) {
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
  const [merging, setMerging] = useState<string | null>(null);

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

  /**
   * The list as a file. A to-do rather than an import format: GameChanger has no id for any of
   * these — that is why they are on the list — so it carries what it takes to find them.
   */
  const downloadToPull = () => {
    if (!toPull || toPull.length === 0) return;
    const blob = new Blob([unpulledClubsCsv(toPull)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Clubs_To_Pull.csv";
    anchor.click();
    URL.revokeObjectURL(url);
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
                note="scored, but dated after today — a wrong date on GameChanger"
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
    </div>
  );
}
