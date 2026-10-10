import type { CopyPublish } from "../src/lib/live/publishCopy.ts";

/*
 * What a server's publish of the members' views did, said in the log the same way by each script
 * that publishes them (`nightly.ts`, `republish.ts`): counts and sizes only, since this repository's
 * Actions logs are public.
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
  "copy-replaced": "the copy was deleted and started again during the run, so these are not its",
  unreadable: "the published meta is not one this build reads",
  "newer-schema": "the published views were made by a newer build",
  "kept-changing": "the published meta kept changing under it",
  "too-large": "the meta would be too large for every member to download",
  "older-day": "the published views are already a later day's",
  "older-rules": "the published boards were built by newer rules than this build's",
};

/** What the views' publish did, or would have done, in counts and sizes. */
export const tellViews = (views: CopyPublish, dry: boolean): void => {
  if (!views.ok) {
    console.log(`The views were not published: ${REFUSED[views.reason]}.`);
    return;
  }
  const { publish, sweep } = views;
  console.log(
    `Views: ${views.boards} boards, ${views.clubs} buckets of club cards, ${views.searches} Find a team lists and ${views.games} Games lists built in ${Math.round(views.buildMs / 1000)} s; ${publish.uploaded} ${dry ? "would have been " : ""}uploaded (${publish.pieces} pieces, ${mb(publish.bytes)} gzipped), ${publish.unchanged} unchanged, ${publish.refused} refused as older, ${publish.removed} taken out, ${publish.retired} retired; the meta (${(publish.metaBytes / 1000).toFixed(1)} KB) ${publish.wrote ? (dry ? "would have been written" : "written") : "already said all of it"}.`
  );
  console.log(
    sweep.ok
      ? `  Sweep: ${sweep.deleted} retired pieces ${dry ? "would have been " : ""}deleted, and ${sweep.strays} strays.`
      : `  The sweep after it stopped: ${sweep.why}.`
  );
};
