import { useState } from "react";
import type { GcImportState } from "../../lib/gameChangerImport";
import { describeTidy } from "../../lib/gameChangerImport";
import type { PoolHealth } from "../../lib/poolHealth";
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
  const { inspect, tidy, busy } = usePoolTidy();
  const [health, setHealth] = useState<PoolHealth | null>(null);
  const [settleable, setSettleable] = useState(0);
  const [lastTidy, setLastTidy] = useState<string[] | null>(null);

  const look = async () => {
    const found = await inspect(pool, tidyStamp);
    setHealth(found.health);
    setSettleable(found.settleable);
    setLastTidy(null);
  };

  const run = async () => {
    const outcome = await tidy(pool);
    onTidied(outcome);
    setLastTidy(describeTidy({ ...outcome.tidy, state: outcome.state }));
    const found = await inspect(outcome.state, "");
    setHealth(found.health);
    setSettleable(found.settleable);
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
            disabled={busy !== null}
            className={button.primary}
          >
            {busy === "tidy" ? "Tidying…" : `Settle ${count(settleable)} of them`}
          </button>
        )}
      </div>

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
