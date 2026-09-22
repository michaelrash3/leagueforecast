import { useMemo, useState } from "react";
import {
  AGELESS_BATCH,
  agelessBatch,
  agelessSearch,
  agelessWaiting,
  batchIds,
} from "../../lib/agelessQueue";
import type { AgelessAside, AgelessHit, AgelessRow } from "../../lib/agelessQueue";
import { nameableAgeLevels } from "../../lib/agelessEvidence";
import type { AgeUnknownList } from "../../lib/ageUnknown";
import type { NamedAges } from "../../lib/namedAges";
import type { DeletedClubs } from "../../lib/deletedGames";
import { gcTeamPageUrl } from "../../lib/gameChangerApi";
import { agelessCsvFilename, agelessCsvParts } from "../../lib/agelessCsv";
import { downloadCsv, fileDay } from "../../lib/download";
import { button, card, pill } from "../../styles/tokens";

type AgelessReviewCardProps = {
  ageless: AgeUnknownList;
  named: NamedAges;
  dropped: DeletedClubs;
  /** Records that this club is that age; it is filed on the next refresh. */
  onNameAge: (teamId: string, name: string | undefined, level: number) => void;
  /** Throws the club out: never fetched, never filed, never asked about again. */
  onThrowOut: (teamId: string, name: string | undefined) => Promise<boolean> | boolean;
  /** Takes back a named age or a throw-out. Only ever offered on a team found by searching. */
  onUndo: (teamId: string, name: string | undefined) => void;
  /** Today, so "has this been asked about recently" is one answer for the whole render. */
  now: Date;
};

/** "4 games, 3 ahead of today" — the row's evidence, in the order a reader scans it. */
function Evidence({ row }: { row: AgelessRow }) {
  const evidence = row.evidence;
  if (!evidence) return null;
  const notes: string[] = [];
  if (evidence.games > 0) notes.push(`${evidence.games} games`);
  if (evidence.aheadOfToday > 0)
    notes.push(`${evidence.aheadOfToday} scored on a day that has not happened`);
  if (evidence.shutoutBlowouts > 0) notes.push(`${evidence.shutoutBlowouts} shutout blowouts`);
  if (evidence.record)
    notes.push(`GameChanger says ${evidence.record.win}-${evidence.record.loss}`);
  if (evidence.playerCount !== undefined) notes.push(`${evidence.playerCount} players`);
  if (evidence.ageLabel) notes.push(`age field reads "${evidence.ageLabel}"`);
  const place = [evidence.city, evidence.state].filter(Boolean).join(", ");
  if (place) notes.push(place);
  return (
    <p className="mt-1 text-xs text-slate-500">
      {notes.join(" · ")}
      {evidence.sampleOpponents && evidence.sampleOpponents.length > 0 && (
        <span className="block">Played: {evidence.sampleOpponents.join(", ")}</span>
      )}
    </p>
  );
}

/**
 * The teams nobody could age, ten at a time, for somebody to settle by hand.
 *
 * They are the one population this app holds that nothing automatic can finish. The three ways a
 * team gets an age have all missed, and two of the three can never come good on their own: the
 * club has to edit its own GameChanger page, or the team has to play somebody who writes an age in
 * their name. For a rec league where nobody does, neither ever happens, and the app would ask the
 * same question every week for ever.
 *
 * So the question comes here instead. Each row carries the GameChanger id and the complete name —
 * the two things somebody needs to go and look the team up — with a link straight to its page, and
 * whatever was kept about it at the moment it was refused.
 *
 * Nothing here is coloured by how invented a team looks. That number orders the queue and does
 * nothing else: an empty schedule is a club somebody made this morning as often as it is a
 * fiction, and a roster of six in September is twelve in October.
 */
/** What stands between a team somebody found and the queue, said plainly. */
const ASIDE_NOTE: Record<AgelessAside, string> = {
  dropped: "You threw this one out. It is never fetched, filed or asked about again.",
  named: "You have already said what age this is. It is filed on the next refresh.",
  "high-school":
    "The name reads as a high school squad, so it is left out of the rankings and off this queue.",
  "left-alone":
    "Left alone: it had its asks and its weeks and nobody could ever age it. Saying what age it " +
    "is puts it back in the queue.",
};

/**
 * One team, and the three things somebody can say about it.
 *
 * Shared by the queue and the search rather than written twice, because a team found by name has
 * to offer exactly what the queue would have offered for it — a search that can show a team but
 * not answer it would send somebody back to look for it again.
 */
