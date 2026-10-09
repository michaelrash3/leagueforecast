/**
 * League Standings' data quality (2.3): every finding on the season, grouped by how much it
 * matters, each with what it is about, what to do, a way to the game, team or setting to do it,
 * and, where the app can make the change itself, a preview of exactly what it will do before it
 * does it. A finding that does not need attention can be put aside, and comes back if what it is
 * about changes or it grows more serious (`isDismissed`).
 */
import { useState } from "react";
import {
  canDismiss,
  repairIsDestructive,
  SEVERITY_LABEL,
  severityCounts,
  type Finding,
  type FindingRepair,
  type FindingSeverity,
  type FindingTarget,
} from "../../lib/leagueFindings";
import type { DataQualityTier } from "../../lib/predictionEngine";
import { button, card, focusRing, pill, type PillTone } from "../../styles/tokens";
import { EditLock } from "./EditLock";

const TONE: Record<FindingSeverity, PillTone> = { attention: "red", review: "amber", info: "blue" };
const GROUPS: FindingSeverity[] = ["attention", "review", "info"];
/** A finding lists this many places at most, and says how many more there are. */
const TARGETS_SHOWN = 8;

const REPAIR_LABEL: Record<FindingRepair["kind"], string> = {
  removeGames: "Delete the extra copies…",
  markFinal: "Mark them final…",
  gamesPerTeam: "Use the schedule's count…",
};

/** The small buttons on a finding: its links, its repair, and the repair's Cancel. */
const smallButton = `rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const smallPrimary = `rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

const targetLabel = (target: FindingTarget) =>
  target.kind === "setting" ? `${target.label} in Settings` : target.label;

export type DataQualityViewProps = {
  findings: readonly Finding[];
  /** Findings put aside on this device, still standing. */
  putAside: readonly Finding[];
  tier: DataQualityTier;
  preview: (repair: FindingRepair) => string[];
  onOpen: (target: FindingTarget) => void;
  onRepair: (finding: Finding) => void;
  onPutAside: (finding: Finding) => void;
  onBringBack: (finding: Finding) => void;
};

function FindingCard({
  finding,
  preview,
  onOpen,
  onRepair,
  onPutAside,
  onBringBack,
  asideNow,
}: Omit<DataQualityViewProps, "findings" | "putAside" | "tier"> & {
  finding: Finding;
  asideNow: boolean;
}) {
  const [previewing, setPreviewing] = useState(false);
  const [everyTarget, setEveryTarget] = useState(false);
  const shown = everyTarget ? finding.targets : finding.targets.slice(0, TARGETS_SHOWN);
  const more = finding.targets.length - shown.length;
  const repair = finding.repair;
  return (
    <li className={`${card} p-4`} aria-label={finding.summary}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={pill(TONE[finding.severity])}>{SEVERITY_LABEL[finding.severity]}</span>
        {finding.affectsForecast && <span className={pill("neutral")}>Affects the forecast</span>}
      </div>
      <h3 className="mt-3 text-base font-black text-slate-950 dark:text-slate-100">
        {finding.summary}
      </h3>
      <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
        {finding.detail}
      </p>
      <p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">
        What to do: <span className="font-semibold">{finding.suggestion}</span>
      </p>
      {shown.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Where to put it right">
          {shown.map((target) => (
            <li key={`${target.kind}:${target.id}`}>
              <button type="button" onClick={() => onOpen(target)} className={smallButton}>
                Open {targetLabel(target)}
              </button>
            </li>
          ))}
          {more > 0 && (
            <li className="self-center">
              <button
                type="button"
                onClick={() => setEveryTarget(true)}
                className={`text-xs font-bold text-slate-500 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-white ${focusRing}`}
              >
                Show {more} more
              </button>
            </li>
          )}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {repair && !previewing && (
          <EditLock>
            <button type="button" onClick={() => setPreviewing(true)} className={smallButton}>
              {REPAIR_LABEL[repair.kind]}
            </button>
          </EditLock>
        )}
        {asideNow ? (
          <button
            type="button"
            onClick={() => onBringBack(finding)}
            className={`text-xs font-bold text-slate-500 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-white ${focusRing}`}
          >
            Bring back
          </button>
        ) : (
          canDismiss(finding) && (
            <button
              type="button"
              onClick={() => onPutAside(finding)}
              className={`text-xs font-bold text-slate-500 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-white ${focusRing}`}
            >
              Put aside
            </button>
          )
        )}
      </div>
      {repair && previewing && (
        <section
          aria-label="What this will change"
          className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            This will
          </p>
          <ul className="mt-1 space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {preview(repair).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Undo puts it back as it was.
          </p>
          <EditLock>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPreviewing(false);
                  onRepair(finding);
                }}
                className={repairIsDestructive(repair) ? button.danger : smallPrimary}
              >
                {repairIsDestructive(repair) ? "Delete" : "Make the change"}
              </button>
              <button type="button" onClick={() => setPreviewing(false)} className={smallButton}>
                Cancel
              </button>
            </div>
          </EditLock>
        </section>
      )}
    </li>
  );
}

export function DataQualityView({
  findings,
  putAside,
  tier,
  preview,
  onOpen,
  onRepair,
  onPutAside,
  onBringBack,
}: DataQualityViewProps) {
  const counts = severityCounts(findings);
  const forecastAffected = findings.some(
    (finding) => finding.affectsForecast && finding.severity !== "info"
  );
  const [showAside, setShowAside] = useState(false);
  const cardProps = { preview, onOpen, onRepair, onPutAside, onBringBack };
  return (
    <div className="grid grid-cols-1 gap-6">
      <section>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">
          Data Quality
        </h2>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          What in this season&rsquo;s games, teams and settings is wrong or worth a second look, and
          how to put it right.
        </p>
      </section>

      <section className={`${card} p-4`} aria-label="Summary">
        <div className="flex flex-wrap items-center gap-2">
          <span className={pill("dark")}>Data: {tier}</span>
          {GROUPS.map((severity) => (
            <span key={severity} className={pill(counts[severity] ? TONE[severity] : "neutral")}>
              {counts[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
            </span>
          ))}
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
          {forecastAffected
            ? "The forecast is less reliable until the findings marked “Affects the forecast” are put right."
            : findings.length
              ? "Nothing here changes the forecast's numbers."
              : "Nothing to flag: the season's games, teams and settings look right."}
        </p>
      </section>

      {GROUPS.map((severity) => {
        const group = findings.filter((finding) => finding.severity === severity);
        if (!group.length) return null;
        return (
          <section key={severity} aria-label={SEVERITY_LABEL[severity]}>
            <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {SEVERITY_LABEL[severity]} ({group.length})
            </h3>
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {group.map((finding) => (
                <FindingCard
                  key={finding.fingerprint}
                  finding={finding}
                  asideNow={false}
                  {...cardProps}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {putAside.length > 0 && (
        <section aria-label="Put aside">
          <button
            type="button"
            onClick={() => setShowAside((open) => !open)}
            aria-expanded={showAside}
            className={`text-sm font-black text-slate-600 underline dark:text-slate-300 ${focusRing}`}
          >
            {showAside ? "Hide" : "Show"} {putAside.length} put aside
          </button>
          {showAside && (
            <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {putAside.map((finding) => (
                <FindingCard key={finding.fingerprint} finding={finding} asideNow {...cardProps} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
