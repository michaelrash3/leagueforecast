import { useSyncExternalStore } from "react";
import { isPullLive, watchPull } from "../../lib/pullSession";
import { useState } from "react";
import type { GcImportState } from "../../lib/gameChangerImport";
import { describeTidy } from "../../lib/gameChangerImport";
import type { PoolHealth } from "../../lib/poolHealth";
import { unpulledClubs, unpulledClubsCsv } from "../../lib/unpulledClubs";
import { usePoolTidy, type TidyOutcome } from "../../hooks/usePoolTidy";
import { button, card, pill } from "../../styles/tokens";

type PoolHealthCardProps = {
  pool: GcImportState;
  tidyStamp: string;
  /** Saves a tidied pool and stamps it, so the work is not done again for nothing. */
  onTidied: (outcome: TidyOutcome) => void;
};

const count = (value: number) => value.toLocaleString();

const Row = ({ label, value, note }: { label: string; value: string; note?: string }) => (
  <>
    <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="font-bold text-slate-950 dark:text-white">
      {value}
      {note ? <span className="ml-2 text-xs font-normal text-slate-500">{note}</span> : null}
    </dd>
  </>
);

/**
 * What the pool is actually made of, and what is waiting to be fixed.
 *
 * There was nothing anywhere that would tell you a pool of two hundred thousand games had eleven
 * thousand results still filed against "TBD" — the code that settles them worked, it had just
 * never finished running, and a pool in that state looks exactly like a pool in good order. These
 * are the numbers that say which.
 */
export function PoolHealthCard({ pool, tidyStamp, onTidied }: PoolHealthCardProps) {
  /*
   * A pull keeps running when its panel is closed, so this card can be looking at a pool that is
   * still moving. A tidy started now would write the whole pool over what the pull has since
   * saved — and the pull's cursor has already recorded those teams as settled, so a resume would
   * not fetch them again.
   */
  const pullLive = useSyncExternalStore(watchPull, isPullLive, () => false);
  const { inspect, tidy, busy } = usePoolTidy();
  const [health, setHealth] = useState<PoolHealth | null>(null);
  const [settleable, setSettleable] = useState(0);
  const [lastTidy, setLastTidy] = useState<string[] | null>(null);
  const [toPull, setToPull] = useState<ReturnType<typeof unpulledClubs> | null>(null);

  const look = async () => {
    const found = await inspect(pool, tidyStamp);
    // Null means the panel went away mid-look, so there is nobody left to show it to.
    if (!found) return;
    setHealth(found.health);
    setSettleable(found.settleable);
    setLastTidy(null);
    setToPull(unpulledClubs(pool));
  };

  const run = async () => {
    const outcome = await tidy(pool);
    // Refused because something else has the pool. The button is disabled while a pull is running,
    // so this is the narrow case of another tidy already going — nothing to say, nothing to do.
    if (!outcome) return;
    onTidied(outcome);
    setLastTidy(describeTidy({ ...outcome.tidy, state: outcome.state }));
    const found = await inspect(outcome.state, "");
    if (!found) return;
    setHealth(found.health);
    setSettleable(found.settleable);
    setToPull(unpulledClubs(outcome.state));
  };

  /**
   * The list as a file. A to-do rather than an import format: GameChanger has no id for any of
   * these — that is why they are on the list — so it carries what it takes to find them.
   */
  const downloadToPull = () => {
    if (!toPull || toPull.length === 0) return;
    const blob = new Blob([unpulledClubsCsv(toPull)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Clubs_To_Pull.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Pool health</h2>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        What the pool is made of, and what the tidy could still settle. A result filed against a
        stand-in counts for nobody — the club that played it is sitting on the other side&apos;s
        schedule, waiting to be matched.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void look()}
          disabled={busy !== null || pool.games.length === 0}
          className={button.ghost}
        >
          {busy === "inspect" ? "Looking…" : health ? "Look again" : "Check the pool"}
        </button>
        {health && settleable > 0 && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy !== null || pullLive}
            className={button.primary}
          >
            {busy === "tidy" ? "Tidying…" : `Settle ${count(settleable)} of them`}
          </button>
        )}
      </div>

      {pullLive && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          A pull is running, so this waits. Both write the whole pool, and the one that finishes
          second would overwrite what the other had just saved.
        </p>
      )}

      {busy === "tidy" && (
        <p className="mt-2 text-xs text-slate-500">
          Walking every game, several times over. On a nationwide pool this takes a while — the page
          stays usable while it runs.
        </p>
      )}

      {health && (
        <div className="mt-4 text-sm">
          <p>
            {health.tidied ? (
              <span className={pill("emerald")}>Tidied</span>
            ) : (
              <span className={pill("amber")}>Not tidied since it last changed</span>
            )}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <Row
              label="Games"
              value={count(health.games)}
              note={`${count(health.played)} played`}
            />
            <Row
              label="Clubs"
              value={count(health.clubs)}
              note={`of ${count(health.teams)} entries`}
            />
            <Row
              label="Known only by name"
              value={count(health.nameOnly)}
              note="never pulled; an opponent, never ranked"
            />
            <Row label="Stand-ins" value={count(health.placeholders)} note="a TBD names nobody" />
            <Row
              label="Results against a stand-in"
              value={count(health.standInPlayed)}
              note={`of ${count(health.standInGames)} such games`}
            />
            {health.undated > 0 && (
              <Row
                label="No date"
                value={count(health.undated)}
                note="cannot be placed in a season"
              />
            )}
          </dl>

          <p className="mt-3 text-sm">
            {settleable > 0 ? (
              <>
                <strong>{count(settleable)}</strong> of those can be settled right now — the other
                side&apos;s schedule names the club and the scores mirror.
              </>
            ) : health.standInPlayed > 0 ? (
              <>
                None of them can be settled from what is here: nobody has pulled the other side of
                those games yet.
              </>
            ) : (
              <>Nothing is waiting.</>
            )}
          </p>
        </div>
      )}

      {toPull && toPull.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
            Clubs worth pulling next
          </h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
            <strong>{count(toPull.length)}</strong> clubs are named on schedules you have pulled and
            have no schedule of their own here. Nothing in the pool can identify them — only pulling
            them can. Each one you add turns its games into a real result on both sides.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {toPull.slice(0, 5).map((club) => (
              <li key={club.teamId}>
                <span className="font-bold text-slate-700 dark:text-slate-200">{club.name}</span>
                {" — "}
                {club.played} result{club.played === 1 ? "" : "s"} waiting
                {club.states.length > 0 ? ` · ${club.states.join(", ")}` : ""}
                {club.levels.length > 0
                  ? ` · ${club.levels.map((level) => `${level}U`).join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
          <button type="button" onClick={downloadToPull} className={`${button.ghost} mt-3 text-sm`}>
            Download the list ({count(toPull.length)})
          </button>
          <p className="mt-2 text-xs text-slate-500">
            Ordered by how much each is holding up. The file carries the name, where the clubs that
            named it are from, the age level and season, and who played it — enough to find the team
            on GameChanger and paste its id into the next pull.
          </p>
        </div>
      )}

      {lastTidy && (
        <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
          {lastTidy.length === 0 ? (
            <li>Nothing left to do.</li>
          ) : (
            lastTidy.map((line) => <li key={line}>{line}</li>)
          )}
        </ul>
      )}
    </div>
  );
}
