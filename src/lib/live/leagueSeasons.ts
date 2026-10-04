import type { SeasonMeta, SeasonSnapshot } from "../storage";
import type { BaseKeeper } from "./leagueBase";
import { decodeKey, docToSeason, seasonDocId, seasonToDoc } from "./leagueDocs";
import type { LeagueStore } from "./leagueStore";

/**
 * The seasons this device holds and the seasons in the cloud, made one list when League goes live
 * on a device and on each visit after: once a visit, since a listing costs a read per season.
 *
 * Only the open season is kept live (`leagueSync.ts`); this is how the rest travel. A season made on
 * another device comes down whole and joins the season list here. A season only this device holds
 * goes up, as its document, so the other devices find it on their next visit; this is also how the
 * seasons a device kept in the cloud copy reach the cloud as documents the first time it goes live.
 * A season this device has met in the cloud before (it has a base, `leagueBase.ts`) and the cloud
 * no longer has was deleted on another device, and is never sent back.
 */

export type LocalSeasons = {
  list: () => SeasonMeta[];
  read: (id: string) => SeasonSnapshot | null;
  add: (seasons: readonly SeasonSnapshot[]) => boolean;
};

export type SeasonsMet = {
  /** Seasons made elsewhere, now in this device's list. */
  added: string[];
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
  now = () => new Date(),
}: {
  store: LeagueStore;
  local: LocalSeasons;
  bases: BaseKeeper;
  /**
   * The season open on screen, which the live store keeps (`leagueSync.ts`) and this leaves alone:
   * storage can be half a second behind the screen, and sent from storage, the season would reach
   * the cloud without the last score typed.
   */
  openId: () => string;
  now?: () => Date;
}): Promise<SeasonsMet> => {
  const met: SeasonsMet = { added: [], sent: [], gone: [], unread: [] };
  const remote = await store.list();
  const here = local.list();
  const heldIds = new Set(here.map((season) => season.id));
  const inCloud = new Set<string>();
  const arrivals: SeasonSnapshot[] = [];
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
    arrivals.push(read.season);
  }
  if (arrivals.length > 0 && local.add(arrivals)) met.added.push(...arrivals.map((one) => one.id));

  for (const entry of here) {
    if (inCloud.has(entry.id) || entry.id === openId()) continue;
    const docId = seasonDocId(entry.id);
    if (bases.read(docId)) {
      met.gone.push(entry.id);
      continue;
    }
    const season = local.read(entry.id);
    if (!season) continue;
    const made = await store.update(docId, (current) =>
      current.exists
        ? { write: null, result: false }
        : {
            write: {
              create: seasonToDoc({ ...season, updatedAt: now().toISOString() }),
            },
            result: true,
          }
    );
    if (made) {
      // The document is this device's season as it is: the base the season opens live from.
      bases.write(docId, season);
      met.sent.push(entry.id);
    }
  }
  return met;
};
