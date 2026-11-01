import type { RankingsSection } from "../../lib/rankingsRoute";
import { viewChunk, type ViewChunk } from "../viewChunk";

/*
 * Team Rankings' sections, each loaded on demand, as League Standings' views are (`viewChunk`).
 * Opening Team Rankings used to fetch every section's code, though one section is on screen at a
 * time and the page opens on the rankings: the Import panel, Setup's cards and the tidy they run
 * were most of what the page fetched (README "Performance notes"). Now the rankings, and the state
 * and handlers every section reads, come with the page, and a section's own code when it is first
 * opened, or a little before: when its tab is pointed at or focused, and, once the rankings are
 * drawn and the page has been idle 1.5 s, the section most often opened after them.
 */

export const gamesSection = viewChunk(
  () => import("./GamesSection").then((module) => module.GamesSection),
  "GamesSection"
);
/** The Import section: the GameChanger pull, the schedule list and the refresh. */
export const importSection = viewChunk(
  () => import("../GameChangerImportPanel").then((module) => module.GameChangerImportPanel),
  "GameChangerImportPanel"
);
export const scoutingSection = viewChunk(
  () => import("./ScoutingSection").then((module) => module.ScoutingSection),
  "ScoutingSection"
);
/** The tournament odds below the scouting report, drawn once the page has rankings. */
export const tournamentPanel = viewChunk(
  () => import("./TournamentPanel").then((module) => module.TournamentPanel),
  "TournamentPanel"
);
export const archiveSection = viewChunk(
  () => import("./ArchiveSection").then((module) => module.ArchiveSection),
  "ArchiveSection"
);
export const setupSection = viewChunk(
  () => import("./SetupSection").then((module) => module.SetupSection),
  "SetupSection"
);

/** What loading a chunk asks of it, whatever its section draws. */
type Loadable = Pick<ViewChunk<object>, "prefetch" | "reset">;

/** What each section draws, every chunk it needs; the rankings come with the page. */
const CHUNKS_OF: Record<RankingsSection, readonly Loadable[]> = {
  rankings: [],
  games: [gamesSection],
  import: [importSection],
  scouting: [scoutingSection, tournamentPanel],
  archive: [archiveSection],
  setup: [setupSection],
};

/** Starts loading a section's chunks: on a hover or focus of its tab, and for the likely next one. */
export const prefetchSection = (section: RankingsSection): Promise<void> =>
  Promise.all(CHUNKS_OF[section].map((chunk) => chunk.prefetch())).then(() => undefined);

/** Forgets a section's failed loads, so its boundary's Try again fetches afresh. */
export const resetSection = (section: RankingsSection): void => {
  CHUNKS_OF[section].forEach((chunk) => chunk.reset());
};

/**
 * The section most often opened after this one, loaded once this one is drawn and the browser is
 * idle: the games after the rankings, the next tab along, where a result is added and the day's
 * games are listed. Only that one, so a phone on one bar fetches what it is likely to show.
 */
export const LIKELY_NEXT_SECTION: Partial<Record<RankingsSection, RankingsSection>> = {
  rankings: "games",
};

/** Every section's chunks, loaded: for a test that wants the sections drawn at once. */
export const prefetchAllSections = (): Promise<void> =>
  Promise.all(
    Object.values(CHUNKS_OF).flatMap((chunks) => chunks.map((chunk) => chunk.prefetch()))
  ).then(() => undefined);
