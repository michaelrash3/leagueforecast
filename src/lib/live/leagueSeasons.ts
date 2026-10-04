import type { SeasonMeta, SeasonSnapshot } from "../storage";
import type { BaseKeeper } from "./leagueBase";
import { createdApart, decodeKey, docToSeason, seasonDocId, seasonToDoc } from "./leagueDocs";
import type { LeagueStore } from "./leagueStore";

/**
 * The seasons this device holds and the seasons in the cloud, made one list when League goes live
 * on a device and on each visit after: once a visit, since a listing costs a read per season.
 *
 * Only the open season is kept live (`leagueSync.ts`); this is how the rest travel. A season made on
 * another device comes down whole and joins the season list here. A season only this device holds
 * goes up, as its document, so the other devices find it on their next visit; this is also how the
 * seasons a device kept in the cloud copy reach the cloud as documents the first time it goes live.
 * A season this device has met in the cloud before (it has a base, `leagueBase.ts`, kept for a
 * season made at the same moment) and the cloud no longer has was deleted on another device, and
 * is never sent back. A season brought down comes with its base, so the same holds for it.
 *
 * A device meeting the cloud's seasons for the first time (1.6e) holds them as the cloud copy last
 * gave them, and the cloud may have moved on since, live, on devices that met it earlier. A season
 * held both here and there, with no base of its own, takes the copy's as its base (`agreed`, at
 * write 0, before any of the document's), so the open season's first meeting is three-way: a game
 * deleted live since is not brought back by this device, and what changed here since is kept. Only
 * a season the cloud holds: a season here alone is sent up as ever, since one the cloud lacks may
 * be one the copy's first device to go live never held, and sending a deleted season back is
 * better than losing one.
 */

export type LocalSeasons = {
  list: () => SeasonMeta[];
  read: (id: string) => SeasonSnapshot | null;
  add: (seasons: readonly SeasonSnapshot[]) => boolean;
};

export type SeasonsMet = {
  /** Seasons made elsewhere, now in this device's list. */
  added: string[];
  /** Seasons held both here and in the cloud that took the copy's as their base. */
  agreed: string[];
  /** Seasons only this device held, now in the cloud. */
  sent: string[];
  /** Seasons met before that the cloud no longer has: deleted on another device. */
  gone: string[];
  /** Seasons in the cloud this version of the app cannot read. */
  unread: string[];
};

export const meetSeasons = async ({
  store,
  local,
  bases,
  openId,
  agreed,
  now = () => new Date(),
}: {
  store: LeagueStore;
  local: LocalSeasons;
  bases: BaseKeeper;
  /**
   * The seasons as this device and the cloud copy last agreed on them, given at its first meeting:
   * each held both here and in the cloud with no base of its own takes the copy's as its base.
   */
  agreed?: readonly SeasonSnapshot[];
  /**
   * The season open on screen, which the live store keeps (`leagueSync.ts`) and this leaves alone:
   * storage can be half a second behind the screen, and sent from storage, the season would reach
   * the cloud without the last score typed.
   */
  openId: () => string;
  now?: () => Date;
}): Promise<SeasonsMet> => {
  const met: SeasonsMet = { added: [], agreed: [], sent: [], gone: [], unread: [] };
  const remote = await store.list();
  const here = local.list();
  const heldIds = new Set(here.map((season) => season.id));
  const inCloud = new Set<string>();
  const arrivals: { season: SeasonSnapshot; rev: number }[] = [];
  for (const { docId, data } of remote) {
    const id = decodeKey(docId);
    if (id === null) continue;
    inCloud.add(id);
    if (heldIds.has(id)) continue;
    const read = docToSeason(data, docId);
    if (!read.ok) {
      met.unread.push(id);
      continue;
    }
    arrivals.push({ season: read.season, rev: read.rev });
  }
  if (agreed) {
    const asAgreed = new Map(agreed.map((season) => [season.id, season]));
    for (const entry of here) {
      const season = asAgreed.get(entry.id);
      const docId = seasonDocId(entry.id);
      // The copy's of this season, made at the same moment: a season since made under its id,
      // after one was deleted, is not the season the copy agreed on.
      if (!inCloud.has(entry.id) || !season || bases.read(docId)) continue;
      if (createdApart(season.createdAt, entry.createdAt)) continue;
      bases.write(docId, { season, rev: 0, landed: [] });
      met.agreed.push(entry.id);
    }
  }

  if (arrivals.length > 0 && local.add(arrivals.map((one) => one.season))) {
    // Each comes down with its base, stored after the season itself: met here, a deletion made
    // elsewhere later is a deletion, not a season this device holds and the cloud lacks.
    for (const { season, rev } of arrivals) {
      bases.write(seasonDocId(season.id), { season, rev, landed: [] });
      met.added.push(season.id);
    }
  }

  for (const entry of here) {
    if (inCloud.has(entry.id) || entry.id === openId()) continue;
    const docId = seasonDocId(entry.id);
    const known = bases.read(docId);
    // Met before and gone from the cloud since: deleted elsewhere. A base kept for a season made
    // at another moment is a deleted season's whose id this one reuses, and says nothing of it.
    if (known && !createdApart(known.season.createdAt, entry.createdAt)) {
      met.gone.push(entry.id);
      continue;
    }
    if (known) bases.remove(docId);
    const season = local.read(entry.id);
    if (!season) continue;
    const made = await store.update(docId, (current) =>
      current.exists
        ? { write: null, result: false }
        : {
            write: {
              create: seasonToDoc({ ...season, updatedAt: now().toISOString() }, 1),
            },
            result: true,
          }
    );
    if (made) {
      // The document is this device's season as it is: the base the season opens live from.
      bases.write(docId, { season, rev: 1, landed: [] });
      met.sent.push(entry.id);
    }
  }
  return met;
};
