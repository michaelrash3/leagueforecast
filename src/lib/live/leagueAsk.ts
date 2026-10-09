import { memberToken } from "../cloud/cloudSession";
import type { AnswerOf, QueryOf } from "./queries";

/** The questions League Standings asks the server of Team Rankings (`leagueAnswers.ts`). */
export type LeagueQueryKind = "league.bridge" | "league.clubs" | "league.fill";

/**
 * Asks the server one of League Standings' questions, as the signed-in member, and is told its
 * answer, or nothing: offline, signed out, refused, or a reply this build cannot read. The caller
 * keeps what it had rather than say why, since what it had is still the season's.
 */
export type LeagueAsker = <K extends LeagueQueryKind>(
  query: QueryOf<K>
) => Promise<AnswerOf<K> | null>;

/** What a person is told of a question League Standings asked that the server did not answer. */
export const LEAGUE_UNANSWERED =
  "Team Rankings in the cloud could not be asked just now. Try again in a minute.";

/** The call's client, which only a member's device loads, and only once something is asked. */
const editClient = () => import("./editClient");

export const askLeague: LeagueAsker = async <K extends LeagueQueryKind>(query: QueryOf<K>) => {
  const client = await editClient().catch(() => null);
  if (!client) return null;
  const called = await client.callQuery<K>({ query }, { token: memberToken });
  return called.ok && called.value.ok ? called.value.answer : null;
};
