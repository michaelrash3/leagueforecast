import { fetchValues, type CloudStore } from "../cloud/cloudEngine";
import type { CloudManifest, ManifestPart } from "../cloud/cloudManifest";
import {
  coerceArchivedSeason,
  type ArchivedSeason,
  type ArchiveEntry,
} from "../teamRankingsArchive";
import { archiveRowsKey, coerceArchiveIndex, GC_ARCHIVE_KEY } from "../teamRankingsStorage";

/**
 * Finished seasons as the live page reads them (1.5): straight from the cloud's copy, which a
 * member may read, rather than from a view the server publishes. An archived season is the copy's
 * own index part (`GC_ARCHIVE_KEY`) and a part of rows each (`archiveRowsKey`), frozen once made,
 * and the page reads the index and, when a season is opened, its rows: a read of the manifest and a
 * piece or two, where publishing them would have the server fetch parts its pool leaves out to
 * write the same bytes again as views.
 */

/** What the page reads the copy with: its manifest and its pieces, and nothing it could write. */
export type CopyReader = Pick<CloudStore, "readManifest" | "getChunk">;

/** Values read this page load, by the part they were read from: a part is the same bytes for life. */
export type DecodedParts = Map<string, unknown>;

const partKey = (part: ManifestPart): string => `${part.id}:${part.hash}`;

/**
 * The value of `part`, read once a page load (`decoded`), or undefined when it would not read: a
 * piece gone (the copy moved on and swept it) or not making the value its manifest names.
 */
const valueOf = async (
  reader: CopyReader,
  part: ManifestPart,
  decoded: DecodedParts
): Promise<unknown> => {
  const key = partKey(part);
  if (decoded.has(key)) return decoded.get(key);
  const fetched = await fetchValues({ store: reader, parts: [part] });
  if (!fetched.ok) return undefined;
  const value = fetched.values.get(part.key);
  decoded.set(key, value);
  return value;
};

/** The archive's list as the copy now holds it, and the manifest it was read from. */
export type ArchiveIndexRead =
  { ok: true; manifest: CloudManifest | null; entries: ArchiveEntry[] } | { ok: false };

/**
 * The finished seasons the copy lists: none for a copy with no index part (nothing was ever
 * archived), or for no copy at all. Not ok for one that would not read, or a read that failed.
 */
export const readArchiveIndex = async (
  reader: CopyReader,
  decoded: DecodedParts
): Promise<ArchiveIndexRead> => {
  try {
    const manifest = await reader.readManifest();
    const part = manifest?.parts.find(({ key }) => key === GC_ARCHIVE_KEY);
    if (!part) return { ok: true, manifest, entries: [] };
    const value = await valueOf(reader, part, decoded);
    return value === undefined
      ? { ok: false }
      : { ok: true, manifest, entries: coerceArchiveIndex(value) };
  } catch {
    return { ok: false };
  }
};

/**
 * One finished season's table, read off the copy `manifest` names, or null when the copy holds
 * none for it or it would not read, which the tab says alike ("its table would not load"). A part
 * whose pieces are gone was replaced since the list was read, so the manifest is read again, once,
 * and the season read off that.
 */
export const readArchivedSeason = async (
  reader: CopyReader,
  manifest: CloudManifest | null,
  id: string,
  decoded: DecodedParts
): Promise<ArchivedSeason | null> => {
  const key = archiveRowsKey(id);
  try {
    for (const read of [manifest, null]) {
      const current = read ?? (await reader.readManifest());
      const part = current?.parts.find((one) => one.key === key);
      if (!part) return null;
      const value = await valueOf(reader, part, decoded);
      if (value !== undefined) return coerceArchivedSeason(value);
    }
    return null;
  } catch {
    return null;
  }
};
