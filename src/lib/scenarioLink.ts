import { formatGameDate, parseDateValue, seasonStartMonth } from "./date";
import {
  MAX_SCENARIO_LINK,
  basisFor,
  coercePick,
  isRecord,
  keepScenario,
  livePicks,
  newScenarioId,
  scenarioTrouble,
  troubleLine,
  type GameBasis,
  type SavedScenario,
} from "./savedScenarios";
import type { ScenarioPick } from "./scenario";
import { decodeRaw } from "./share";
import type { GameLog, Matchup } from "./types";

/*
 * Opening a shared scenario link (2.7): reading it, showing what it holds, and keeping it only once
 * asked. Apart from the saved scenarios themselves (`savedScenarios.ts`), so that only a link opened
 * fetches it: neither the page's first download nor the Forecast tab carries it.
 */

/** A scenario carried by a link: its name, picks and their games, or null for anything else. */
export const readScenarioLink = (
  hash: string
): {
  name: string;
  picks: Record<string, ScenarioPick>;
  basis: Record<string, GameBasis>;
} | null => {
  const encoded = new URLSearchParams(hash.replace(/^#/, "")).get("scenario");
  if (!encoded || encoded.length > MAX_SCENARIO_LINK) return null;
  try {
    const parsed: unknown = JSON.parse(decodeRaw(encoded));
    if (!isRecord(parsed) || parsed.v !== 1 || typeof parsed.n !== "string") return null;
    if (!Array.isArray(parsed.p) || !isRecord(parsed.b)) return null;
    const basis: Record<string, GameBasis> = {};
    for (const [id, game] of Object.entries(parsed.b)) {
      if (!Array.isArray(game) || !game.every((part) => typeof part === "string")) return null;
      const [away, home, date] = game as string[];
      if (away === undefined || home === undefined || date === undefined) return null;
      basis[id] = { away, home, date };
    }
    const picks: Record<string, ScenarioPick> = {};
    for (const entry of parsed.p) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
      const [gameId, side, awayRuns, homeRuns] = entry as unknown[];
      const game = basis[gameId as string];
      if (!game || (side !== 0 && side !== 1)) return null;
      const pick = coercePick({
        winnerId: side === 1 ? game.home : game.away,
        awayRuns,
        homeRuns,
      });
      if (!pick) return null;
      picks[gameId as string] = pick;
    }
    return { name: parsed.n.slice(0, 80), picks, basis };
  } catch {
    return null;
  }
};

/** How many of a link's picks the preview names before saying how many more there are. */
const PREVIEW_PICKS = 6;

/** One pick in words: who beats whom, the score if one was typed for the winner, and the day. */
const pickLine = (pick: ScenarioPick, game: GameBasis, nameOf: (id: string) => string): string => {
  const homeWins = pick.winnerId === game.home;
  const loser = homeWins ? game.away : game.home;
  const { awayRuns, homeRuns } = pick;
  // A typed score that has the other side ahead is played as no score (`pickedScore`), so not said.
  const score =
    awayRuns !== undefined && homeRuns !== undefined && awayRuns !== homeRuns
      ? homeWins === homeRuns > awayRuns
        ? ` ${Math.max(awayRuns, homeRuns)}–${Math.min(awayRuns, homeRuns)}`
        : ""
      : "";
  return `${nameOf(pick.winnerId)} over ${nameOf(loser)}${score}, ${formatGameDate(game.date)}`;
};

export type LinkOutcome =
  /** Kept for the season open here, and to be opened in the playoff machine. */
  | { kind: "kept"; scenario: SavedScenario; pushedOut: SavedScenario[] }
  /** Shown, and not kept. */
  | { kind: "declined" }
  /** Not a scenario link this app can read: cut short when copied, or made by a later app. */
  | { kind: "unreadable" }
  /** None of its picks is on a game this season still has to play between the same teams. */
  | { kind: "nothing-applies"; name: string }
  /** Wanted, and the browser would not store it. */
  | { kind: "not-stored" };

/**
 * A scenario link opened (2.7): read, shown, and kept for the season open here only once the
 * person says so. What is asked shows its picks, the soonest first, and says which of them are not
 * on a game this season still has to play between the same teams; those are left out of what is
 * kept, so it opens up to date. Nothing of the season is touched whatever the answer: a link only
 * ever adds a saved scenario, on this device.
 */
export const takeScenarioLink = async ({
  hash,
  seasonId,
  seasonName,
  matchups,
  logs,
  nameOf,
  ask,
  now,
  id,
}: {
  hash: string;
  seasonId: string;
  seasonName: string;
  matchups: readonly Matchup[];
  logs: Readonly<Record<string, GameLog>>;
  nameOf: (id: string) => string;
  ask: (question: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
  }) => Promise<boolean>;
  /** When it is kept, and its id here: given in tests, the moment kept and a new id otherwise. */
  now?: string;
  id?: string;
}): Promise<LinkOutcome> => {
  const link = readScenarioLink(hash);
  if (!link) return { kind: "unreadable" };
  const trouble = scenarioTrouble(link, matchups, logs);
  const applying = livePicks(link.picks, trouble);
  const count = Object.keys(link.picks).length;
  if (Object.keys(applying).length === 0) return { kind: "nothing-applies", name: link.name };
  // Each pick on its game as this season has it, which may be on another day than the link's.
  const here = basisFor(applying, matchups);
  const start = seasonStartMonth(matchups.map((game) => game.date));
  const ordered = Object.entries(applying)
    .flatMap(([gameId, pick]) => {
      const game = here[gameId];
      return game ? [{ pick, game }] : [];
    })
    .sort(
      (one, two) => parseDateValue(one.game.date, start) - parseDateValue(two.game.date, start)
    );
  const shown = ordered
    .slice(0, PREVIEW_PICKS)
    .map(({ pick, game }) => `• ${pickLine(pick, game, nameOf)}`);
  const more = ordered.length - shown.length;
  const leftOut = trouble.filter((one) => one.kind !== "moved");
  const lines = [
    `“${link.name}”: ${count} ${count === 1 ? "pick" : "picks"}.`,
    ...shown,
    ...(more > 0 ? [`• and ${more} more.`] : []),
    ...(leftOut.length
      ? [
          `${leftOut.length} ${leftOut.length === 1 ? "is" : "are"} left out, as ${
            leftOut.length === 1 ? "it no longer applies" : "they no longer apply"
          } here:`,
          ...leftOut.slice(0, PREVIEW_PICKS).map((one) => `• ${troubleLine(one, nameOf)}`),
          ...(leftOut.length > PREVIEW_PICKS
            ? [`• and ${leftOut.length - PREVIEW_PICKS} more.`]
            : []),
        ]
      : []),
    "",
    `Keeping it adds it to your saved scenarios for ${seasonName} on this device, open in the Forecast tab's playoff machine. Nothing in the season changes.`,
  ];
  const keep = await ask({
    title: "Keep this scenario?",
    message: lines.join("\n"),
    confirmLabel: "Keep it",
    cancelLabel: "Not now",
  });
  if (!keep) return { kind: "declined" };
  const at = now ?? new Date().toISOString();
  const scenario: SavedScenario = {
    version: 1,
    id: id ?? newScenarioId(),
    name: link.name,
    seasonId,
    picks: applying,
    basis: here,
    createdAt: at,
    modifiedAt: at,
  };
  const kept = keepScenario(scenario);
  return kept ? { kind: "kept", scenario, pushedOut: kept.pushedOut } : { kind: "not-stored" };
};

/**
 * A scenario link opened, and its outcome said: kept (and returned, to be opened), turned down
 * (nothing said, since the person said it), or not kept for a reason the person is told.
 */
export const openScenarioLink = async (
  options: Parameters<typeof takeScenarioLink>[0] & {
    say: (text: string, tone: "info" | "error") => void;
  }
): Promise<SavedScenario | null> => {
  const outcome = await takeScenarioLink(options);
  const { say, seasonName } = options;
  switch (outcome.kind) {
    case "kept":
      if (outcome.pushedOut.length)
        say(
          `To make room for “${outcome.scenario.name}”, this device let go of ${outcome.pushedOut
            .map((one) => `“${one.name}”`)
            .join(", ")}.`,
          "info"
        );
      return outcome.scenario;
    case "declined":
      return null;
    case "unreadable":
      say(
        "That scenario link could not be read. It may have been cut short when it was copied.",
        "error"
      );
      return null;
    case "nothing-applies":
      say(
        `None of the picks in “${outcome.name}” are on games still to play in ${seasonName}. If it was made for another season, open that season, then the link again.`,
        "error"
      );
      return null;
    case "not-stored":
      say("This browser would not keep the scenario: its storage is full or turned off.", "error");
      return null;
  }
};
