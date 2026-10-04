import type { SeasonSnapshot } from "../storage";
import { docToSeason, seasonToDoc } from "./leagueDocs";

/**
 * The version of each season's document this device last took in, kept between visits.
 *
 * It is what tells a change made here from one made elsewhere when the page opens again. Without
 * it, a game another device deleted while this one was closed would look like a game this device
 * has and the cloud lacks, and be written back: every device would get it again. With it, the game
 * is one nobody here touched since, and stays deleted. Kept per season, as its document, and read
 * back through the same checks, so a damaged one is simply not there.
 */
export type BaseKeeper = {
  read: (docId: string) => SeasonSnapshot | null;
  write: (docId: string, season: SeasonSnapshot) => void;
};

const keyOf = (docId: string): string => `lf_league_base_${docId}_v1`;

/** The bases in this browser's storage, cleared with the rest of the app's keys by a reset. */
export const storedBases: BaseKeeper = {
  read: (docId) => {
    try {
      const raw = localStorage.getItem(keyOf(docId));
      if (raw === null) return null;
      const read = docToSeason(JSON.parse(raw), docId);
      return read.ok ? read.season : null;
    } catch {
      return null;
    }
  },
  write: (docId, season) => {
    try {
      localStorage.setItem(keyOf(docId), JSON.stringify(seasonToDoc(season)));
    } catch {
      // Storage full: the next visit meets the cloud without a base, and keeps everything either
      // side holds, which loses nothing.
    }
  },
};
