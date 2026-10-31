import { useEffect, useLayoutEffect, useState } from "react";
import { Ago, CountUp, Move } from "../SinceParts";
import type { DigestListed } from "../../hooks/useSeasonDigest";
import type { GameLog, Matchup } from "../../lib/types";
import {
  changesSince,
  lookGames,
  readLook,
  saveLook,
  takeLook,
  type LookChanges,
  type LookRow,
  type LookSnapshot,
} from "../../lib/sinceLastLook";

/** What the Dashboard hands the card: the season as it stands, and whether its odds are settled. */
export type LookInput = {
  seasonId: string;
  /** When the season was made, which its looks keep to be told from another under its id. */
  createdAt?: string;
  /** False until the Gold odds describe this season: a look taken before would keep wrong odds. */
  ready: boolean;
  /** Each team with its name as shown. */
  rows: readonly LookRow[];
  matchups: readonly Matchup[];
  logs: Readonly<Record<string, GameLog>>;
  predictions: readonly { gameId: string; teamAId: string; pA: number }[];
  followed: string | null;
  withGold: boolean;
  /**
   * What the list of other devices' changes says as this render draws it (`useSeasonDigest`). The
   * card stands in its place while it is up, so it keeps this as it is worked out and hands it
   * back at Got it, for only that to be taken as seen.
   */
  listed?: DigestListed | null;
};

/** A look older than this is compared with; a newer one is a visit still going on. */
const VISIT_GAP_MS = 60 * 60 * 1000;

/**
 * What the open season's visit settled on: what to tell, with the look it was worked out from and
 * the list as it stood then, both kept for Got it; or a look to keep at once, if any.
 */
type Held = {
  seasonId: string;
  told?: { changes: LookChanges; look: LookSnapshot; listed: DigestListed | null };
  keep?: LookSnapshot;
};

const lookAt = (input: LookInput, at: number): LookSnapshot => ({
  ...takeLook(
    at,
    input.rows,
    lookGames(input.matchups, input.logs),
    input.predictions,
    input.withGold
  ),
  ...(input.createdAt ? { createdAt: input.createdAt } : {}),
});

const decide = (input: LookInput, at: number): Held => {
  const now = lookAt(input, at);
  const prev = readLook(input.seasonId, input.createdAt);
  // The first visit has nothing to compare with, so it only keeps where the season stands.
  if (!prev) return { seasonId: input.seasonId, keep: now };
  if (now.at - prev.at < VISIT_GAP_MS) return { seasonId: input.seasonId };
  const games = lookGames(input.matchups, input.logs);
  const changes = changesSince(prev, now, input.rows, games, input.followed);
  return changes
    ? { seasonId: input.seasonId, told: { changes, look: now, listed: input.listed ?? null } }
    : { seasonId: input.seasonId, keep: now };
};

/**
 * Compares the season with the last look once per season opened, and holds what changed until it
 * is put away. Nothing is read or written but this device's own storage.
 *
 * The card is what the season had come to as it was worked out, and stays so while it is up. Got
 * it keeps that look, not the season as it stands at the press: a final another device sent while
 * the card was up was kept as seen, never shown, and the next visit was told nothing of it.
 */
export function useSinceLastLook(input: LookInput | undefined) {
  const [held, setHeld] = useState<Held | null>(null);
  // When the Dashboard opened: the visit's time, whichever render the season is settled in.
  const [openedAt] = useState(() => Date.now());
  // Settled once the forecast describes the season, and only then: a look taken before would keep
  // odds and chances from before the latest scores.
  if (input?.ready && held?.seasonId !== input.seasonId) setHeld(decide(input, openedAt));

  useEffect(() => {
    if (held?.keep) saveLook(held.seasonId, held.keep);
  }, [held]);

  if (!input || !held?.told || held.seasonId !== input.seasonId) return null;
  const seasonId = held.seasonId;
  const told = held.told;
  return {
    changes: told.changes,
    /**
     * Keeps the look the card was worked out from, so the next visit is told what came after it,
     * and gives back what the list said then.
     */
    dismiss: (): DigestListed | null => {
      saveLook(seasonId, told.look);
      setHeld({ seasonId });
      return told.listed;
    },
  };
}

const pct = (chance: number) => `${Math.round(chance * 100)}%`;