function Row({
  row,
  aside,
  levels,
  onNameAge,
  onThrowOut,
  onUndo,
  beforeAnswer,
}: {
  row: AgelessRow;
  aside?: AgelessAside;
  levels: number[];
  onNameAge: AgelessReviewCardProps["onNameAge"];
  onThrowOut: AgelessReviewCardProps["onThrowOut"];
  /** Present only for a team held off the queue by an answer somebody gave. */
  onUndo?: () => void;
  /** Holds the batch still while it is being worked. Nothing to hold in a search. */
  beforeAnswer: () => void;
}) {
  const label = row.entry.name ?? row.entry.teamId;
  /*
   * An answer is offered only where it can land. A thrown-out club and a high school squad are
   * both refused by the import before an age is ever read, so naming one would be worse than
   * useless: the row is revived, the pull refuses it, and `updateAgeUnknown` drops the row for
   * any outcome that is not "no age" — taking the team, and the undo, off this card for good.
   * The way back from those two is the undo, not an age.
   */
  const answerable = aside !== "dropped" && aside !== "high-school";
  return (
    <li className="border-t border-slate-100 pt-3 dark:border-slate-800">
      <p className="font-bold text-slate-950 dark:text-white">
        {row.entry.name ?? "Name not recorded"}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        {/* Selectable, because the whole point is looking it up somewhere else. */}
        <code className="select-all font-mono">{row.entry.teamId}</code>{" "}
        <a
          href={gcTeamPageUrl(row.entry.teamId)}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-slate-950 dark:hover:text-white"
        >
          Open on GameChanger
        </a>
      </p>
      {aside && (
        <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
          {ASIDE_NOTE[aside]}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">{row.why}</p>
      {row.hint && (
        <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{row.hint}</p>
      )}
      <Evidence row={row} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {answerable && (
          <>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="sr-only">Age for {label}</span>
              It is
            </label>
            <select
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              aria-label={`Age for ${label}`}
              defaultValue=""
              onChange={(event) => {
                const level = Number(event.target.value);
                if (!Number.isFinite(level) || level === 0) return;
                beforeAnswer();
                onNameAge(row.entry.teamId, row.entry.name, level);
              }}
            >
              <option value="">Choose…</option>
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}U
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${button.ghost} text-sm`}
              onClick={() => {
                beforeAnswer();
                void onThrowOut(row.entry.teamId, row.entry.name);
              }}
            >
              Not a real team
            </button>
            <button
              type="button"
              className={`${button.ghost} text-sm`}
              onClick={() => {
                beforeAnswer();
                void onThrowOut(row.entry.teamId, row.entry.name);
              }}
            >
              High school
            </button>
          </>
        )}
        {onUndo && (
          <button type="button" className={`${button.ghost} text-sm`} onClick={onUndo}>
            Undo that
          </button>
        )}
        {row.invented > 0 && (
          <span className={pill("neutral")}>
            {row.invented >= 0.5 ? "Looks invented" : "Something looks off"}
          </span>
        )}
      </div>
    </li>
  );
}

export function AgelessReviewCard({
  ageless,
  named,
  dropped,
  onNameAge,
  onThrowOut,
  onUndo,
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
  const batch = useMemo(() => agelessBatch(waiting, pinned), [waiting, pinned]);
  const levels = useMemo(() => nameableAgeLevels(), []);

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
  const searching = query.trim().length > 0;

  if (ageless.length === 0) return null;

  const showing = batch.length;
  const rest = waiting.length - showing;

  return (
    <div className={`${card} mt-4 p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Teams waiting on an age
        </h3>
        <button type="button" className={`${button.ghost} text-xs`} onClick={download}>
          Download the list
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {waiting.length.toLocaleString()} team{waiting.length === 1 ? "" : "s"} nobody could age.
        GameChanger gave no age group, the name does not say one, and too few of their opponents
        write one in theirs. Nothing automatic will settle these — the club has to fix its own page,
        or the team has to play somebody who names an age — so they are here, {AGELESS_BATCH} at a
        time, likeliest real first. The next {AGELESS_BATCH} come up once these are done.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {waiting.length.toLocaleString()} of them is not a queue anybody works {AGELESS_BATCH} at a
        time, so the whole list downloads as a spreadsheet — every row with the evidence behind it
        and a blank <span className="font-semibold">Answer</span> column to fill in. It sorts, it
        filters, and it reads on a bigger screen than the one it was collected on.
      </p>
      <label className="mt-3 block">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Find a team
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or GameChanger id"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      {searching && (
        <p className="mt-2 text-xs text-slate-500">
          {found.total === 0
            ? "No team on this list answers to that. It may have been filed already, or never pulled at all."
            : `${found.total.toLocaleString()} match${found.total === 1 ? "" : "es"}${
                found.total > found.hits.length
                  ? `; showing the first ${found.hits.length}. Type more to narrow it.`
                  : "."
              }`}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {searching
          ? found.hits.map((hit: AgelessHit) => (
              <Row
                key={hit.row.entry.teamId}
                row={hit.row}
                {...(hit.aside ? { aside: hit.aside } : {})}
                levels={levels}
                onNameAge={onNameAge}
                onThrowOut={onThrowOut}
                {...(hit.aside === "dropped" || hit.aside === "named"
                  ? { onUndo: () => onUndo(hit.row.entry.teamId, hit.row.entry.name) }
                  : {})}
                beforeAnswer={() => {}}
              />
            ))
          : batch.map((row) => (
              <Row
                key={row.entry.teamId}
                row={row}
                levels={levels}
                onNameAge={onNameAge}
                onThrowOut={onThrowOut}
                beforeAnswer={() => setPinned(batchIds(batch))}
              />
            ))}
      </ul>
      {!searching && (
        <p className="mt-3 text-xs text-slate-500">
          Showing {showing} of {waiting.length.toLocaleString()}
          {rest > 0 ? `; ${rest.toLocaleString()} behind these` : ""}. Naming an age files the club
          on the next refresh — there is nothing stored to file it from now, because a team nobody
          could age is never kept. Throwing one out takes effect at once and is remembered, so no
          later pull brings it back — which is what both buttons do, one for a club that is not real
          and one for a high school squad, which is real and plays a season this app does not rank.
        </p>
      )}
    </div>
  );
}
