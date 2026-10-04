import { useCallback, useEffect, useState } from "react";
import type { LiveSources } from "../../hooks/useLiveBoard";
import {
  readArchiveIndex,
  readArchivedSeason,
  type ArchiveIndexRead,
  type DecodedParts,
} from "../../lib/live/copyArchive";
import { card } from "../../styles/tokens";
import { ArchiveSection } from "./ArchiveSection";

/** The copy's parts read this page load, by part: going back to the tab, or a season, is free. */
const decodedParts: DecodedParts = new Map();

/** Only for tests: forgets the parts read so far. */
export const forgetDecodedArchive = (): void => decodedParts.clear();

/**
 * The Archive tab on the cloud's board (1.5): the finished seasons the cloud's copy lists, and a
 * season's table when it is opened, read from the copy itself (`copyArchive.ts`) and drawn by Team
 * Rankings' own tab (`ArchiveSection`). An archived season never changes, so nothing here is
 * published or edited. A copy that cannot be read, offline or refused, is said where it was asked
 * (`onCannot`), with Try again, as a list that cannot be read is (1.6e).
 *
 * Loaded only when the tab is opened, with the tab's own code.
 */
export default function LiveArchive({
  copy,
  onCannot,
}: {
  copy: LiveSources["copy"];
  onCannot: () => void;
}) {
  const [read, setRead] = useState<ArchiveIndexRead | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const reader = copy ? await copy().catch(() => null) : null;
      const index = reader ? await readArchiveIndex(reader, decodedParts) : { ok: false as const };
      if (live) setRead(index);
    })();
    return () => {
      live = false;
    };
  }, [copy]);
  useEffect(() => {
    if (read?.ok === false) onCannot();
  }, [read, onCannot]);

  const manifest = read?.ok ? read.manifest : null;
  const load = useCallback(
    async (id: string) => {
      const reader = copy ? await copy().catch(() => null) : null;
      return reader ? readArchivedSeason(reader, manifest, id, decodedParts) : null;
    },
    [copy, manifest]
  );

  if (!read?.ok)
    return (
      <div className={`${card} p-5`} role="status" aria-live="polite">
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
          Reading the cloud&apos;s finished seasons…
        </p>
      </div>
    );
  return <ArchiveSection entries={read.entries} load={load} />;
}
