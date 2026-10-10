import { useEffect, useMemo, useRef, useState } from "react";
import { isOver, isRefresh, sendRefresh, type PullSender } from "../../lib/cloud/cloudPulls";
import { MIN_PULL_GAP_HOURS } from "../../lib/gameChangerSchedule";
import type { ImportStatus } from "../../lib/live/queries";
import { button } from "../../styles/tokens";
import { PullLines, PULLS_SIGNED_OUT, type WatchedPulls } from "./LiveCloudPulls";

type Offer = NonNullable<ImportStatus["refreshNow"]>;

/** Said while a refresh this device is watching is still on its way. */
export const REFRESH_RUNNING = "A refresh is running in the cloud; how it is getting on is below.";
/** Said while a list this device sent is still being pulled. */
export const PULL_RUNNING =
  "A pull sent from this device is running in the cloud; Refresh now waits for it to end.";
/** Said where the cloud answered a press with the refresh another press had started. */
export const ALREADY_RUNNING = "A refresh was already running in the cloud: this is it.";

const teamsOf = (count: number): string =>
  `${count.toLocaleString()} team${count === 1 ? "" : "s"}`;

/**
 * What the card says "Refresh now" will pull, before it is pressed, from the server's own count
 * (`import.status`, `refreshNow`), which is what the cloud's first leg works out too, as of now.
 */
export const describeOffer = ({ teams, heldBack, again }: Offer): string => {
  const waiting =
    heldBack > 0
      ? ` ${teamsOf(heldBack)} pulled in the last ${MIN_PULL_GAP_HOURS} hours with no game yesterday, today or tomorrow ${heldBack === 1 ? "waits" : "wait"}.`
      : "";
  if (teams === 0) return `Refresh now has nothing to pull just now.${waiting}`;
  return again
    ? `Today's refresh has run. Refresh now pulls today's levels again in the cloud: about ${teamsOf(teams)}.${waiting}`
    : `Refresh now pulls today's refresh in the cloud now rather than tonight: about ${teamsOf(teams)}.${waiting}`;
};

/**
 * "Refresh now" on the live Import tab's nightly card (README, "Refresh now in the cloud"): starts,
 * in the cloud, the refresh the nightly would run now, and says how it is getting on in the lines
 * a pasted list's pull is told in (`PullLines`). Off, saying why, while edits are locked, with
 * nobody signed in, while a refresh or a pull this device is watching is on its way, and with
 * nothing to pull. A refresh another device started is handed back by the cloud and watched here.
 */
export default function LiveRefreshNow({
  offer,
  locked,
  pulls,
  watching,
  device,
  now,
  onEnded,
}: {
  /** What the button would pull, from the server's status; none from a server without it. */
  offer: Offer | undefined;
  /** The edit lock's reason, or null. */
  locked: string | null;
  pulls: () => PullSender | null;
  watching: WatchedPulls;
  device: string;
  now: () => string;
  /** Told once a refresh this device watched has ended, for the status to be read again. */
  onEnded: () => void;
}) {
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  const [said, setSaid] = useState<{ text: string; alert: boolean } | null>(null);
  const { watched, look } = watching;
  // New exactly when the watched list is, so the effect below runs on a read and not every render.
  const refreshes = useMemo(() => watched.filter(isRefresh), [watched]);
  const running = refreshes.some(({ job }) => !isOver(job));
  const pulling = watched.some((pull) => !isRefresh(pull) && !isOver(pull.job));

  // A refresh seen ending: what the card counts, and when each level was refreshed, have moved.
  const ended = useRef(new Set<string>());
  useEffect(() => {
    let any = false;
    for (const pull of refreshes) {
      if (isOver(pull.job) && !ended.current.has(pull.sent.jobId)) {
        ended.current.add(pull.sent.jobId);
        any = true;
      }
    }
    if (any) onEnded();
  }, [refreshes, onEnded]);

  const lines = (
    <PullLines
      pulls={refreshes}
      watching={watching}
      onStopFailed={(text) => setSaid({ text, alert: true })}
    />
  );
  // No count to offer (the status not read, or a server from before the button): the lines alone.
  if (!offer) return lines;
  const sender = pulls();
  const why = locked
    ? locked
    : !sender?.startRefresh
      ? PULLS_SIGNED_OUT
      : running
        ? REFRESH_RUNNING
        : pulling
          ? PULL_RUNNING
          : null;
  const press = async () => {
    if (!sender || sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    setSaid(null);
    // No time zone: the cloud keeps every refresh in New York's day, as the card's count is.
    const sent = await sendRefresh({ teams: offer.teams, device, now: now() }, sender);
    sendingNow.current = false;
    setSending(false);
    if (sent.ok) {
      if (sent.already) setSaid({ text: ALREADY_RUNNING, alert: false });
      look();
    } else setSaid({ text: sent.message, alert: true });
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
      <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="refresh-offer">
        {describeOffer(offer)}
      </p>
      <button
        type="button"
        disabled={why !== null || sending || offer.teams === 0}
        aria-busy={sending}
        onClick={() => void press()}
        className={`${button.primary} mt-3`}
      >
        {sending ? "Starting…" : "Refresh now"}
      </button>
      {why ? <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{why}</p> : null}
      {said ? (
        <p
          role={said.alert ? "alert" : "status"}
          className={`mt-2 text-sm ${said.alert ? "text-red-700 dark:text-red-300" : "text-slate-600 dark:text-slate-300"}`}
        >
          {said.text}
        </p>
      ) : null}
      {lines}
    </div>
  );
}
