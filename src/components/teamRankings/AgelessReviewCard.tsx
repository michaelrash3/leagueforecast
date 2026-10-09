import { useMemo, useState } from "react";
import { agelessBatch, agelessSearch, agelessWaiting } from "../../lib/agelessQueue";
import type { AgeUnknownList } from "../../lib/ageUnknown";
import type { NamedAges } from "../../lib/namedAges";
import type { DeletedClubs } from "../../lib/deletedGames";
import { agelessCsvFilename, agelessCsvParts } from "../../lib/agelessCsv";
import { clearGroups, type AgelessSitting } from "../../lib/agelessSitting";
import { agelessClearable, type AgelessAnswered } from "../../lib/agelessTriage";
import { downloadCsv, fileDay } from "../../lib/download";
import { AgelessReviewView, type AgelessAnswers } from "./AgelessReviewView";

type AgelessReviewCardProps = AgelessAnswers & {
  ageless: AgeUnknownList;
  named: NamedAges;
  dropped: DeletedClubs;
  /**
   * Clears the ticked rows in one pass. Asks first, unlike the single throw-out: this is the rare,
   * large action a dialog is actually for.
   */
  onClearRows: (rows: readonly AgelessAnswered[]) => Promise<boolean> | boolean;
  /** Today, so "has this been asked about recently" is one answer for the whole render. */
  now: Date;
};

/**
 * The teams nobody could age, from the list in this browser (`AgelessReviewView` draws them): the
 * queue, the rules' rows and the search all worked out here, each answer the page's to give.
 */
export function AgelessReviewCard({
  ageless,
  named,
  dropped,
  onNameAge,
  onThrowOut,
  onUndo,
  onClearRows,
  now,
}: AgelessReviewCardProps) {
  const waiting = useMemo(
    () => agelessWaiting(ageless, named, dropped, now),
    [ageless, named, dropped, now]
  );
  /**
   * The ten on screen, held so they do not reshuffle as they are answered.
   *
   * Unpersisted on purpose: a reload loses which ten were in front of somebody and nothing else,
   * because every answer is stored the moment it is given. Keeping it would be storing a thing
   * that can disagree with the answers, to save re-picking ten rows off the top of a sorted list.
   */
  const [pinned, setPinned] = useState<string[]>([]);

  /**
   * The rows a rule has settled, over the whole waiting list and memoised on it alone: one pass of
   * the rules over the stored rows, not the per-row work `agelessWaiting` does.
   */
  const clearable = useMemo(() => agelessClearable(waiting.map((row) => row.entry)), [waiting]);
  const groups = useMemo(() => clearGroups(clearable), [clearable]);
  const sitting = useMemo(
    (): AgelessSitting => ({
      listed: ageless.length,
      waiting: waiting.length,
      batch: agelessBatch(waiting, pinned),
      groups,
    }),
    [ageless.length, waiting, pinned, groups]
  );

  /**
   * Hunting one club by name or id.
   *
   * Over the whole list rather than the queue, because the queue is the small end of it and "I
   * know this club is in here" is exactly the case where it is not on the queue — already
   * answered, refused, or left alone months ago. Searching only what is on screen would answer
   * "no such team" to the one question this box exists for.
   */
  const [query, setQuery] = useState("");
  const found = useMemo(
    () => agelessSearch(ageless, named, dropped, now, query),
    [ageless, named, dropped, now, query]
  );

  /**
   * The whole list as a file.
   *
   * Built on the click and not before: the rows are the same objects the card already holds, so
   * nothing is copied until somebody asks, and the file is handed over in pieces so a
   * thirty-six-thousand-row export never exists as one string in memory.
   */
  const download = () => {
    downloadCsv(agelessCsvFilename(fileDay(now)), agelessCsvParts(waiting.map((row) => row.entry)));
  };

  return (
    <AgelessReviewView
      sitting={sitting}
      onPin={setPinned}
      query={query}
      onQuery={setQuery}
      found={found}
      onNameAge={onNameAge}
      onThrowOut={onThrowOut}
      onUndo={onUndo}
      onClear={(rules) => onClearRows(clearable.filter(({ rule }) => rules.has(rule.id)))}
      onDownload={download}
    />
  );
}
