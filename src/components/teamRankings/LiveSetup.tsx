import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { button, card } from "../../styles/tokens";
import { LiveAgelessCard } from "./LiveAgelessCard";
import { LivePoolHealthCard } from "./LivePoolHealthCard";

/**
 * Setup on the live page (1.5): the teams waiting on an age and Pool health from the server's pool,
 * their answers and edits sent to the edit function, since those are the edits the pool is cleaned
 * up with. The rest of Setup (the league seasons, the model check, archiving a year and starting
 * again) is opened on this device's copy until each is live too, by asking for it: the page hands
 * over to Team Rankings there, on Setup.
 */
export default function LiveSetup({
  edits,
  confirm,
  today,
  onOpenTeam,
  onRestWanted,
}: {
  edits: LiveEdits;
  confirm: Confirmation["request"];
  today: string;
  onOpenTeam: (teamId: string) => void;
  /** Opens the rest of Setup on this device's copy. */
  onRestWanted: () => void;
}) {
  return (
    <>
      <LiveAgelessCard edits={edits} confirm={confirm} today={today} />
      <LivePoolHealthCard edits={edits} confirm={confirm} today={today} onOpenTeam={onOpenTeam} />
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          The rest of Setup
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The league seasons, the model check, archiving a year and starting again open on this
          device&apos;s copy for now.
        </p>
        <button type="button" onClick={onRestWanted} className={`${button.ghost} mt-3`}>
          Open them on this device&apos;s copy
        </button>
      </div>
    </>
  );
}
