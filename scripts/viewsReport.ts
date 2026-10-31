import type { CopyPublish } from "../src/lib/live/publishCopy.ts";
import type { FamilyCounts } from "../src/lib/live/viewStore.ts";
import { BOARD_FAMILY } from "../src/lib/live/views/boardShape.ts";
import { CLUB_FAMILY } from "../src/lib/live/views/clubShape.ts";
import { GAMES_FAMILY } from "../src/lib/live/views/gamesShape.ts";
import { SEARCH_FAMILY } from "../src/lib/live/views/searchShape.ts";

/*
 * What a server's publish of the members' views did, said in the log the same way by each script
 * that publishes them (`nightly.ts`, `republish.ts`, `catchUp.ts`): counts and sizes only, since
 * this repository's Actions logs are public.
 */

/** Bytes as megabytes, to a tenth. */
export const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

const REFUSED: Record<Extract<CopyPublish, { ok: false }>["reason"], string> = {
  locale: "the collation is not English, so tied rows would sit in another order than the page's",
  "league-unreadable": "the League Standings seasons could not be read",
  "newer-league": "a League Standings season was saved by a newer build",
  "copy-moved": "a device saved the copy during the run, so the next run publishes its views",
  "league-moved":
    "a League Standings season changed during the run, and the rebuild it asked for publishes it",
  "copy-replaced":
    "the copy was deleted and started again, or its Team Rankings started again, during the run, so these are not its",
  unreadable: "the published meta is not one this build reads",
  "newer-schema": "the published views were made by a newer build",
  "kept-changing": "the published meta kept changing under it",
  "too-large": "the meta would be too large for every member to download",
  "older-day": "the published views are already a later day's",
  "older-rules":
    "the published boards were built by newer rules or a newer shape than this build's",
};

/** The families of view the publish names, in its order and the words its first line uses. */
const FAMILIES: ReadonlyArray<readonly [string, string]> = [
  [BOARD_FAMILY, "boards"],
  [CLUB_FAMILY, "buckets of club cards"],
  [SEARCH_FAMILY, "Find a team lists"],
  [GAMES_FAMILY, "Games lists"],
];

/**
 * What became of each family's views, the counts that are not nought: which kinds of view a night
 * changed, and which it only named again. A family this build has no words for goes by its key.
 */
const familyWords = (families: Record<string, FamilyCounts>): string => {
  const named = new Map(FAMILIES);
  const others = Object.keys(families)
    .filter((family) => !named.has(family))
    .sort();
  return [...FAMILIES.map(([family]) => family), ...others]
    .flatMap((family) => {
      const counts = families[family];
      if (!counts) return [];
      const said = (
        [
          [counts.sent, "sent"],
          [counts.reused, "reused"],
          [counts.unchanged, "unchanged"],
          [counts.refused, "refused as older"],
        ] as const
      )
        .filter(([count]) => count > 0)
        .map(([count, word]) => `${count} ${word}`);
      return [`${named.get(family) ?? family} ${said.join(", ")}`];
    })
    .join("; ");
};

/** What the views' publish did, or would have done, in counts and sizes, a line at a time. */
export const viewsLines = (views: CopyPublish, dry: boolean): string[] => {
  if (!views.ok) return [`The views were not published: ${REFUSED[views.reason]}.`];
  const { publish, sweep, fits } = views;
  return [
    `Views: ${views.boards} boards, ${views.clubs} buckets of club cards, ${views.searches} Find a team lists and ${views.games} Games lists built in ${Math.round(views.buildMs / 1000)} s; ${publish.uploaded} ${dry ? "would have been " : ""}uploaded (${publish.pieces} pieces, ${mb(publish.bytes)} gzipped), ${publish.reused} reused, ${publish.unchanged} unchanged, ${publish.refused} refused as older, ${publish.removed} taken out, ${publish.retired} retired; the meta (${(publish.metaBytes / 1000).toFixed(1)} KB) ${publish.wrote ? (dry ? "would have been written" : "written") : "already said all of it"}.`,
    `  By family${dry ? ", had the run been live" : ""}: ${familyWords(publish.families)}.`,
    `  Board fits: ${fits.boards} of the ${views.boards} boards carry one, ${mb(fits.bytes)} of JSON in all and ${(fits.largest / 1000).toFixed(1)} KB on the largest.`,
    sweep.ok
      ? `  Sweep: ${sweep.deleted} retired pieces ${dry ? "would have been " : ""}deleted, and ${sweep.strays} strays.`
      : `  The sweep after it stopped: ${sweep.why}.`,
  ];
};

/** The views' lines, said (`viewsLines`). */
export const tellViews = (views: CopyPublish, dry: boolean): void => {
  for (const line of viewsLines(views, dry)) console.log(line);
};
