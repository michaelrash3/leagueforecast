import { useEffect, useMemo, useRef, useState } from "react";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { agelessCsvFilename } from "../../lib/agelessCsv";
import { agelessRowFor, type AgelessHit } from "../../lib/agelessQueue";
import type { AgelessSitting } from "../../lib/agelessSitting";
import { downloadCsv, fileDay } from "../../lib/download";
import type { PoolCommand } from "../../lib/live/commands";
import type { AgelessQueueAnswer } from "../../lib/live/queries";
import { button, card } from "../../styles/tokens";
import { AgelessReviewView } from "./AgelessReviewView";

/** How long the search waits after the last key before it asks: a name is typed, not each letter. */
export const AGELESS_SEARCH_WAIT_MS = 300;

const NOTHING_FOUND = { hits: [] as AgelessHit[], total: 0 };

/**
 * The teams waiting on an age on the live page (1.5): drawn as the device's own card draws them
 * (`AgelessReviewView`), from the server's list (`ageless.queue`, `ageless.search`), each answer
 * sent to the edit function as the edit the device's card makes, and the list asked for again once
 * an answer is made, or taken back. The ten in front of the person are held between questions as
 * the device's card holds them, by sending them back pinned.
 */
export function LiveAgelessCard({
  edits,
  confirm,
  today,
}: {
  edits: LiveEdits;
  confirm: Confirmation["request"];
  /** The device's day, which the queue's "asked about lately" is judged by. */
  today: string;
}) {
  const { locked, edit, ask, poolRevision } = edits;
  const [queue, setQueue] = useState<AgelessQueueAnswer | null>(null);
  const [queueAt, setQueueAt] = useState(poolRevision);
  const [unread, setUnread] = useState(false);
  // Bumped to ask again, after an answer made or taken back.
  const [asked, setAsked] = useState(0);
  const askAgain = () => setAsked((times) => times + 1);
  /** The ten in front of the person, sent with each question so they stay there. */
  const pinned = useRef<string[]>([]);
  const pinnedAt = useRef(poolRevision);

  useEffect(() => {
    if (locked) return;
    if (pinnedAt.current !== poolRevision) {
      pinned.current = [];
      pinnedAt.current = poolRevision;
    }
    let alive = true;
    const controller = new AbortController();
    void ask(
      { kind: "ageless.queue", today, pinned: pinned.current },
      { signal: controller.signal }
    ).then((answer) => {
      if (!alive) return;
      setUnread(answer === null);
      if (answer) {
        setQueue(answer);
        setQueueAt(poolRevision);
      }
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [locked, ask, today, asked, poolRevision]);

  // The search, asked once the typing stops, and again with the list after an answer.
  const [query, setQuery] = useState("");
  // What a search found, with the words it was asked for: another search's answer is not drawn
  // under words it was not asked for while theirs is on its way.
  const [found, setFound] = useState<{
    query: string;
    revision?: number;
    found: typeof NOTHING_FOUND;
  } | null>(null);
  useEffect(() => {
    if (locked || query.trim() === "") return;
    let alive = true;
    const controller = new AbortController();
    const soon = window.setTimeout(() => {
      void ask({ kind: "ageless.search", today, query }, { signal: controller.signal }).then(
        (answer) => {
          if (alive && answer)
            setFound({
              query,
              revision: poolRevision,
              found: {
                total: answer.total,
                hits: answer.hits.map(({ entry, aside }) => ({
                  row: agelessRowFor(entry),
                  ...(aside ? { aside } : {}),
                })),
              },
            });
        }
      );
    }, AGELESS_SEARCH_WAIT_MS);
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(soon);
    };
  }, [locked, ask, today, query, asked, poolRevision]);

  const sitting = useMemo(
    (): AgelessSitting | null =>
      queue && queueAt === poolRevision
        ? {
            listed: queue.listed,
            waiting: queue.waiting,
            batch: queue.batch.map(agelessRowFor),
            groups: queue.groups,
          }
        : null,
    [queue, queueAt, poolRevision]
  );

  if (!sitting && locked)
    return (
      <div className={`${card} mt-4 p-5`} role="status">
        <p className="text-sm text-slate-600 dark:text-slate-300">{locked}</p>
      </div>
    );
  if (!sitting)
    return unread ? (
      <div className={`${card} mt-4 p-5`} role="status">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The teams waiting on an age could not be read from the cloud just now.
        </p>
        <button type="button" onClick={askAgain} className={`${button.ghost} mt-3`}>
          Try again
        </button>
      </div>
    ) : null;

  /** An answer sent as an edit, after which (and after its Undo) the list is asked for again. */
  const answer = async (command: PoolCommand, done: string, undo = false): Promise<boolean> => {
    const made = await edit(command, { done, undo, ...(undo ? { afterUndo: askAgain } : {}) });
    if (made) askAgain();
    return made;
  };

  const clear = async (rules: ReadonlySet<string>): Promise<boolean> => {
    const plan = await ask({ kind: "ageless.clearPlan", today, rules: [...rules] });
    if (!plan || plan.teamIds.length === 0) return false;
    const breakdown = plan.byRule
      .map(({ label, count }) => `${count.toLocaleString()}: ${label}`)
      .join("\n");
    const teams = plan.teamIds.length.toLocaleString();
    const confirmed = await confirm({
      title: `Clear ${teams} teams?`,
      message:
        `${breakdown}\n\n` +
        "They leave the list and no later pull asks about them again. Nothing in the pool is " +
        "touched, and the pass can be undone afterwards.",
      confirmLabel: "Clear them",
    });
    if (!confirmed) return false;
    return answer(
      {
        kind: "batch",
        commands: [
          { kind: "answers", list: "droppedClubs", add: plan.teamIds, remove: [] },
          { kind: "ageless.forget", teamIds: plan.teamIds },
        ],
      },
      `${teams} teams cleared.`,
      true
    );
  };

  return (
    <AgelessReviewView
      sitting={sitting}
      onPin={(ids) => {
        pinned.current = ids;
      }}
      query={query}
      onQuery={setQuery}
      found={
        query.trim() !== "" && found?.query === query && found.revision === poolRevision
          ? found.found
          : NOTHING_FOUND
      }
      onNameAge={(teamId, name, level) =>
        void answer(
          {
            kind: "namedAges",
            put: [{ teamId, level, ...(name ? { name } : {}), namedAt: new Date().toISOString() }],
            forget: [],
          },
          `${name ?? teamId} is ${level}U. It will be filed on the next refresh.`
        )
      }
      // Off the waiting list as it is thrown out, as the device's card takes it off; the Undo puts
      // both back.
      onThrowOut={(teamId, name) =>
        answer(
          {
            kind: "batch",
            commands: [
              { kind: "answers", list: "droppedClubs", add: [teamId], remove: [] },
              { kind: "ageless.forget", teamIds: [teamId] },
            ],
          },
          `${name ?? teamId} thrown out.`,
          true
        )
      }
      onUndo={(teamId, name) =>
        void answer(
          {
            kind: "batch",
            commands: [
              { kind: "answers", list: "droppedClubs", add: [], remove: [teamId] },
              { kind: "namedAges", put: [], forget: [teamId] },
            ],
          },
          `${name ?? teamId} is back on the queue.`
        )
      }
      onClear={clear}
      onDownload={() =>
        void ask({ kind: "ageless.file", today }).then((file) => {
          if (file) downloadCsv(agelessCsvFilename(fileDay(new Date(today))), file.csv);
        })
      }
    />
  );
}
