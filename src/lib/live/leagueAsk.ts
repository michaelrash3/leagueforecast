import { copyReader, memberToken } from "../cloud/cloudSession";
import type { PoolCommand } from "./commands";
import type { AnswerOf, QueryOf } from "./queries";

/** The questions League Standings asks the server of Team Rankings (`leagueAnswers.ts`). */
export type LeagueQueryKind = "league.bridge" | "league.clubs" | "league.fill" | "league.start";

/** A cloud copy at one of its saves: its id, and the version every save moves on by one. */
export type CopyAt = { copy: string; version: number };

/**
 * An answer with the copy it was worked out from (`at`), the one the reply names: the server reads
 * the pool at exactly that save, so the same question asked of the same copy and version is
 * answered the same.
 */
export type LeagueAnswered<K extends LeagueQueryKind> = AnswerOf<K> & { at?: CopyAt };

/**
 * Asks the server one of League Standings' questions, as the signed-in member, and is told its
 * answer, or nothing: offline, signed out, refused, or a reply this build cannot read. The caller
 * keeps what it had rather than say why, since what it had is still the season's.
 */
export type LeagueAsker = <K extends LeagueQueryKind>(
  query: QueryOf<K>
) => Promise<LeagueAnswered<K> | null>;

/** What a person is told of a question League Standings asked that the server did not answer. */
export const LEAGUE_UNANSWERED =
  "Team Rankings in the cloud could not be asked just now. Try again in a minute.";

/** The call's client, which only a member's device loads, and only once something is asked. */
const editClient = () => import("./editClient");

export const askLeague: LeagueAsker = async <K extends LeagueQueryKind>(query: QueryOf<K>) => {
  const client = await editClient().catch(() => null);
  if (!client) return null;
  const called = await client.callQuery<K>({ query }, { token: memberToken, retry: true });
  if (!called.ok || !called.value.ok) return null;
  const { answer, copy, version } = called.value;
  return { ...answer, at: { copy, version } };
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
