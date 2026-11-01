import { liveReader } from "../cloud/cloudSession";
import type { LeagueFillPlan } from "../leagueScoreFill";
import type { LeagueScoutBridge } from "../teamRankings";
import { isBoardInput } from "./boardInputs";
import { readLive, readView, type DecodedViews } from "./liveClient";
import { ownEditsPast } from "./ownEdits";
import type { QueryOf } from "./queries";
import { browserViewCache, type ViewCache } from "./viewCache";
import type { LiveReader } from "./viewStore";
import {
  bridgeFromView,
  coerceLeagueView,
  fillFromView,
  leagueViewKey,
  type LeagueView,
  type PublishedLeague,
} from "./views/leagueShape";

/**
 * How a member's device reads a League Standings season's published answers (`views/league.ts`):
 * the meta, one read, in place of a question to the edit function; the season's view, kept on the
 * device by its fingerprint as a board is (`viewCache.ts`), so it costs a read only when a publish
 * changed it; and the answer taken only where it is the very one the question would get
 * (`bridgeFromView`, `fillFromView`). Loaded behind `leagueAsk.ts`'s import, so League Standings'
 * first download carries none of it, and a device that reads its own pool never loads it.
 */

const decoded: DecodedViews<LeagueView> = new Map();

/**
 * Season `seasonId`'s view as published now, or null: none published (an older publisher's
 * boards, a season not yet a document's, League read from the copy), nothing this build reads, the
 * device offline or refused, or a view from before a save this device's own edit made of something
 * the answers read (`ownEdits.ts`), which the question answers and the view does not yet.
 */
export const readPublishedLeague = async (
  reader: LiveReader,
  seasonId: string,
  kept?: ViewCache
): Promise<PublishedLeague | null> => {
  const read = await readLive(reader, kept);
  if (!read.ok) return null;
  const got = await readView({
    reader,
    meta: read.meta,
    key: leagueViewKey(seasonId),
    cache: kept,
    coerce: coerceLeagueView,
    memory: decoded,
  });
  if (!got.ok) return null;
  const at = { copy: got.entry.k, version: got.entry.v };
  if (ownEditsPast(at.copy, at.version).some((edit) => edit.changed.some(isBoardInput))) {
    return null;
  }
  return { view: got.view, today: got.meta.today, at, builtAt: got.meta.builtAt };
};

/** A published answer as League Standings takes it: the answer, its copy, and when it went out. */
export type Published<T> = { answer: T; at: { copy: string; version: number }; builtAt: string };

const published = async (seasonId: string): Promise<PublishedLeague | null> => {
  const reader = await liveReader().catch(() => null);
  if (!reader) return null;
  return readPublishedLeague(reader, seasonId, browserViewCache()).catch(() => null);
};

/** The published bridge for `question`, where it is that question's answer at this moment. */
export const publishedBridge = async (
  question: QueryOf<"league.bridge">
): Promise<Published<LeagueScoutBridge> | null> => {
  const found = await published(question.season);
  const answer = found && (await bridgeFromView(found, question, Date.now()));
  return found && answer ? { answer, at: found.at, builtAt: found.builtAt } : null;
};

/** The published Fill plan for `question`, where it is that question's answer. */
export const publishedFill = async (
  question: QueryOf<"league.fill">
): Promise<Published<LeagueFillPlan> | null> => {
  const found = await published(question.season);
  const answer = found && (await fillFromView(found, question));
  return found && answer ? { answer, at: found.at, builtAt: found.builtAt } : null;
};