/** The card at the top of the Dashboard: what changed since the last visit, until put away. */
export function SinceLastLookCard({
  changes,
  onDismiss,
}: {
  changes: LookChanges;
  onDismiss: () => void;
}) {
  const { team } = changes;
  return (
    <section
      aria-label="Since you last looked"
      className="rounded-lg border border-slate-950 bg-white p-5 shadow-xs dark:border-white dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-black uppercase tracking-[0.18em] text-slate-950 dark:text-white">
          Since you last looked
        </h2>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          <Ago since={changes.since} />
        </span>
      </div>

      {team && (
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {team.name}
            </dt>
            <dd className="mt-1 text-2xl font-black text-slate-950 dark:text-white">
              <span className="sr-only">
                Place {team.placeBefore} then, {team.placeNow} now
              </span>
              <span aria-hidden="true">
                #{team.placeBefore} → #<CountUp from={team.placeBefore} to={team.placeNow} />{" "}
                <span className="text-sm">
                  <Move
                    by={team.placeBefore - team.placeNow}
                    better={team.placeNow < team.placeBefore}
                  />
                </span>
              </span>
            </dd>
          </div>
          {team.goldBefore !== undefined && team.goldNow !== undefined && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Gold odds
              </dt>
              <dd className="mt-1 text-2xl font-black text-slate-950 dark:text-white">
                <span className="sr-only">
                  {Math.round(team.goldBefore)}% then, {Math.round(team.goldNow)}% now
                </span>
                <span aria-hidden="true">
                  {Math.round(team.goldBefore)}% →{" "}
                  <CountUp
                    from={Math.round(team.goldBefore)}
                    to={Math.round(team.goldNow)}
                    suffix="%"
                  />{" "}
                  <span className="text-sm">
                    <Move
                      by={Math.round(team.goldNow) - Math.round(team.goldBefore)}
                      better={team.goldNow > team.goldBefore}
                    />
                  </span>
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}

      <ul className="mt-4 space-y-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {changes.results.map((result) => (
          <li key={result.gameId}>
            <span
              className={`mr-1 font-black ${result.won === true ? "text-emerald-700 dark:text-emerald-300" : result.won === false ? "text-red-700 dark:text-red-300" : ""}`}
            >
              {result.won === true ? "W" : result.won === false ? "L" : "T"} {result.score}
            </span>{" "}
            vs {result.opponent}
            {result.chance !== undefined && (
              <span className="text-slate-600 dark:text-slate-300">
                {" "}
                · you had {pct(result.chance)}
              </span>
            )}
          </li>
        ))}
        {changes.results.length === 0 && changes.newFinals > 0 && (
          <li>
            {changes.newFinals} new result{changes.newFinals === 1 ? "" : "s"} in the league.
          </li>
        )}
        {changes.upset && (
          <li>
            <span className="font-black">Upset:</span> {changes.upset.winner} over{" "}
            {changes.upset.loser} {changes.upset.score}
            <span className="text-slate-600 dark:text-slate-300">
              {" "}
              · they had {pct(changes.upset.chance)}
            </span>
          </li>
        )}
        {(changes.passedYou.length > 0 || changes.youPassed.length > 0) && (
          <li>
            {changes.youPassed.length > 0 && (
              <>
                <span className="font-black">You passed:</span> {changes.youPassed.join(", ")}
              </>
            )}
            {changes.youPassed.length > 0 && changes.passedYou.length > 0 && " · "}
            {changes.passedYou.length > 0 && (
              <>
                <span className="font-black">Passed you:</span> {changes.passedYou.join(", ")}
              </>
            )}
          </li>
        )}
        {changes.climber && (
          <li>
            <span className="font-black">Biggest climb:</span> {changes.climber.name}, #
            {changes.climber.from} → #{changes.climber.to}
          </li>
        )}
      </ul>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
      >
        Got it
      </button>
    </section>
  );
}

/**
 * The card as the Dashboard draws it, fetched with this file as the Dashboard opens. It tells the
 * Dashboard whether it is up (`onShown`), so the list of other devices' changes stays where it is
 * and is only hidden meanwhile: drawn in the card's place until this file landed, the list was
 * drawn afresh once it did, and a Got it pressed on it as first drawn did nothing. Put away, it
 * hands `onDismiss` what the list said as the card was worked out (`LookInput.listed`).
 */
export function SinceLastLook({
  look,
  onDismiss,
  onShown,
}: {
  look: LookInput;
  onDismiss: (listed: DigestListed | null) => void;
  onShown: (shown: boolean) => void;
}) {
  const lastLook = useSinceLastLook(look);
  const shown = lastLook !== null;
  // Before the page is painted, so the list and the card are never both on screen.
  useLayoutEffect(() => {
    onShown(shown);
    return () => onShown(false);
  }, [shown, onShown]);
  if (!lastLook) return null;
  return (
    <SinceLastLookCard changes={lastLook.changes} onDismiss={() => onDismiss(lastLook.dismiss())} />
  );
}
