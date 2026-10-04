import type { SeasonSnapshot } from "../storage";
import { docToSeason, isRecord, seasonToDoc, type LeagueDocChange } from "./leagueDocs";

/**
 * What this device knows of each season's document, kept between visits.
 *
 * - **The base**: the version it last took in, and the write that version is at. It is what tells a
 *   change made here from one made elsewhere when the page opens again. Without it, a game another
 *   device deleted while this one was closed would look like a game this device has and the cloud
 *   lacks, and be written back: every device would get it again.
 * - **Its own writes since**, each with the write number it landed as: a version heard later at or
 *   past that number holds the write, one before it does not, so a write of this device's is never
 *   taken for another device's change, nor a value changed back to what it was for no change.
 *
 * Kept per season, as its document, and read back through the same checks, so a damaged one is
 * simply not there.
 */
export type Landed = { rev: number; changes: LeagueDocChange[] };

export type Known = { season: SeasonSnapshot; rev: number; landed: Landed[] };

export type BaseKeeper = {
  read: (docId: string) => Known | null;
  write: (docId: string, known: Known) => void;
  remove: (docId: string) => void;
};

const keyOf = (docId: string): string => `lf_league_base_${docId}_v1`;

const landedOf = (raw: unknown): Landed[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: Landed[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.rev !== "number" || !Array.isArray(item.changes))
      return null;
    const changes: LeagueDocChange[] = [];
    for (const change of item.changes) {
      if (
        !isRecord(change) ||
        !Array.isArray(change.path) ||
        !change.path.every((part): part is string => typeof part === "string")
      )
        return null;
      changes.push(
        change.remove === true
          ? { path: change.path, remove: true }
          : { path: change.path, value: change.value }
      );
    }
    out.push({ rev: item.rev, changes });
  }
  return out;
};

/** The bases in this browser's storage, cleared with the rest of the app's keys by a reset. */
export const storedBases: BaseKeeper = {
  read: (docId) => {
    try {
      const raw = localStorage.getItem(keyOf(docId));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return null;
      const read = docToSeason(parsed.doc, docId);
      const landed = landedOf(parsed.landed);
      if (!read.ok || !landed) return null;
      // The copy's season, taken as the base at a first meeting (`meetSeasons`): before any of
      // the document's writes, at a number no document itself is at.
      return { season: read.season, rev: parsed.fromCopy === true ? 0 : read.rev, landed };
    } catch {
      return null;
    }
  },
  write: (docId, known) => {
    try {
      localStorage.setItem(
        keyOf(docId),
        JSON.stringify({
          doc: seasonToDoc(known.season, Math.max(known.rev, 1)),
          ...(known.rev === 0 ? { fromCopy: true } : {}),
          landed: known.landed,
        })
      );
    } catch {
      // Storage full: the next visit meets the cloud without a base, and keeps everything either
      // side holds, which loses nothing.
    }
  },
  remove: (docId) => {
    try {
      localStorage.removeItem(keyOf(docId));
    } catch {
      // Nothing more to do: a base whose season is gone is never read for a season made since,
      // whose creation time differs (`leagueSync.ts`).
    }
  },
};
