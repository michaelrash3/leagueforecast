import { copyReader, memberToken } from "../cloud/cloudSession";
import type { LeagueFillPlan } from "../leagueScoreFill";
import type { LeagueScoutBridge } from "../teamRankings";
import type { PoolCommand } from "./commands";
import type { Published } from "./publishedLeague";
import type { AnswerOf, QueryOf } from "./queries";
import type { EditMonth } from "./rebuildLedger";

/** The questions League Standings asks the server of Team Rankings (`leagueAnswers.ts`). */
export type LeagueQueryKind = "league.bridge" | "league.clubs" | "league.fill" | "league.start";

/** A cloud copy at one of its saves: its id, and the version every save moves on by one. */
export type CopyAt = { copy: string; version: number };

/**
 * An answer with the copy it was worked out from (`at`), the one the reply names: the server reads
 * the pool at exactly that save, so the same question asked of the same copy and version, on the
 * same day of the server's, and of the same deploy, is answered the same.
 */
export type LeagueAnswered<K extends LeagueQueryKind> = AnswerOf<K> & { at?: CopyAt };

/**
 * Asks the server one of League Standings' questions, as the signed-in member, and is told its
 * answer, or nothing: offline, signed out, refused, or a reply this build cannot read. The caller
 * keeps what it had rather than say why, since what it had is still the season's. What the reply
 * said of the edits' month, answered or not, goes to `heard`, where it said it (`EditMonth`): the
 * bridge question makes no timer retry while that month is spent (`useScoutBridge`).
 */
export type LeagueAsker = <K extends LeagueQueryKind>(
  query: QueryOf<K>,
  heard?: (month: EditMonth) => void
) => Promise<LeagueAnswered<K> | null>;

/** What a person is told of a question League Standings asked that the server did not answer. */
export const LEAGUE_UNANSWERED =
  "Team Rankings in the cloud could not be asked just now. Try again in a minute.";

/** The call's client, which only a member's device loads, and only once something is asked. */
const editClient = () => import("./editClient");

export const askLeague: LeagueAsker = async <K extends LeagueQueryKind>(
  query: QueryOf<K>,
  heard?: (month: EditMonth) => void
) => {
  const client = await editClient().catch(() => null);
  if (!client) return null;
  const called = await client.callQuery<K>({ query }, { token: memberToken, retry: true });
  const month = called.ok ? called.value.editMonth : called.editMonth;
  if (month) heard?.(month);
  if (!called.ok || !called.value.ok) return null;
  const { answer, copy, version } = called.value;
  return { ...answer, at: { copy, version } };
};

/**
 * The reader of League Standings' answers published beside the boards (`publishedLeague.ts`), which
 * only a member's device loads, and only once something is asked, as the call's client is.
 */
const publishedClient = () => import("./publishedLeague");

/**
 * A season's answer as published beside the boards, where it is the very answer the question would
 * get (`views/leagueShape.ts`), or null, and the question is asked as before: none published, the
 * season or the day moved since in a way the answer cannot be held to, offline, or the reader would
 * not load. One read of the meta, and of the view only when a publish changed it, in place of a
 * question to the 8 GiB edit function.
 */
export type PublishedReader = {
  bridge: (question: QueryOf<"league.bridge">) => Promise<Published<LeagueScoutBridge> | null>;
  fill: (question: QueryOf<"league.fill">) => Promise<Published<LeagueFillPlan> | null>;
};

export const publishedLeague: PublishedReader = {
  bridge: async (question) =>
    (await publishedClient().catch(() => null))?.publishedBridge(question) ?? null,
  fill: async (question) =>
    (await publishedClient().catch(() => null))?.publishedFill(question) ?? null,
};

/**
 * The cloud copy's id and version as Firestore has them now, or null where it cannot say: signed
 * out, off the list, offline, or no copy. One read of the copy's manifest, which costs a document
 * where a question costs the 8 GiB server, so a question whose answer still stands is not asked
 * again (`useScoutBridge`). Read past this session's own note of the copy (`copySeen`), which
 * moves only when the session reads it and is minutes behind while the page is shown.
 */
export const copyAtNow = async (): Promise<CopyAt | null> => {
  try {
    const manifest = await (await copyReader())?.readManifest();
    return manifest ? { copy: manifest.copy, version: manifest.version } : null;
  } catch {
    return null;
  }
};

/**
 * Puts a League Standings season on a Team Rankings page in the cloud (`season.assign`), as the
 * signed-in member, as Setup's League seasons card does: whether the server did.
 */
export const placeLeagueSeason = async (
  command: Extract<PoolCommand, { kind: "season.assign" }>
): Promise<boolean> => {
  const client = await editClient().catch(() => null);
  if (!client) return false;
  const called = await client.callEdit({ command }, { token: memberToken });
  return called.ok && called.value.ok;
};
