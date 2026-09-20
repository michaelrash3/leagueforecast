import { useMemo, useState } from "react";
import { AGELESS_BATCH, agelessBatch, agelessWaiting, batchIds } from "../../lib/agelessQueue";
import type { AgelessRow } from "../../lib/agelessQueue";
import { nameableAgeLevels } from "../../lib/agelessEvidence";
import type { AgeUnknownList } from "../../lib/ageUnknown";
import type { NamedAges } from "../../lib/namedAges";
import type { DeletedClubs } from "../../lib/deletedGames";
import { gcTeamPageUrl } from "../../lib/gameChangerApi";
import { button, card, pill } from "../../styles/tokens";

type AgelessReviewCardProps = {
  ageless: AgeUnknownList;
  named: NamedAges;
  dropped: DeletedClubs;
  /** Records that this club is that age; it is filed on the next refresh. */
  onNameAge: (teamId: string, name: string | undefined, level: number) => void;
  /** Throws the club out: never fetched, never filed, never asked about again. */
  onThrowOut: (teamId: string, name: string | undefined) => Promise<boolean> | boolean;
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
export function AgelessReviewCard({
  ageless,
  named,
  dropped,
  onNameAge,
  onThrowOut,
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

  if (waiting.length === 0) return null;

  const showing = batch.length;
  const rest = waiting.length - showing;

  return (
    <div className={`${card} mt-4 p-5`}>
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">
        Teams waiting on an age
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {waiting.length.toLocaleString()} team{waiting.length === 1 ? "" : "s"} nobody could age.
        GameChanger gave no age group, the name does not say one, and too few of their opponents
        write one in theirs. Nothing automatic will settle these — the club has to fix its own page,
        or the team has to play somebody who names an age — so they are here, {AGELESS_BATCH} at a
        time. The next {AGELESS_BATCH} come up once these are done.
      </p>
      <ul className="mt-3 space-y-3">
        {batch.map((row) => (
          <li
            key={row.entry.teamId}
            className="border-t border-slate-100 pt-3 dark:border-slate-800"
          >
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
            <p className="mt-1 text-xs text-slate-500">{row.why}</p>
            {row.hint && (
              <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                {row.hint}
              </p>
            )}
            <Evidence row={row} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span className="sr-only">Age for {row.entry.name ?? row.entry.teamId}</span>
                It is
              </label>
              <select
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                aria-label={`Age for ${row.entry.name ?? row.entry.teamId}`}
                defaultValue=""
                onChange={(event) => {
                  const level = Number(event.target.value);
                  if (!Number.isFinite(level) || level === 0) return;
                  setPinned(batchIds(batch));
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
                  setPinned(batchIds(batch));
                  void onThrowOut(row.entry.teamId, row.entry.name);
                }}
              >
                Not a real team
              </button>
              <button
                type="button"
                className={`${button.ghost} text-sm`}
                onClick={() => {
                  setPinned(batchIds(batch));
                  void onThrowOut(row.entry.teamId, row.entry.name);
                }}
              >
                High school
              </button>
              {row.invented > 0 && (
                <span className={pill("neutral")}>
                  {row.invented >= 0.5 ? "Looks invented" : "Something looks off"}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Showing {showing} of {waiting.length.toLocaleString()}
        {rest > 0 ? `; ${rest.toLocaleString()} behind these` : ""}. Naming an age files the club on
        the next refresh — there is nothing stored to file it from now, because a team nobody could
        age is never kept. Throwing one out takes effect at once and is remembered, so no later pull
        brings it back — which is what both buttons do, one for a club that is not real and one for
        a high school squad, which is real and plays a season this app does not rank.
      </p>
    </div>
  );
}
