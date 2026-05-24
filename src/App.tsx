import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { CompareDrawer } from "./components/CompareDrawer";
import { OnboardingTour } from "./components/OnboardingTour";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ToastView } from "./components/Toast";
import { LineChart } from "./components/charts/LineChart";
import { useDarkMode } from "./hooks/useDarkMode";
import { useShortcuts, type Shortcut } from "./hooks/useShortcuts";
import { useToast } from "./hooks/useToast";
import { useUrlSnapshot } from "./hooks/useUrlState";
import {
  useSimulationOdds,
  useSimulationTrend,
} from "./hooks/useSimulationWorker";
import {
  csvEscape,
  normalizeHeader,
  parseCSVLine,
  stripBom,
} from "./lib/csv";
import {
  formatGameDate,
  formatGameDateLong,
  normalizeDateInput,
  parseDateValue,
} from "./lib/date";
import { displayName, recordText, teamAbbr } from "./lib/format";
import { pathSummary, recapToMarkdown, weeklyRecap, type RecapItem } from "./lib/insights";
import { eliminationNumberForGold, magicForGold } from "./lib/magic";
import { buildShareUrl } from "./lib/share";
import {
  applyResult,
  calculateTeams,
  createTeamId,
  getMathGoldStatus,
  getRemainingCounts,
  predictGame,
  projectStandings,
  rankTeams,
  simulationSeed,
  standingsPoints,
} from "./lib/sim";
import {
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  readUndoSnapshot,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  saveUndoSnapshot,
} from "./lib/storage";
import {
  DEFAULT_GOLD_CUTOFF,
  DEFAULT_SETTINGS,
  MODEL_AGGRESSION,
  SIM_ITERATIONS,
  TREND_STATES,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type Prediction,
  type Settings,
  type SwingGame,
  type Team,
  type TeamBase,
  type TeamWithProjection,
  type UndoSnapshot,
} from "./lib/types";
import { blankLog, clamp, isFinal, parseNumber } from "./lib/util";
import { button as buttonClasses, card, pill, tab } from "./styles/tokens";

type ActiveView = "standings" | "games" | "model" | "settings";

type RankSnapshotEntry = Team & {
  rank: number;
  projectedRank: number;
  goldPct: number;
  goldStatus: "Clinched" | "In" | "Alive" | "Eliminated";
  maxPoints: number;
  blockersAhead: number;
};

const VIEW_LABELS: Record<ActiveView, string> = {
  standings: "Standings",
  games: "Games",
  model: "Projection",
  settings: "Settings",
};

const VIEW_ORDER: ActiveView[] = ["standings", "games", "model", "settings"];

// ---------- Helpers that depend on app-shape but no state ----------

const projectedRunLine = (prediction: Prediction, byId: Map<string, Team>) => {
  const favorite = byId.get(prediction.winnerId);
  const favoriteName = favorite ? displayName(favorite.name) : prediction.winnerId;
  const rawMargin = Math.abs(prediction.awayScore - prediction.homeScore);
  const halfRunLine = Math.max(0.5, rawMargin - 0.5);
  return `${favoriteName} -${halfRunLine.toFixed(1)}`;
};

const upsetRiskLabel = (winnerPct: number, margin: number) => {
  if (winnerPct < 0.58 || margin <= 2) return "High";
  if (winnerPct < 0.7 || margin <= 5) return "Medium";
  return "Low";
};

const describePrediction = (
  game: Matchup,
  prediction: Prediction,
  byId: Map<string, Team>
) => {
  const away = byId.get(game.away);
  const home = byId.get(game.home);
  const winner = byId.get(prediction.winnerId);
  const loserId = prediction.winnerId === game.away ? game.home : game.away;
  const loser = byId.get(loserId);

  const awayName = displayName(away?.name || game.away);
  const homeName = displayName(home?.name || game.home);
  const winnerName = displayName(winner?.name || prediction.winnerId);
  void loser;

  if (!away || !home) {
    return `Model leans ${winnerName}, but one or both teams are missing from the imported team list.`;
  }

  const winnerPct =
    prediction.winnerId === game.away
      ? prediction.awayWinPct
      : 1 - prediction.awayWinPct;
  const tpiEdge = away.tpi - home.tpi;
  const scoringEdge = away.rsg - home.rsg;
  const preventionEdge = home.rag - away.rag;
  const kEdge = (home.homeK6 ?? 4.5) - ((away.awayK6 ?? 4.5) + home.machineDifficulty);

  const reasons: string[] = [];
  if (Math.abs(scoringEdge) >= 1.2) {
    reasons.push(`${scoringEdge > 0 ? awayName : homeName} has the stronger scoring profile`);
  }
  if (Math.abs(preventionEdge) >= 1.2) {
    reasons.push(`${preventionEdge > 0 ? awayName : homeName} has allowed fewer runs`);
  }
  if (Math.abs(tpiEdge) >= 1.5) {
    reasons.push(`${tpiEdge > 0 ? awayName : homeName} owns the better adjusted profile`);
  }
  if (Math.abs(kEdge) >= 1.0) {
    reasons.push(`${kEdge > 0 ? awayName : homeName} gets a contact/machine edge`);
  }
  if (!reasons.length) {
    reasons.push("the teams grade close, so the lean is mostly from projected run balance");
  }

  const confidenceText =
    prediction.confidence === "High"
      ? "a strong lean"
      : prediction.confidence === "Medium"
        ? "a clear lean"
        : "a light lean";

  return `${projectedRunLine(prediction, byId)} is ${confidenceText}: ${reasons.slice(0, 2).join(" and ")}. That gives ${winnerName} a ${Math.round(
    winnerPct * 100
  )}% win chance without treating the forecast like a literal final score.`;
};

const calcBip = (hits: string, runs: string, strikeouts: string, innings: string) => {
  const h = parseNumber(hits, NaN);
  const r = parseNumber(runs, NaN);
  const k = parseNumber(strikeouts, 0);
  const inn = parseNumber(innings, 6);
  const contact = Number.isFinite(h) ? h : Number.isFinite(r) ? r : 0;
  return contact + inn * 3 - k;
};

// ---------- Subcomponents ----------

const Sparkline = React.memo(function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <span className="text-slate-500">—</span>;
  const width = 108;
  const height = 30;
  const seed = values[0] ?? 0;
  const data = values.length === 1 ? [seed, seed] : values;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - (clamp(value, 0, 100) / 100) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const last = data[data.length - 1] ?? 0;
  const tone =
    last >= 75 ? "stroke-emerald-500" : last >= 40 ? "stroke-blue-500" : "stroke-slate-500";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Gold odds trend, latest ${Math.round(last)}%`}
    >
      <polyline
        points={points}
        fill="none"
        className={tone}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - (clamp(last, 0, 100) / 100) * height}
        r="3"
        className={tone.replace("stroke", "fill")}
      />
    </svg>
  );
});

function GameDateInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    const normalized = normalizeDateInput(draft);
    onCommit(normalized);
    setDraft(normalized);
  };

  return (
    <input
      type="text"
      inputMode="text"
      placeholder="5/1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white dark:focus:ring-slate-700"
      aria-label={ariaLabel ?? "Game date in M/D format"}
    />
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-4">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-300">{label}</div>
      <div className="mt-1 truncate text-xl font-black tracking-tight">{value}</div>
    </div>
  );
}

function InsightTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "red" | "blue" | "amber";
}) {
  const toneClasses =
    tone === "red"
      ? "border-red-100 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
      : tone === "blue"
        ? "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-300"
        : tone === "amber"
          ? "border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300"
          : "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 line-clamp-2 text-sm font-black leading-5">{value}</div>
    </div>
  );
}

function DrawerMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}

const ScoreRow = React.memo(function ScoreRow({
  teamName,
  prefix,
  log,
  onChange,
}: {
  teamName: string;
  prefix: "away" | "home";
  log: GameLog;
  onChange: (field: keyof GameLog, value: string) => void;
}) {
  const fields = [
    { key: `${prefix}Runs` as keyof GameLog, label: "R", aria: "Runs" },
    { key: `${prefix}Hits` as keyof GameLog, label: "H", aria: "Hits" },
    { key: `${prefix}K` as keyof GameLog, label: "K", aria: "Strikeouts" },
  ];
  const display = displayName(teamName);
  const abbr = teamAbbr(teamName);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
          {abbr}
        </div>
        <div className="truncate font-bold" title={teamName}>
          {display}
        </div>
      </div>
      <div className="flex gap-2">
        {fields.map((field) => (
          <label
            key={field.key}
            className="text-center text-[10px] font-black uppercase text-slate-500"
          >
            {field.label}
            <input
              value={String(log[field.key] ?? "")}
              onChange={(event) =>
                onChange(field.key, event.target.value.replace(/[^0-9]/g, "").slice(0, 2))
              }
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              aria-label={`${display} ${field.aria}`}
              className="mt-1 block h-10 w-11 rounded-xl border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
        ))}
      </div>
    </div>
  );
});

// ---------- TeamDrawer (a11y modal) ----------

function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSel =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(focusableSel)).filter(
        (el) => !el.hasAttribute("disabled")
      );
    const first = focusables()[0];
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, ref]);
}

function TeamDrawer({
  team,
  range,
  bubble,
  currentSosRank,
  sos,
  swings,
  clinchScenarios,
  titleRace,
  playoffStatus,
  goldPctLabel,
  cutoff,
  onClose,
  magicForGold,
  eliminationNumber,
  pathSummary,
  goldTrend,
  onCompare,
}: {
  team: TeamWithProjection;
  range: { best: number; worst: number; baseline: number };
  bubble: string;
  currentSosRank: number | null;
  sos: { label: string; avgSeed: number; opponents: string };
  swings: SwingGame[];
  clinchScenarios: string[];
  titleRace: string;
  playoffStatus: string;
  goldPctLabel: string;
  cutoff: number;
  onClose: () => void;
  magicForGold: import("./lib/magic").MagicResult;
  eliminationNumber: import("./lib/magic").MagicResult;
  pathSummary: string;
  goldTrend: number[];
  onCompare: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusTrap(true, ref as React.RefObject<HTMLElement>);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 p-3"
      onClick={onClose}
      role="presentation"
    >
      {/* Stop click + keydown propagation so the backdrop's onClose doesn't fire from inside the dialog. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl outline-none dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Team Detail
            </div>
            <h2
              id={titleId}
              className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-slate-100"
            >
              {displayName(team.name)}
            </h2>
            <div className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">
              Current #{team.rank} · Projected #{team.projectedRank} · Top {cutoff} Gold Bracket
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onCompare}
              className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950"
            >
              Compare
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <DrawerMetric label="Record" value={recordText(team)} />
          <DrawerMetric label="Gold %" value={goldPctLabel} />
          <DrawerMetric label="Range" value={`#${range.best}–#${range.worst}`} />
          <DrawerMetric label="Bubble" value={bubble} />
          <DrawerMetric label="Runs/Game" value={team.rsg.toFixed(1)} />
          <DrawerMetric label="Hits/Game" value={team.hpg.toFixed(1)} />
          <DrawerMetric label="K/Game" value={team.kpg.toFixed(1)} />
          <DrawerMetric
            label="Current SOS"
            value={currentSosRank ? `#${currentSosRank}` : "—"}
          />
          <DrawerMetric label="Remaining SOS" value={sos.label} />
          {titleRace && <DrawerMetric label="Title Race" value={titleRace} />}
        </div>

        {goldTrend.length > 1 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
              Gold Odds Over Time
            </h3>
            <div className="mt-2">
              <LineChart
                series={[
                  {
                    id: team.id,
                    label: displayName(team.name),
                    values: goldTrend,
                    tone:
                      (team.goldPct ?? 0) >= 75
                        ? "emerald"
                        : (team.goldPct ?? 0) >= 40
                          ? "blue"
                          : "slate",
                  },
                ]}
                yLabel="%"
                height={180}
                showLegend={false}
              />
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
            Playoff Status
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {playoffStatus === "Clinched"
              ? `${displayName(team.name)} has mathematically secured a Gold Bracket spot.`
              : playoffStatus === "Eliminated"
                ? `${displayName(team.name)} is eliminated from Gold Bracket contention. Even winning out cannot clear the cut line.`
                : playoffStatus === "Firmly In"
                  ? `${displayName(team.name)} is not officially clinched, but the math and projection both strongly favor a Gold Bracket spot.`
                  : playoffStatus === "In"
                    ? `${displayName(team.name)} is currently positioned for the Gold Bracket but has not fully secured it.`
                    : playoffStatus === "Alive"
                      ? `${displayName(team.name)} is still realistically alive for the Gold Bracket based on remaining games and projected movement.`
                      : `${displayName(team.name)} still has a mathematical path, but there is real work to do and help may be needed.`}
          </p>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">
            Magic Numbers
          </h3>
          <ul className="mt-2 space-y-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <li>
              <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                M (Gold clinch)
              </span>
              <div className="text-sm font-bold leading-snug">{magicForGold.description}</div>
            </li>
            <li>
              <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                E (Gold elimination)
              </span>
              <div className="text-sm font-bold leading-snug">{eliminationNumber.description}</div>
            </li>
          </ul>
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">Summary</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {pathSummary}
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">Path</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {team.goldStatus === "Clinched"
              ? `${displayName(team.name)} has secured a Gold Bracket spot. The remaining games are about seeding and regular-season positioning.`
              : team.goldStatus === "Eliminated"
                ? `${displayName(team.name)} is eliminated from Gold Bracket contention and can only affect other teams' paths.`
                : playoffStatus === "Firmly In" || playoffStatus === "In"
                  ? `${displayName(team.name)} is inside the Gold cut line, but the remaining games still affect seeding and safety.`
                  : playoffStatus === "Alive"
                    ? `${displayName(team.name)} is close enough to push into the Gold Bracket with strong results and some help around the cut line.`
                    : `${displayName(team.name)} still has a path, but needs wins and help from teams above the cut line.`}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            Current SOS #{currentSosRank ?? "—"} measures opponents already played. Remaining SOS is{" "}
            {sos.label.toLowerCase()} based on opponents still left: {sos.opponents}.
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">Clinch Scenarios</h3>
          <div className="mt-3 space-y-2">
            {clinchScenarios.map((scenario) => (
              <div
                key={scenario}
                className="rounded-xl bg-white p-3 text-sm font-bold leading-6 text-slate-600 shadow-sm ring-1 ring-slate-200"
              >
                {scenario}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="font-black tracking-tight text-slate-950 dark:text-slate-100">Next Two</h3>
          <div className="mt-3 space-y-3">
            {swings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-5 text-sm font-bold text-slate-500 dark:text-slate-400">
                No remaining games for this team.
              </div>
            ) : (
              swings.map((swing) => (
                <div
                  key={swing.game.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-black text-slate-950 dark:text-slate-100">
                      {swing.teamIsAway ? "at" : "vs"} {swing.opponentName}
                    </div>
                    <div className="text-xs font-black text-slate-500 dark:text-slate-400">
                      {formatGameDate(swing.game.date)}
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                    Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win chance
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black">
                    <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Win: #{swing.winSeed}
                    </div>
                    <div className="rounded-xl bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      Loss: #{swing.lossSeed}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

// ---------- Main app ----------

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>("standings");
  const [teams, setTeams] = useState<TeamBase[]>(() => loadTeams());
  const [matchups, setMatchups] = useState<Matchup[]>(() => loadMatchups());
  const [logs, setLogs] = useState<Record<string, GameLog>>(() => loadLogs());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const [newDate, setNewDate] = useState("");
  const [newAway, setNewAway] = useState("");
  const [newHome, setNewHome] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [compareTeamId, setCompareTeamId] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [lastImpact, setLastImpact] = useState<
    { title: string; scores: string[]; messages: string[]; recapItems: RecapItem[] } | null
  >(null);
  const [scoreboardTeamFilter, setScoreboardTeamFilter] = useState("ALL");
  const [seasonBuilderText, setSeasonBuilderText] = useState("");

  const undoRef = useRef<UndoSnapshot | null>(null);
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const { theme, toggle: toggleTheme } = useDarkMode();
  const { snapshot: sharedSnapshot, clear: clearSharedSnapshot } = useUrlSnapshot();

  const goldCutoff = clamp(
    Math.round(settings.goldCutoff || DEFAULT_GOLD_CUTOFF),
    1,
    Math.max(1, teams.length || DEFAULT_GOLD_CUTOFF)
  );

  // ---------- Persisted state ----------

  useEffect(() => {
    if (!saveTeams(teams)) {
      showToast("Could not save teams (storage full).", { tone: "error" });
    }
  }, [teams, showToast]);

  useEffect(() => {
    if (!saveMatchups(matchups)) {
      showToast("Could not save schedule (storage full).", { tone: "error" });
    }
  }, [matchups, showToast]);

  useEffect(() => {
    if (!saveLogs(logs)) {
      showToast("Could not save scores (storage full).", { tone: "error" });
    }
  }, [logs, showToast]);

  useEffect(() => {
    if (!saveSettings(settings)) {
      showToast("Could not save settings (storage full).", { tone: "error" });
    }
  }, [settings, showToast]);

  useEffect(() => {
    if (!newAway && teams[0]) setNewAway(teams[0].id);
    if (!newHome && teams[1]) setNewHome(teams[1].id);
  }, [teams, newAway, newHome]);

  // ---------- Derived state ----------

  const liveTeams = useMemo(
    () => calculateTeams(teams, matchups, logs),
    [teams, matchups, logs]
  );
  const liveById = useMemo(() => {
    const map = new Map<string, Team>();
    liveTeams.forEach((team) => map.set(team.id, team));
    return map;
  }, [liveTeams]);
  const teamBaseById = useMemo(() => {
    const map = new Map<string, TeamBase>();
    teams.forEach((team) => map.set(team.id, team));
    return map;
  }, [teams]);

  const ranked = useMemo(
    () => rankTeams(liveTeams, { runDiffTiebreaker: settings.runDiffTiebreaker }),
    [liveTeams, settings.runDiffTiebreaker]
  );
  const remainingGames = useMemo(
    () => matchups.filter((game) => !isFinal(logs[game.id])),
    [matchups, logs]
  );
  const completedGames = useMemo(
    () =>
      matchups
        .filter((game) => isFinal(logs[game.id]))
        .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date)),
    [matchups, logs]
  );
  const remainingCounts = useMemo(
    () => getRemainingCounts(liveTeams, remainingGames),
    [liveTeams, remainingGames]
  );
  const projected = useMemo(
    () => projectStandings(liveTeams, remainingGames, settings),
    [liveTeams, remainingGames, settings]
  );
  const projectedById = useMemo(() => {
    const map = new Map<string, Team & { rank: number }>();
    projected.forEach((team) => map.set(team.id, team));
    return map;
  }, [projected]);

  // ---------- Worker-driven odds + trend ----------

  const oddsSeed = useMemo(
    () =>
      simulationSeed(
        matchups,
        logs,
        `odds-${goldCutoff}-${settings.modelAggression}-${settings.maxScoreCap}-${settings.winPoints}-${settings.tiePoints}-${settings.runDiffTiebreaker}`
      ),
    [matchups, logs, goldCutoff, settings]
  );

  const oddsInput = useMemo(
    () => ({
      teams: liveTeams,
      remaining: remainingGames,
      iterations: SIM_ITERATIONS,
      seedText: oddsSeed,
      cutoff: goldCutoff,
      settings,
    }),
    [liveTeams, remainingGames, oddsSeed, goldCutoff, settings]
  );
  const { odds } = useSimulationOdds(oddsInput);

  const trendInput = useMemo(() => {
    const teamIds = teams.map((t) => t.id);
    if (!teamIds.length) {
      return { teamIds: [], states: [], iterations: 70, cutoff: goldCutoff, settings };
    }
    const states = completedGames.slice(-TREND_STATES);
    // Build states from index=1 (drops the misleading empty-logs leading zero).
    const buildLogsUntil = (limitIndex: number) => {
      const allowed = new Set(states.slice(0, limitIndex).map((g) => g.id));
      const stateLogs: Record<string, GameLog> = {};
      matchups.forEach((game) => {
        const log = logs[game.id];
        if (allowed.has(game.id) && log) stateLogs[game.id] = log;
      });
      return stateLogs;
    };
    const built: { teams: Team[]; remaining: Matchup[]; seedText: string }[] = [];
    for (let index = 1; index <= states.length; index += 1) {
      const stateLogs = buildLogsUntil(index);
      const stateTeams = calculateTeams(teams, matchups, stateLogs);
      const stateRemaining = matchups.filter((g) => !isFinal(stateLogs[g.id]));
      const seedText = simulationSeed(
        matchups,
        stateLogs,
        `trend-${index}-${goldCutoff}-${settings.modelAggression}`
      );
      built.push({ teams: stateTeams, remaining: stateRemaining, seedText });
    }
    return { teamIds, states: built, iterations: 70, cutoff: goldCutoff, settings };
  }, [teams, matchups, logs, completedGames, goldCutoff, settings]);
  const trendMap = useSimulationTrend(trendInput);

  // ---------- Dashboard / scenario computations ----------

  const dashboardRows: TeamWithProjection[] = useMemo(() => {
    return ranked.map((team) => {
      const projectedTeam = projectedById.get(team.id);
      const status = getMathGoldStatus(team, ranked, remainingCounts, goldCutoff, settings);
      return {
        ...team,
        projectedRank: projectedTeam?.rank ?? team.rank ?? 99,
        projectedRecord: projectedTeam ? recordText(projectedTeam) : recordText(team),
        projectedRunDiff: projectedTeam?.runDiff ?? team.runDiff,
        goldPct: odds[team.id] ?? 0,
        goldTrend: trendMap[team.id] ?? [],
        ...status,
      };
    });
  }, [ranked, projectedById, odds, trendMap, remainingCounts, goldCutoff, settings]);

  const dashboardById = useMemo(() => {
    const map = new Map<string, TeamWithProjection>();
    dashboardRows.forEach((row) => map.set(row.id, row));
    return map;
  }, [dashboardRows]);

  const modelRows = useMemo(() => {
    return [...dashboardRows].sort((a, b) => {
      if (a.projectedRank !== b.projectedRank) return a.projectedRank - b.projectedRank;
      if (Math.abs(b.goldPct - a.goldPct) > 0.01) return b.goldPct - a.goldPct;
      return (a.rank ?? 99) - (b.rank ?? 99);
    });
  }, [dashboardRows]);

  const currentSosRanks = useMemo(() => {
    const ordered = [...dashboardRows].sort((a, b) => b.sos - a.sos);
    const map: Record<string, number> = {};
    ordered.forEach((team, index) => {
      map[team.id] = index + 1;
    });
    return map;
  }, [dashboardRows]);

  const projectedCutLineTeams = useMemo(() => {
    return modelRows.filter((team) => {
      const seed = team.projectedRank ?? 99;
      return seed >= goldCutoff - 2 && seed <= goldCutoff + 3;
    });
  }, [modelRows, goldCutoff]);

  // ---------- Scenario helpers ----------

  const seedForScenario = useCallback(
    (teamId: string, game: Matchup, winnerId: string) => {
      const scenario = applyResult(liveTeams, game, winnerId, liveTeams, settings);
      const scenarioGames = remainingGames.filter((item) => item.id !== game.id);
      const finalProjected = projectStandings(scenario, scenarioGames, settings);
      return finalProjected.find((team) => team.id === teamId)?.rank ?? 99;
    },
    [liveTeams, remainingGames, settings]
  );

  const seedRangeMap = useMemo(() => {
    const map = new Map<string, { best: number; worst: number; baseline: number }>();
    teams.forEach((team) => {
      const baseline =
        projectedById.get(team.id)?.rank ??
        ranked.find((item) => item.id === team.id)?.rank ??
        99;
      let best = baseline;
      let worst = baseline;
      remainingGames.forEach((game) => {
        const winSeed = seedForScenario(team.id, game, game.away);
        const lossSeed = seedForScenario(team.id, game, game.home);
        if (winSeed < best) best = winSeed;
        if (winSeed > worst) worst = winSeed;
        if (lossSeed < best) best = lossSeed;
        if (lossSeed > worst) worst = lossSeed;
      });
      map.set(team.id, { best, worst, baseline });
    });
    return map;
  }, [teams, projectedById, ranked, remainingGames, seedForScenario]);

  const seedRangeForTeam = useCallback(
    (teamId: string) =>
      seedRangeMap.get(teamId) ?? { best: 99, worst: 99, baseline: 99 },
    [seedRangeMap]
  );

  const nextTwoSwingGames = useCallback(
    (teamId: string): SwingGame[] => {
      return remainingGames
        .filter((game) => game.away === teamId || game.home === teamId)
        .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
        .slice(0, 2)
        .map((game) => {
          const teamIsAway = game.away === teamId;
          const opponentId = teamIsAway ? game.home : game.away;
          const opponentName = displayName(
            teamBaseById.get(opponentId)?.name || opponentId
          );
          const prediction = predictGame(game, liveTeams, settings, liveById);
          const winSeed = seedForScenario(teamId, game, teamId);
          const lossSeed = seedForScenario(teamId, game, opponentId);
          const teamWinPct = teamIsAway ? prediction.awayWinPct : 1 - prediction.awayWinPct;
          const modelPick = displayName(
            teamBaseById.get(prediction.winnerId)?.name || prediction.winnerId
          );
          return {
            game,
            opponentName,
            teamIsAway,
            winSeed,
            lossSeed,
            modelPick,
            winPct: teamWinPct,
          };
        });
    },
    [remainingGames, teamBaseById, liveTeams, settings, liveById, seedForScenario]
  );

  const controlLevelMap = useMemo(() => {
    const result = new Map<string, string>();
    if (!dashboardRows.length) return result;

    teams.forEach((team) => {
      const row = dashboardById.get(team.id);
      if (!row) return;
      if (row.goldStatus === "Clinched") {
        result.set(team.id, "Clinched");
        return;
      }
      if (row.goldStatus === "Eliminated") {
        result.set(team.id, "Eliminated");
        return;
      }

      let winOut = liveTeams.map((item) => ({ ...item }));
      remainingGames.forEach((game) => {
        const winner =
          game.away === team.id || game.home === team.id
            ? team.id
            : predictGame(game, liveTeams, settings, liveById).winnerId;
        winOut = applyResult(winOut, game, winner, liveTeams, settings);
      });

      const winOutSeed =
        rankTeams(winOut, { runDiffTiebreaker: settings.runDiffTiebreaker }).find(
          (item) => item.id === team.id
        )?.rank ?? 99;
      const swings = nextTwoSwingGames(team.id);
      const lossRisk = swings.some((swing) => swing.lossSeed > goldCutoff);

      if (winOutSeed <= goldCutoff && (row.rank ?? 99) > goldCutoff) {
        result.set(team.id, "Controls Path");
      } else if (winOutSeed > goldCutoff) {
        result.set(team.id, "Needs Help");
      } else if ((row.rank ?? 99) <= goldCutoff && lossRisk) {
        result.set(team.id, "At Risk");
      } else {
        result.set(team.id, "Controls Spot");
      }
    });
    return result;
  }, [
    teams,
    dashboardRows,
    dashboardById,
    liveTeams,
    remainingGames,
    settings,
    liveById,
    goldCutoff,
    nextTwoSwingGames,
  ]);

  const controlLevelForTeam = useCallback(
    (team: TeamWithProjection) => controlLevelMap.get(team.id) ?? "Controls Spot",
    [controlLevelMap]
  );

  const bubbleTierForTeam = useCallback(
    (team: TeamWithProjection) => {
      if (team.goldStatus === "Clinched") return "Locked In";
      if (team.goldStatus === "Eliminated") return "Eliminated";
      const currentSeed = team.rank ?? 99;
      const projectedSeed = team.projectedRank ?? 99;
      if (
        currentSeed <= goldCutoff - 2 &&
        projectedSeed <= goldCutoff &&
        team.goldPct >= 80
      ) {
        return "Likely In";
      }
      if (currentSeed <= goldCutoff || projectedSeed <= goldCutoff) return "Bubble In";
      const cutoffRow =
        dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)] ?? team;
      if (
        team.goldPct >= 20 ||
        projectedSeed <= goldCutoff + 2 ||
        team.maxPoints >= standingsPoints(cutoffRow, settings)
      ) {
        return "Bubble Out";
      }
      return "Long Shot";
    },
    [goldCutoff, dashboardRows, settings]
  );

  const scheduleDifficultyForTeam = useCallback(
    (teamId: string) => {
      const games = remainingGames.filter(
        (game) => game.away === teamId || game.home === teamId
      );
      if (!games.length) {
        return { label: "Complete", avgSeed: 0, opponents: "No games left" };
      }
      const oppSeeds = games.map((game) => {
        const opponentId = game.away === teamId ? game.home : game.away;
        const opponent = dashboardById.get(opponentId);
        return {
          seed: opponent?.rank ?? 99,
          name: displayName(opponent?.name || opponentId),
        };
      });
      const avgSeed = oppSeeds.reduce((sum, item) => sum + item.seed, 0) / Math.max(oppSeeds.length, 1);
      const label =
        avgSeed <= Math.max(2, goldCutoff - 2)
          ? "Hard"
          : avgSeed <= goldCutoff + 2
            ? "Medium"
            : "Easy";
      return {
        label,
        avgSeed,
        opponents: oppSeeds.map((item) => `#${item.seed} ${item.name}`).join(", "),
      };
    },
    [remainingGames, dashboardById, goldCutoff]
  );

  const gameImportance = useCallback(
    (game: Matchup) => {
      const away = dashboardById.get(game.away);
      const home = dashboardById.get(game.home);
      if (!away || !home) return 0;
      const seedScore = (team: TeamWithProjection) =>
        Math.max(0, 8 - Math.abs((team.rank ?? 99) - goldCutoff));
      const oddsScore = (team: TeamWithProjection) =>
        Math.max(0, 50 - Math.abs(team.goldPct - 50)) / 10;
      const projectedScore = (team: TeamWithProjection) =>
        Math.max(0, 5 - Math.abs((team.projectedRank ?? 99) - goldCutoff));
      return (
        seedScore(away) +
        seedScore(home) +
        oddsScore(away) +
        oddsScore(home) +
        projectedScore(away) +
        projectedScore(home)
      );
    },
    [dashboardById, goldCutoff]
  );

  const biggestBubbleGame = useMemo(() => {
    const game = [...remainingGames].sort(
      (a, b) => gameImportance(b) - gameImportance(a)
    )[0];
    if (!game) return null;
    const awayName = displayName(teamBaseById.get(game.away)?.name || game.away);
    const homeName = displayName(teamBaseById.get(game.home)?.name || game.home);
    return `${awayName} vs ${homeName}`;
  }, [remainingGames, gameImportance, teamBaseById]);

  const todayPicture = useMemo(() => {
    const clinched = dashboardRows
      .filter((team) => team.goldStatus === "Clinched")
      .map((team) => displayName(team.name));
    const eliminated = dashboardRows
      .filter((team) => team.goldStatus === "Eliminated")
      .map((team) => displayName(team.name));
    return {
      clinched: clinched.length ? clinched.join(", ") : "None",
      eliminated: eliminated.length ? eliminated.join(", ") : "None",
      biggestGame: biggestBubbleGame || "None",
    };
  }, [dashboardRows, biggestBubbleGame]);

  const getGameScenarioImpactMap = useMemo(() => {
    const map = new Map<
      string,
      {
        awaySeedWin: number;
        awaySeedLoss: number;
        homeSeedWin: number;
        homeSeedLoss: number;
        seedImpact: number;
        impactLabel: "High" | "Medium" | "Low";
        awayGoldSwing: number;
        homeGoldSwing: number;
        awayName: string;
        homeName: string;
      }
    >();
    remainingGames.forEach((game) => {
      const prediction = predictGame(game, liveTeams, settings, liveById);
      const away = dashboardById.get(game.away);
      const home = dashboardById.get(game.home);
      const awaySeedWin = seedForScenario(game.away, game, game.away);
      const awaySeedLoss = seedForScenario(game.away, game, game.home);
      const homeSeedWin = seedForScenario(game.home, game, game.home);
      const homeSeedLoss = seedForScenario(game.home, game, game.away);
      const seedImpact = Math.max(
        Math.abs(awaySeedWin - awaySeedLoss),
        Math.abs(homeSeedWin - homeSeedLoss)
      );
      const impactLabel: "High" | "Medium" | "Low" =
        seedImpact >= 3 ? "High" : seedImpact >= 1 ? "Medium" : "Low";
      const awayGoldSwing = clamp(
        (awaySeedLoss - awaySeedWin) * 8 + (prediction.winnerId === game.away ? 4 : -4),
        -25,
        25
      );
      const homeGoldSwing = clamp(
        (homeSeedLoss - homeSeedWin) * 8 + (prediction.winnerId === game.home ? 4 : -4),
        -25,
        25
      );
      map.set(game.id, {
        awaySeedWin,
        awaySeedLoss,
        homeSeedWin,
        homeSeedLoss,
        seedImpact,
        impactLabel,
        awayGoldSwing,
        homeGoldSwing,
        awayName: displayName(away?.name || game.away),
        homeName: displayName(home?.name || game.home),
      });
    });
    return map;
  }, [remainingGames, liveTeams, settings, liveById, dashboardById, seedForScenario]);

  const nextGameByTeam = useMemo(() => {
    const map = new Map<string, Matchup>();
    [...remainingGames]
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .forEach((game) => {
        if (!map.has(game.away)) map.set(game.away, game);
        if (!map.has(game.home)) map.set(game.home, game);
      });
    return map;
  }, [remainingGames]);

  const isTeamNextGame = (teamId: string, game: Matchup) =>
    nextGameByTeam.get(teamId)?.id === game.id;

  const goldStatusAfterScenario = (teamId: string, game: Matchup, winnerId: string) => {
    const scenarioTeams = rankTeams(
      applyResult(liveTeams, game, winnerId, liveTeams, settings),
      { runDiffTiebreaker: settings.runDiffTiebreaker }
    );
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);
    const scenarioTeam = scenarioTeams.find((team) => team.id === teamId);
    if (!scenarioTeam) return null;
    return getMathGoldStatus(
      scenarioTeam,
      scenarioTeams,
      scenarioCounts,
      goldCutoff,
      settings
    ).goldStatus;
  };

  const teamClinchesGoldWithWin = (teamId: string, game: Matchup) => {
    const team = dashboardById.get(teamId);
    if (!team || team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;
    return goldStatusAfterScenario(teamId, game, teamId) === "Clinched";
  };

  const teamCanBeEliminatedWithLoss = (teamId: string, game: Matchup) => {
    const team = dashboardById.get(teamId);
    if (!team || team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;
    const opponentId = game.away === teamId ? game.home : game.away;
    return goldStatusAfterScenario(teamId, game, opponentId) === "Eliminated";
  };

  const teamClinchesRegularSeasonTitleWithWin = (teamId: string, game: Matchup) => {
    const team = dashboardById.get(teamId);
    if (!team || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;

    const scenarioTeams = rankTeams(
      applyResult(liveTeams, game, teamId, liveTeams, settings),
      { runDiffTiebreaker: settings.runDiffTiebreaker }
    );
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);
    const scenarioTeam = scenarioTeams.find((item) => item.id === teamId);
    if (!scenarioTeam) return false;

    const titlePoints = standingsPoints(scenarioTeam, settings);
    return scenarioTeams.every((other) => {
      if (other.id === teamId) return true;
      const otherMax =
        standingsPoints(other, settings) + (scenarioCounts[other.id] ?? 0) * settings.winPoints;
      return otherMax < titlePoints;
    });
  };

  const gameStatusForGame = (game: Matchup) => {
    const impact = getGameScenarioImpactMap.get(game.id);
    const away = dashboardById.get(game.away);
    const home = dashboardById.get(game.home);
    const teamsInGame = [away, home].filter(Boolean) as TeamWithProjection[];

    if (teamsInGame.some((team) => teamClinchesRegularSeasonTitleWithWin(team.id, game)))
      return "Title Clinch";
    if (teamsInGame.some((team) => teamClinchesGoldWithWin(team.id, game)))
      return "Gold Bracket Clinch";
    if (teamsInGame.some((team) => teamCanBeEliminatedWithLoss(team.id, game)))
      return "Elimination Scenario";

    const nearCutLine = teamsInGame.some(
      (team) => Math.abs((team.rank ?? 99) - goldCutoff) <= 1
    );
    if (impact && impact.seedImpact >= 2) return "High Impact";
    if (nearCutLine || (impact && impact.seedImpact >= 1)) return "Bubble Game";
    return "Low Impact";
  };

  const gameStatusClasses = (label: string) => {
    if (label === "Title Clinch") return "bg-purple-100 text-purple-700";
    if (label === "Gold Bracket Clinch") return "bg-emerald-100 text-emerald-700";
    if (label === "Elimination Scenario") return "bg-red-100 text-red-700";
    if (label === "High Impact") return "bg-amber-100 text-amber-700";
    if (label === "Bubble Game") return "bg-blue-100 text-blue-700";
    return "bg-slate-200 text-slate-600";
  };

  const gamesThatMatterMost = useMemo(() => {
    return [...remainingGames]
      .sort((a, b) => gameImportance(b) - gameImportance(a))
      .slice(0, 5)
      .map((game, index) => {
        const away = dashboardById.get(game.away);
        const home = dashboardById.get(game.home);
        const impact = getGameScenarioImpactMap.get(game.id);
        const status = gameStatusForGame(game);
        const reason =
          status === "Low Impact"
            ? `${impact?.impactLabel ?? "Low"} projected seed impact`
            : status;
        return {
          game,
          rank: index + 1,
          label: `${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`,
          reason,
          date: formatGameDate(game.date),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingGames, dashboardById, getGameScenarioImpactMap, goldCutoff]);

  const bubbleRows = useMemo(() => {
    return dashboardRows.map((team) => ({
      team,
      tier: bubbleTierForTeam(team),
      sos: scheduleDifficultyForTeam(team.id),
      control: controlLevelForTeam(team),
    }));
  }, [dashboardRows, bubbleTierForTeam, scheduleDifficultyForTeam, controlLevelForTeam]);

  const bubbleMovementRows = useMemo(() => {
    const byId = new Map(bubbleRows.map((row) => [row.team.id, row]));
    const selected = new Map<string, (typeof bubbleRows)[number]>();
    const add = (row: (typeof bubbleRows)[number] | undefined) => {
      if (row) selected.set(row.team.id, row);
    };

    dashboardRows
      .filter((team) => {
        const seed = team.rank ?? 99;
        return seed >= goldCutoff - 1 && seed <= goldCutoff;
      })
      .forEach((team) => add(byId.get(team.id)));

    dashboardRows
      .filter((team) => {
        const seed = team.rank ?? 99;
        return seed >= goldCutoff + 1 && seed <= goldCutoff + 3;
      })
      .forEach((team) => add(byId.get(team.id)));

    dashboardRows
      .filter((team) => {
        const currentInside = (team.rank ?? 99) <= goldCutoff;
        const projectedInside = (team.projectedRank ?? 99) <= goldCutoff;
        return currentInside !== projectedInside;
      })
      .forEach((team) => add(byId.get(team.id)));

    return [...selected.values()].sort((a, b) => {
      const aCross =
        ((a.team.rank ?? 99) <= goldCutoff) !== ((a.team.projectedRank ?? 99) <= goldCutoff);
      const bCross =
        ((b.team.rank ?? 99) <= goldCutoff) !== ((b.team.projectedRank ?? 99) <= goldCutoff);
      if (aCross !== bCross) return aCross ? -1 : 1;
      return (
        Math.abs((a.team.rank ?? 99) - goldCutoff) - Math.abs((b.team.rank ?? 99) - goldCutoff)
      );
    });
  }, [bubbleRows, dashboardRows, goldCutoff]);

  const cutLineTeams = useMemo(() => {
    return dashboardRows.filter((team) => {
      const seed = team.rank ?? 99;
      return seed >= goldCutoff - 2 && seed <= goldCutoff + 3;
    });
  }, [dashboardRows, goldCutoff]);

  const clinchScenariosForTeam = useCallback(
    (teamId: string) => {
      const team = dashboardById.get(teamId);
      if (!team) return [];
      const teamName = displayName(team.name);

      if (team.goldStatus === "Clinched") return [`${teamName} has already clinched a Gold Bracket spot.`];
      if (team.goldStatus === "Eliminated")
        return [`${teamName} is eliminated from Gold Bracket contention.`];

      const scenarios = nextTwoSwingGames(teamId).slice(0, 2).map((swing) => {
        const opponentLine = `${swing.teamIsAway ? "at" : "vs"} ${swing.opponentName}`;
        if (swing.winSeed <= goldCutoff && swing.lossSeed > goldCutoff) {
          return `${opponentLine}: win projects inside the Gold cut line at #${swing.winSeed}; loss drops outside the Gold cut line at #${swing.lossSeed}.`;
        }
        if (swing.winSeed <= goldCutoff && swing.lossSeed <= goldCutoff) {
          return `${opponentLine}: win improves or protects the Gold Bracket path at #${swing.winSeed}; loss still projects #${swing.lossSeed}.`;
        }
        if (swing.winSeed > goldCutoff && swing.lossSeed > goldCutoff) {
          return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}, so outside help is still needed.`;
        }
        return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}.`;
      });

      if (!scenarios.length) {
        return [`${teamName} has no remaining games; Gold Bracket status depends only on outside results.`];
      }
      return scenarios;
    },
    [dashboardById, nextTwoSwingGames, goldCutoff]
  );

  const formatGoldPct = (team: TeamWithProjection) => {
    if (team.goldStatus !== "Eliminated" && team.goldPct > 0 && team.goldPct < 1) return "<1%";
    return `${Math.round(team.goldPct)}%`;
  };

  const statusLabel = (team: TeamWithProjection) => {
    if (team.goldStatus === "Clinched") return "Clinched";
    if (team.goldStatus === "Eliminated") return "Eliminated";

    const currentSeed = team.rank ?? 99;
    const projectedSeed = team.projectedRank ?? 99;
    const cutoffRow = dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)];
    const cutoffPoints = cutoffRow ? standingsPoints(cutoffRow, settings) : 0;
    const canStillReachCutLine = team.maxPoints >= cutoffPoints;

    if (currentSeed <= goldCutoff) {
      const currentPoints = standingsPoints(team, settings);
      const outsideThreats = dashboardRows.filter(
        (other) =>
          other.id !== team.id &&
          (other.rank ?? 99) > goldCutoff &&
          other.maxPoints >= currentPoints
      ).length;
      const cushionSlots = Math.max(0, goldCutoff - currentSeed);
      const exposedToChasers = outsideThreats > cushionSlots;

      if (
        currentSeed <= goldCutoff - 2 &&
        projectedSeed <= goldCutoff &&
        team.goldPct >= 90 &&
        !exposedToChasers
      ) {
        return "Firmly In";
      }
      return "In";
    }

    const seedDistance = currentSeed - goldCutoff;
    const projectedNearCut = projectedSeed <= goldCutoff + 1;

    if (projectedSeed <= goldCutoff && team.goldPct >= 15) return "Alive";
    if (team.goldPct >= 25 && seedDistance <= 3) return "Alive";
    if (projectedNearCut && team.goldPct >= 12) return "Alive";
    if (canStillReachCutLine) return "Work To Do";
    return "Work To Do";
  };

  const statusClass = (team: TeamWithProjection) => {
    const label = statusLabel(team);
    if (label === "Clinched") return "bg-slate-950 text-white";
    if (label === "Firmly In") return "bg-emerald-100 text-emerald-700";
    if (label === "In") return "bg-blue-100 text-blue-700";
    if (label === "Alive") return "bg-amber-100 text-amber-700";
    if (label === "Work To Do") return "bg-orange-100 text-orange-700";
    return "bg-red-100 text-red-700";
  };

  const titleRaceBadgeForTeam = (team: TeamWithProjection) => {
    const leader = dashboardRows[0];
    if (!leader || leader.id === team.id) return team.rank === 1 ? "Title Leader" : "";
    const teamBack =
      (leader.w - team.w + (team.l - leader.l) + (leader.t - team.t) * 0.5) / 2;
    const teamMax =
      standingsPoints(team, settings) +
      (remainingCounts[team.id] ?? 0) * settings.winPoints;
    const leaderCurrent = standingsPoints(leader, settings);
    if (teamMax < leaderCurrent) return "Title Eliminated";
    if (teamBack <= 2 && (team.rank ?? 99) <= 5) return "Title Contender";
    return "";
  };

  const teamPathNote = (team: TeamWithProjection) => {
    const range = seedRangeForTeam(team.id);
    const sos = scheduleDifficultyForTeam(team.id);
    const name = displayName(team.name);
    if (team.goldStatus === "Clinched") return `${name} has clinched Gold and is playing for seeding.`;
    if (team.goldStatus === "Eliminated")
      return `${name} cannot reach Gold and can only affect other teams' paths.`;
    if ((team.rank ?? 99) <= goldCutoff && range.worst <= goldCutoff)
      return `${name} controls the spot; even a rough path still projects inside Gold.`;
    if ((team.rank ?? 99) <= goldCutoff)
      return `${name} is in now but can fall out if the next results break badly.`;
    if (range.best <= goldCutoff && team.goldPct >= 10)
      return `${name} can move into Gold with wins and help near the cut line.`;
    return `${name} needs wins plus multiple teams above the line${sos.label === "Hard" ? " and a tough remaining schedule" : ""} to stumble.`;
  };

  const latestCompletedDate = completedGames.length
    ? formatGameDate(completedGames[completedGames.length - 1]?.date ?? "")
    : "No finals yet";

  // ---------- Game forecasts ----------

  const gameForecasts = useMemo(() => {
    return [...remainingGames]
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .map((game) => {
        const prediction = predictGame(game, liveTeams, settings, liveById);
        const winner = teamBaseById.get(prediction.winnerId);
        const away = teamBaseById.get(game.away);
        const home = teamBaseById.get(game.home);
        const winnerPct =
          prediction.winnerId === game.away
            ? prediction.awayWinPct
            : 1 - prediction.awayWinPct;
        const impact = getGameScenarioImpactMap.get(game.id);
        return {
          game,
          prediction,
          awayName: displayName(away?.name || game.away),
          homeName: displayName(home?.name || game.home),
          winnerName: displayName(winner?.name || prediction.winnerId),
          winnerPct,
          impact,
          explanation: impact
            ? `${describePrediction(game, prediction, liveById)} Seed impact is ${impact.impactLabel.toLowerCase()}: ${impact.awayName} ranges from #${impact.awaySeedWin} with a win to #${impact.awaySeedLoss} with a loss, while ${impact.homeName} ranges from #${impact.homeSeedWin} to #${impact.homeSeedLoss}. Estimated Gold swing: ${impact.awayName} ${impact.awayGoldSwing >= 0 ? "+" : ""}${Math.round(impact.awayGoldSwing)}%, ${impact.homeName} ${impact.homeGoldSwing >= 0 ? "+" : ""}${Math.round(impact.homeGoldSwing)}%.`
            : describePrediction(game, prediction, liveById),
        };
      });
  }, [
    remainingGames,
    liveTeams,
    settings,
    liveById,
    teamBaseById,
    getGameScenarioImpactMap,
  ]);

  const scoreboardGames = useMemo(() => {
    const dateCompare = (a: Matchup, b: Matchup) => {
      const aFinal = isFinal(logs[a.id]);
      const bFinal = isFinal(logs[b.id]);
      const aNoDate = !(a.date ?? "").trim();
      const bNoDate = !(b.date ?? "").trim();
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      if (!aFinal && aNoDate !== bNoDate) return aNoDate ? -1 : 1;
      return parseDateValue(a.date) - parseDateValue(b.date) || a.id.localeCompare(b.id);
    };
    const filtered =
      scoreboardTeamFilter === "ALL"
        ? matchups
        : matchups.filter(
            (game) => game.away === scoreboardTeamFilter || game.home === scoreboardTeamFilter
          );
    return [...filtered].sort(dateCompare);
  }, [matchups, logs, scoreboardTeamFilter]);

  const scoreboardPredictions = useMemo(() => {
    const map = new Map<
      string,
      { spread: string; pickName: string; pickPct: number; status: string }
    >();
    remainingGames.forEach((game) => {
      const prediction = predictGame(game, liveTeams, settings, liveById);
      const winner = teamBaseById.get(prediction.winnerId);
      const winnerPct =
        prediction.winnerId === game.away
          ? prediction.awayWinPct
          : 1 - prediction.awayWinPct;
      map.set(game.id, {
        spread: projectedRunLine(prediction, liveById),
        pickName: displayName(winner?.name || prediction.winnerId),
        pickPct: winnerPct,
        status: gameStatusForGame(game),
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingGames, liveTeams, settings, liveById, teamBaseById, getGameScenarioImpactMap, dashboardById, goldCutoff, nextGameByTeam]);

  // ---------- Snapshots / undo ----------

  const buildRankSnapshot = (nextLogs: Record<string, GameLog>): RankSnapshotEntry[] => {
    const nextLive = calculateTeams(teams, matchups, nextLogs);
    const nextRanked = rankTeams(nextLive, { runDiffTiebreaker: settings.runDiffTiebreaker });
    const nextRemaining = matchups.filter((game) => !isFinal(nextLogs[game.id]));
    const nextRemainingCounts = getRemainingCounts(nextLive, nextRemaining);
    const nextProjected = projectStandings(nextLive, nextRemaining, settings);

    return nextRanked.map((team) => {
      const projectedTeam = nextProjected.find((item) => item.id === team.id);
      const status = getMathGoldStatus(
        team,
        nextRanked,
        nextRemainingCounts,
        goldCutoff,
        settings
      );
      return {
        ...team,
        projectedRank: projectedTeam?.rank ?? team.rank ?? 99,
        goldPct: 0, // snapshot-only, odds shown live from worker
        ...status,
      };
    });
  };

  const captureUndo = (label: string) => {
    const snapshot: UndoSnapshot = {
      teams,
      matchups,
      logs,
      label,
      timestamp: Date.now(),
    };
    undoRef.current = snapshot;
    saveUndoSnapshot(snapshot);
  };

  const restoreUndo = () => {
    const snapshot = undoRef.current ?? (readUndoSnapshot() as UndoSnapshot | null);
    if (!snapshot) return;
    setTeams(snapshot.teams);
    setMatchups(snapshot.matchups);
    setLogs(snapshot.logs);
    setSelectedTeamId(null);
    undoRef.current = null;
    showToast(`Restored: ${snapshot.label}.`, { tone: "success" });
  };

  // ---------- Mutations ----------

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== "string") throw new Error("File is not text");
        const text = stripBom(raw);
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length < 2) throw new Error("CSV has no rows");

        const headers = parseCSVLine(lines[0] ?? "").map(normalizeHeader);
        const index = (name: string) => headers.indexOf(normalizeHeader(name));

        const gameIdIndex = index("Game ID");
        const dateIndex = index("Date");
        const awayTeamIndex = index("Away Team");
        const inningsIndex = index("Innings");
        const awayRunsIndex = index("Away Runs");
        const awayHitsIndex = index("Away Hits");
        const awayKIndex = index("Away K");
        const homeTeamIndex = index("Home Team");
        const homeRunsIndex = index("Home Runs");
        const homeHitsIndex = index("Home Hits");
        const homeKIndex = index("Home K");

        if (gameIdIndex < 0 || dateIndex < 0 || awayTeamIndex < 0 || homeTeamIndex < 0) {
          throw new Error("Missing required columns");
        }

        const rows = lines.slice(1).map(parseCSVLine);
        const names = new Set<string>();
        rows.forEach((row) => {
          if (row[awayTeamIndex]?.trim()) names.add(row[awayTeamIndex].trim());
          if (row[homeTeamIndex]?.trim()) names.add(row[homeTeamIndex].trim());
        });

        const existingIds = new Set<string>();
        const nameToId = new Map<string, string>();
        const importedTeams = Array.from(names)
          .sort((a, b) => displayName(a).localeCompare(displayName(b)))
          .map((name) => {
            const id = createTeamId(displayName(name), existingIds);
            nameToId.set(name, id);
            return { id, name };
          });

        const importedMatchups: Matchup[] = [];
        const importedLogs: Record<string, GameLog> = {};
        const importSuffix = Math.random().toString(36).slice(2, 8);

        rows.forEach((row, rowIndex) => {
          const awayName = row[awayTeamIndex]?.trim();
          const homeName = row[homeTeamIndex]?.trim();
          if (!awayName || !homeName) return;

          const away = nameToId.get(awayName);
          const home = nameToId.get(homeName);
          if (!away || !home) return;

          const id =
            row[gameIdIndex]?.trim() ||
            `game_${Date.now()}_${importSuffix}_${rowIndex}`;
          const awayRuns = awayRunsIndex >= 0 ? row[awayRunsIndex]?.trim() ?? "" : "";
          const homeRuns = homeRunsIndex >= 0 ? row[homeRunsIndex]?.trim() ?? "" : "";
          const awayK = awayKIndex >= 0 ? row[awayKIndex]?.trim() ?? "" : "";
          const homeK = homeKIndex >= 0 ? row[homeKIndex]?.trim() ?? "" : "";

          importedMatchups.push({
            id,
            date: normalizeDateInput(row[dateIndex]?.trim() || ""),
            away,
            home,
          });

          importedLogs[id] = {
            innings: inningsIndex >= 0 ? row[inningsIndex]?.trim() || "6" : "6",
            awayRuns,
            awayHits: awayHitsIndex >= 0 ? row[awayHitsIndex]?.trim() ?? "" : "",
            awayK,
            homeRuns,
            homeHits: homeHitsIndex >= 0 ? row[homeHitsIndex]?.trim() ?? "" : "",
            homeK,
            isFinal:
              awayRuns !== "" && homeRuns !== "" && awayK !== "" && homeK !== "",
          };
        });

        // Drop orphan logs not tied to a matchup.
        const matchupIds = new Set(importedMatchups.map((m) => m.id));
        Object.keys(importedLogs).forEach((id) => {
          if (!matchupIds.has(id)) delete importedLogs[id];
        });

        const finalGames = Object.values(importedLogs).filter(isFinal).length;
        const openGames = importedMatchups.length - finalGames;
        const confirmed = window.confirm(
          `Import this schedule?\n\n${importedTeams.length} teams found\n${importedMatchups.length} games found\n${finalGames} finals imported\n${openGames} open games imported\n\nThis will replace the current season data (an undo snapshot will be saved).`
        );
        if (!confirmed) return;

        captureUndo("CSV import");
        setTeams(importedTeams);
        setMatchups(importedMatchups);
        setLogs(importedLogs);
        setSelectedTeamId(null);
        setActiveView("standings");
        showToast(`Imported ${importedMatchups.length} games.`, {
          tone: "undo",
          actionLabel: "Undo",
          onAction: restoreUndo,
        });
      } catch (error) {
        console.error(error);
        showToast(
          "Could not import this CSV. Use the schedule CSV with Game ID, Date, Away Team, and Home Team columns.",
          { tone: "error" }
        );
      }
    };
    reader.readAsText(file);
  };

  const exportCSV = () => {
    const headers = [
      "Game ID",
      "Date",
      "Away Team",
      "Innings",
      "Away Runs",
      "Away Hits",
      "Away K",
      "Away BIP",
      "Home Team",
      "Home Runs",
      "Home Hits",
      "Home K",
      "Home BIP",
    ];
    const rows = matchups.map((game) => {
      const log = logs[game.id] || blankLog();
      const away = teamBaseById.get(game.away)?.name || game.away;
      const home = teamBaseById.get(game.home)?.name || game.home;
      const awayBip = calcBip(log.awayHits, log.awayRuns, log.awayK, log.innings);
      const homeBip = calcBip(log.homeHits, log.homeRuns, log.homeK, log.innings);
      return [
        game.id,
        formatGameDate(game.date),
        away,
        log.innings,
        log.awayRuns,
        log.awayHits,
        log.awayK,
        awayBip,
        home,
        log.homeRuns,
        log.homeHits,
        log.homeK,
        homeBip,
      ]
        .map(csvEscape)
        .join(",");
    });
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Schedule_Data.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportBackup = () => {
    const blob = new Blob(
      [JSON.stringify({ teams, matchups, logs, settings }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Backup.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const resetSeason = () => {
    if (
      !window.confirm(
        "Reset this season? This clears teams, games, and scores from this browser (an undo snapshot will be saved)."
      )
    )
      return;
    captureUndo("Reset season");
    setTeams([]);
    setMatchups([]);
    setLogs({});
    setLastImpact(null);
    setSelectedTeamId(null);
    setActiveView("standings");
    showToast("Season reset.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const summarizeChanges = (
    before: RankSnapshotEntry[],
    after: RankSnapshotEntry[]
  ) => {
    const messages: string[] = [];
    after.forEach((team) => {
      const old = before.find((item) => item.id === team.id);
      if (!old) return;
      const oldRank = old.rank ?? 99;
      const newRank = team.rank ?? 99;
      const teamName = displayName(team.name);
      if (oldRank !== newRank) {
        const direction = newRank < oldRank ? "moved up" : "dropped";
        messages.push(`${teamName} ${direction} from #${oldRank} to #${newRank}`);
      }
      if (oldRank <= goldCutoff && newRank > goldCutoff) {
        messages.push(`${teamName} dropped below the Gold cut line`);
      }
      if (oldRank > goldCutoff && newRank <= goldCutoff) {
        messages.push(`${teamName} moved above the Gold cut line into Gold position`);
      }
      if (old.goldStatus !== team.goldStatus) {
        if (team.goldStatus === "Eliminated")
          messages.push(`${teamName} is now eliminated from Gold Bracket contention`);
        else if (team.goldStatus === "Clinched")
          messages.push(`${teamName} clinched the Gold Bracket`);
      }
    });
    return Array.from(new Set(messages)).slice(0, 10);
  };

  const toggleFinal = (gameId: string) => {
    setLogs((prev) => {
      const current = prev[gameId] || blankLog();
      const isMarkingFinal = !current.isFinal;
      const game = matchups.find((item) => item.id === gameId);
      const nextLogs = { ...prev, [gameId]: { ...current, isFinal: !current.isFinal } };

      if (isMarkingFinal && game) {
        const beforeLogs = { ...nextLogs, [gameId]: { ...current, isFinal: false } };
        const before = buildRankSnapshot(beforeLogs);
        const after = buildRankSnapshot(nextLogs);
        const messages = summarizeChanges(before, after);
        const finalLog = nextLogs[gameId] || blankLog();
        const away = teamBaseById.get(game.away);
        const home = teamBaseById.get(game.home);
        const dateLabel = normalizeDateInput(game.date);
        const awayScore = parseNumber(finalLog.awayRuns);
        const homeScore = parseNumber(finalLog.homeRuns);
        const recapItems = weeklyRecap({
          before,
          after: after.map((entry) => ({
            id: entry.id,
            rank: entry.rank,
            goldPct: entry.goldPct,
            goldStatus: entry.goldStatus,
            name: entry.name,
          })),
          finalsSinceLast: [
            {
              game,
              awayScore,
              homeScore,
              awayName: displayName(away?.name || game.away),
              homeName: displayName(home?.name || game.home),
            },
          ],
          cutoff: goldCutoff,
        });
        setLastImpact({
          title: dateLabel ? `Latest Update — ${dateLabel}` : "Latest Update — No Date",
          scores: [
            `${away ? displayName(away.name) : game.away} ${finalLog.awayRuns || "0"}, ${home ? displayName(home.name) : game.home} ${finalLog.homeRuns || "0"}`,
          ],
          messages: messages.length
            ? messages
            : ["This update was recorded; no standings-impact detail to summarize."],
          recapItems,
        });
      } else {
        setLastImpact(null);
      }
      return nextLogs;
    });
  };

  const updateLog = useCallback(
    (gameId: string, field: keyof GameLog, value: string | boolean) => {
      setLogs((prev) => ({
        ...prev,
        [gameId]: { ...(prev[gameId] || blankLog()), [field]: value },
      }));
    },
    []
  );

  const addGameValid = !!newAway && !!newHome && newAway !== newHome;

  const addGame = () => {
    if (!addGameValid) {
      showToast("Pick two different teams to add a game.", { tone: "error" });
      return;
    }
    const id = `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setMatchups((prev) => [
      ...prev,
      { id, date: normalizeDateInput(newDate), away: newAway, home: newHome },
    ]);
    setLogs((prev) => ({ ...prev, [id]: blankLog() }));
    setNewDate("");
  };

  const removeGame = (gameId: string) => {
    if (!window.confirm("Delete this game?")) return;
    const game = matchups.find((m) => m.id === gameId);
    captureUndo(
      game
        ? `Deleted ${displayName(teamBaseById.get(game.away)?.name || game.away)} vs ${displayName(teamBaseById.get(game.home)?.name || game.home)}`
        : "Deleted game"
    );
    setMatchups((prev) => prev.filter((g) => g.id !== gameId));
    setLogs((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
    showToast("Game deleted.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const swapGame = (gameId: string) => {
    setMatchups((prev) =>
      prev.map((game) =>
        game.id === gameId ? { ...game, away: game.home, home: game.away } : game
      )
    );
    setLogs((prev) => {
      const log = prev[gameId];
      if (!log) return prev;
      return {
        ...prev,
        [gameId]: {
          ...log,
          awayRuns: log.homeRuns,
          awayHits: log.homeHits,
          awayK: log.homeK,
          homeRuns: log.awayRuns,
          homeHits: log.awayHits,
          homeK: log.awayK,
        },
      };
    });
  };

  // ---------- Season builder ----------

  const readBuilderTeamNames = (): string[] => {
    const cleaned = seasonBuilderText
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean);
    return Array.from(new Set(cleaned));
  };

  const buildRoundRobinSeason = () => {
    const names = readBuilderTeamNames();
    if (names.length < 2) {
      showToast("Enter at least two teams to build a schedule.", { tone: "error" });
      return null;
    }
    const existingIds = new Set<string>();
    const builtTeams = names.map((name) => ({
      id: createTeamId(displayName(name), existingIds),
      name,
    }));
    const builtMatchups: Matchup[] = [];
    const builtLogs: Record<string, GameLog> = {};
    for (let awayIndex = 0; awayIndex < builtTeams.length; awayIndex += 1) {
      for (let homeIndex = awayIndex + 1; homeIndex < builtTeams.length; homeIndex += 1) {
        const away = builtTeams[awayIndex];
        const home = builtTeams[homeIndex];
        if (!away || !home) continue;
        const gameNumber = builtMatchups.length + 1;
        const id = `game_${String(gameNumber).padStart(3, "0")}_${away.id}_${home.id}`;
        builtMatchups.push({ id, date: "", away: away.id, home: home.id });
        builtLogs[id] = blankLog();
      }
    }
    return { builtTeams, builtMatchups, builtLogs };
  };

  const createSeasonFromTeamList = () => {
    const built = buildRoundRobinSeason();
    if (!built) return;
    const confirmed = window.confirm(
      `Create a new blank schedule?\n\n${built.builtTeams.length} teams\n${built.builtMatchups.length} games\n\nEach team will play every other team once. This will replace the current season data (an undo snapshot will be saved).`
    );
    if (!confirmed) return;
    captureUndo("Create blank season");
    setTeams(built.builtTeams);
    setMatchups(built.builtMatchups);
    setLogs(built.builtLogs);
    setLastImpact(null);
    setSelectedTeamId(null);
    setScoreboardTeamFilter("ALL");
    setActiveView("games");
    showToast(`Created ${built.builtMatchups.length}-game schedule.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: restoreUndo,
    });
  };

  const downloadRoundRobinCSV = () => {
    const built = buildRoundRobinSeason();
    if (!built) return;
    const headers = [
      "Game ID",
      "Date",
      "Away Team",
      "Innings",
      "Away Runs",
      "Away Hits",
      "Away K",
      "Away BIP",
      "Home Team",
      "Home Runs",
      "Home Hits",
      "Home K",
      "Home BIP",
    ];
    const rows = built.builtMatchups.map((game) => {
      const away = built.builtTeams.find((team) => team.id === game.away)?.name || game.away;
      const home = built.builtTeams.find((team) => team.id === game.home)?.name || game.home;
      return [game.id, "", away, "6", "", "", "", "N/A", home, "", "", "", "N/A"]
        .map(csvEscape)
        .join(",");
    });
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Blank_Round_Robin.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Header / selection ----------

  const tabRefs = useRef<Record<ActiveView, HTMLButtonElement | null>>({
    standings: null,
    games: null,
    model: null,
    settings: null,
  });

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const idx = VIEW_ORDER.indexOf(activeView);
    const nextIdx =
      event.key === "ArrowRight"
        ? (idx + 1) % VIEW_ORDER.length
        : (idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
    const nextView = VIEW_ORDER[nextIdx];
    if (!nextView) return;
    setActiveView(nextView);
    tabRefs.current[nextView]?.focus();
  };

  const selectedTeam = selectedTeamId ? dashboardById.get(selectedTeamId) ?? null : null;
  const compareTeam = compareTeamId ? dashboardById.get(compareTeamId) ?? null : null;

  const finalCount = completedGames.length;
  const totalGamesCount = matchups.length;
  const currentLeader = dashboardRows[0];
  const aggressionMultiplier = MODEL_AGGRESSION[settings.modelAggression];

  // ---------- Share + URL snapshot ----------

  const sharedHandledRef = useRef(false);
  useEffect(() => {
    if (!sharedSnapshot || sharedHandledRef.current) return;
    sharedHandledRef.current = true;
    const ok = window.confirm(
      `A shared NKB season is in the URL (${sharedSnapshot.teams.length} teams, ${sharedSnapshot.matchups.length} games).\n\nReplace your current local data with the shared snapshot?\n\nClick Cancel to keep your data; the URL will be cleared either way.`
    );
    if (ok) {
      captureUndo("Load shared snapshot");
      setTeams(sharedSnapshot.teams);
      setMatchups(sharedSnapshot.matchups);
      setLogs(sharedSnapshot.logs);
      setSettings(sharedSnapshot.settings);
      showToast("Loaded shared snapshot.", {
        tone: "undo",
        actionLabel: "Undo",
        onAction: restoreUndo,
      });
    }
    clearSharedSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedSnapshot]);

  const shareSeason = async () => {
    const snapshot = { v: 1 as const, teams, matchups, logs, settings };
    const url = buildShareUrl(window.location.href, snapshot);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Share URL copied to clipboard.", { tone: "success" });
    } catch {
      window.prompt("Copy this share URL:", url);
    }
  };

  // ---------- Command palette + shortcuts ----------

  const commands: Command[] = useMemo(() => {
    const teamCmds: Command[] = dashboardRows.map((team) => ({
      id: `team-${team.id}`,
      label: `View ${displayName(team.name)}`,
      group: "Team",
      hint: `#${team.rank} · ${recordText(team)}`,
      run: () => setSelectedTeamId(team.id),
    }));
    const viewCmds: Command[] = VIEW_ORDER.map((view) => ({
      id: `view-${view}`,
      label: `Go to ${VIEW_LABELS[view]}`,
      group: "View",
      run: () => setActiveView(view),
    }));
    const actionCmds: Command[] = [
      {
        id: "action-share",
        label: "Share this season (copy URL)",
        group: "Action",
        run: shareSeason,
      },
      {
        id: "action-export",
        label: "Export schedule CSV",
        group: "Action",
        run: () => exportCSV(),
      },
      {
        id: "action-backup",
        label: "Download backup JSON",
        group: "Action",
        run: () => exportBackup(),
      },
      {
        id: "action-toggle-theme",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        group: "Action",
        run: toggleTheme,
      },
      {
        id: "action-shortcuts",
        label: "Show keyboard shortcuts",
        group: "Help",
        run: () => setShowShortcuts(true),
      },
      {
        id: "action-tour",
        label: "Show app tour",
        group: "Help",
        run: () => setShowTour(true),
      },
    ];
    return [...viewCmds, ...teamCmds, ...actionCmds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardRows, theme]);

  const shortcuts: Shortcut[] = useMemo(
    () => [
      {
        combo: "mod+k",
        description: "Open command palette",
        group: "General",
        handler: () => setShowCommandPalette(true),
      },
      {
        combo: "shift+/",
        description: "Show shortcuts",
        group: "General",
        handler: () => setShowShortcuts(true),
      },
      {
        combo: "g s",
        description: "Go to Standings",
        group: "Navigate",
        handler: () => setActiveView("standings"),
      },
      {
        combo: "g g",
        description: "Go to Games",
        group: "Navigate",
        handler: () => setActiveView("games"),
      },
      {
        combo: "g m",
        description: "Go to Projection",
        group: "Navigate",
        handler: () => setActiveView("model"),
      },
      {
        combo: "g t",
        description: "Go to Settings",
        group: "Navigate",
        handler: () => setActiveView("settings"),
      },
      {
        combo: "d",
        description: "Toggle dark mode",
        group: "Action",
        handler: toggleTheme,
      },
    ],
    [toggleTheme]
  );
  useShortcuts(shortcuts);

  const shortcutEntries = shortcuts.map((s) => ({
    combo: s.combo,
    description: s.description,
    group: s.group,
  }));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-slate-100">
                NKB Season Tracker
              </h1>
              <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {settings.seasonLabel}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCommandPalette(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                aria-label="Open command palette"
              >
                <span>⌘K</span>
                <span className="hidden sm:inline">Quick actions</span>
              </button>
              {teams.length > 0 && (
                <button
                  type="button"
                  onClick={shareSeason}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  aria-label="Copy share URL for this season"
                >
                  Share
                </button>
              )}
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white p-2 text-xs font-black text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? "☀" : "☾"}
              </button>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Main views"
            className="-mx-2 flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1 sm:mx-0 sm:gap-2 sm:overflow-visible sm:w-fit dark:bg-slate-800"
          >
            {VIEW_ORDER.map((view) => (
              <button
                key={view}
                ref={(el) => {
                  tabRefs.current[view] = el;
                }}
                role="tab"
                id={`tab-${view}`}
                aria-selected={activeView === view}
                aria-controls={`panel-${view}`}
                tabIndex={activeView === view ? 0 : -1}
                onClick={() => setActiveView(view)}
                onKeyDown={onTabKeyDown}
                className={tab(activeView === view)}
              >
                {VIEW_LABELS[view]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main
        className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        id={`panel-${activeView}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeView}`}
      >
        {teams.length === 0 ? (
          <EmptyState
            importCSV={importCSV}
            createSeasonFromTeamList={createSeasonFromTeamList}
            downloadRoundRobinCSV={downloadRoundRobinCSV}
            seasonBuilderText={seasonBuilderText}
            setSeasonBuilderText={setSeasonBuilderText}
            teams={teams}
          />
        ) : activeView === "standings" ? (
          <StandingsView
            currentLeader={currentLeader}
            finalCount={finalCount}
            totalGames={totalGamesCount}
            goldCutoff={goldCutoff}
            latestCompletedDate={latestCompletedDate}
            todayPicture={todayPicture}
            lastImpact={lastImpact}
            dismissImpact={() => setLastImpact(null)}
            copyRecap={async () => {
              if (!lastImpact) return;
              const md = recapToMarkdown(settings.seasonLabel, lastImpact.recapItems);
              try {
                await navigator.clipboard.writeText(md);
                showToast("Recap copied.", { tone: "success" });
              } catch {
                window.prompt("Copy this recap:", md);
              }
            }}
            dashboardRows={dashboardRows}
            currentSosRanks={currentSosRanks}
            statusClass={statusClass}
            statusLabel={statusLabel}
            formatGoldPct={formatGoldPct}
            onSelectTeam={(id) => setSelectedTeamId(id)}
            cutLineTeams={cutLineTeams}
          />
        ) : activeView === "model" ? (
          <ModelView
            goldCutoff={goldCutoff}
            modelRows={modelRows}
            seedRangeForTeam={seedRangeForTeam}
            gamesThatMatterMost={gamesThatMatterMost}
            bubbleMovementRows={bubbleMovementRows}
            scheduleDifficultyForTeam={scheduleDifficultyForTeam}
            teamPathNote={teamPathNote}
            formatGoldPct={formatGoldPct}
            projectedCutLineTeams={projectedCutLineTeams}
            nextTwoSwingGames={nextTwoSwingGames}
            gameForecasts={gameForecasts}
            byId={liveById}
            gameStatusClasses={gameStatusClasses}
            teams={teams}
            matchups={matchups}
            logs={logs}
            settings={settings}
            cutoff={goldCutoff}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            goldCutoff={goldCutoff}
            teamsCount={teams.length}
            aggressionMultiplier={aggressionMultiplier}
            importCSV={importCSV}
            exportCSV={exportCSV}
            exportBackup={exportBackup}
            resetSeason={resetSeason}
          />
        ) : (
          <GamesView
            teams={teams}
            matchups={matchups}
            logs={logs}
            scoreboardGames={scoreboardGames}
            scoreboardPredictions={scoreboardPredictions}
            scoreboardTeamFilter={scoreboardTeamFilter}
            setScoreboardTeamFilter={setScoreboardTeamFilter}
            newDate={newDate}
            setNewDate={setNewDate}
            newAway={newAway}
            setNewAway={setNewAway}
            newHome={newHome}
            setNewHome={setNewHome}
            addGameValid={addGameValid}
            addGame={addGame}
            toggleFinal={toggleFinal}
            swapGame={swapGame}
            removeGame={removeGame}
            updateLog={updateLog}
            setMatchups={setMatchups}
            gameStatusClasses={gameStatusClasses}
          />
        )}
      </main>

      {selectedTeam && (
        <TeamDrawer
          team={selectedTeam}
          range={seedRangeForTeam(selectedTeam.id)}
          bubble={bubbleTierForTeam(selectedTeam)}
          currentSosRank={currentSosRanks[selectedTeam.id] ?? null}
          sos={scheduleDifficultyForTeam(selectedTeam.id)}
          swings={nextTwoSwingGames(selectedTeam.id)}
          clinchScenarios={clinchScenariosForTeam(selectedTeam.id)}
          titleRace={titleRaceBadgeForTeam(selectedTeam)}
          playoffStatus={statusLabel(selectedTeam)}
          goldPctLabel={formatGoldPct(selectedTeam)}
          cutoff={goldCutoff}
          magicForGold={magicForGold(
            selectedTeam.id,
            dashboardRows,
            remainingGames,
            goldCutoff,
            settings
          )}
          eliminationNumber={eliminationNumberForGold(
            selectedTeam.id,
            dashboardRows,
            remainingGames,
            goldCutoff,
            settings
          )}
          pathSummary={pathSummary(
            { ...selectedTeam, rank: selectedTeam.rank ?? 99 },
            goldCutoff,
            nextTwoSwingGames(selectedTeam.id).map((swing) => ({
              opponentName: swing.opponentName,
              teamIsAway: swing.teamIsAway,
              winSeed: swing.winSeed,
              lossSeed: swing.lossSeed,
            })),
            {
              totalTeams: dashboardRows.length,
              leaderName: currentLeader ? displayName(currentLeader.name) : "",
            }
          )}
          goldTrend={selectedTeam.goldTrend}
          onClose={() => {
            setSelectedTeamId(null);
            setCompareTeamId(null);
          }}
          onCompare={() => {
            const candidate = dashboardRows.find((team) => team.id !== selectedTeam.id);
            setCompareTeamId(candidate ? candidate.id : null);
          }}
        />
      )}

      {selectedTeam && compareTeam && (
        <CompareDrawer
          left={selectedTeam}
          right={compareTeam}
          allTeams={dashboardRows}
          matchups={matchups}
          logs={logs}
          onClose={() => setCompareTeamId(null)}
          onPickRight={(id) => setCompareTeamId(id)}
        />
      )}

      <CommandPalette
        open={showCommandPalette}
        commands={commands}
        onClose={() => setShowCommandPalette(false)}
      />
      <ShortcutsHelp
        open={showShortcuts}
        shortcuts={shortcutEntries}
        onClose={() => setShowShortcuts(false)}
      />
      <OnboardingTour
        open={showTour}
        onClose={() => setShowTour(false)}
        autoOpenWhenEmpty={teams.length === 0}
      />

      <ToastView toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

// ---------- View partials ----------

function EmptyState({
  importCSV,
  createSeasonFromTeamList,
  downloadRoundRobinCSV,
  seasonBuilderText,
  setSeasonBuilderText,
  teams,
}: {
  importCSV: (file: File) => void;
  createSeasonFromTeamList: () => void;
  downloadRoundRobinCSV: () => void;
  seasonBuilderText: string;
  setSeasonBuilderText: (v: string) => void;
  teams: TeamBase[];
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-black tracking-tight">Start a Season</h2>
        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Import an existing schedule CSV, or enter team names and build a blank round-robin
          schedule.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <label className={`inline-flex cursor-pointer ${buttonClasses.primary}`}>
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-label="Import schedule CSV"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importCSV(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button onClick={createSeasonFromTeamList} className={buttonClasses.dark}>
            Create Blank Schedule
          </button>
          <button onClick={downloadRoundRobinCSV} className={buttonClasses.ghost}>
            Download Blank CSV
          </button>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            New Season Builder
          </h3>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            Enter teams and create a blank schedule where every team plays every other team
            once.
          </p>
          <label className="sr-only" htmlFor="season-builder-textarea">
            Team list
          </label>
          <textarea
            id="season-builder-textarea"
            value={seasonBuilderText}
            onChange={(event) => setSeasonBuilderText(event.target.value)}
            placeholder={
              teams.length
                ? teams.map((team) => displayName(team.name)).join("\n")
                : "Stallions\nGriddy\nTrash Pandas"
            }
            className="mt-4 h-44 w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={createSeasonFromTeamList}
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800"
            >
              Create Schedule
            </button>
            <button
              onClick={downloadRoundRobinCSV}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Download Blank CSV
            </button>
            <button
              onClick={() =>
                setSeasonBuilderText(
                  teams.map((team) => displayName(team.name)).join("\n")
                )
              }
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Use Current Teams
            </button>
          </div>
        </div>
      </div>
      <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">Team List</h3>
        <label className="sr-only" htmlFor="team-list-textarea">
          Team list
        </label>
        <textarea
          id="team-list-textarea"
          value={seasonBuilderText}
          onChange={(event) => setSeasonBuilderText(event.target.value)}
          placeholder={"Stallions\nGriddy\nTrash Pandas\nChaos"}
          className="mt-4 h-64 w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
        />
        <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
          One team per line. The generated CSV leaves dates blank so you can add them later.
        </p>
      </aside>
    </div>
  );
}

function StandingsView({
  currentLeader,
  finalCount,
  totalGames,
  goldCutoff,
  latestCompletedDate,
  todayPicture,
  lastImpact,
  dismissImpact,
  copyRecap,
  dashboardRows,
  currentSosRanks,
  statusClass,
  statusLabel,
  formatGoldPct,
  onSelectTeam,
  cutLineTeams,
}: {
  currentLeader: TeamWithProjection | undefined;
  finalCount: number;
  totalGames: number;
  goldCutoff: number;
  latestCompletedDate: string;
  todayPicture: { clinched: string; eliminated: string; biggestGame: string };
  lastImpact: {
    title: string;
    scores: string[];
    messages: string[];
    recapItems: RecapItem[];
  } | null;
  dismissImpact: () => void;
  copyRecap: () => void;
  dashboardRows: TeamWithProjection[];
  currentSosRanks: Record<string, number>;
  statusClass: (t: TeamWithProjection) => string;
  statusLabel: (t: TeamWithProjection) => string;
  formatGoldPct: (t: TeamWithProjection) => string;
  onSelectTeam: (id: string) => void;
  cutLineTeams: TeamWithProjection[];
}) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-slate-950 text-white md:grid-cols-4 dark:divide-slate-700 dark:border-slate-700">
          <Metric label="Leader" value={currentLeader ? displayName(currentLeader.name) : "—"} />
          <Metric label="Finals" value={`${finalCount}/${totalGames}`} />
          <Metric label="Cut Line" value={`Top ${goldCutoff}`} />
          <Metric label="Updated Through" value={latestCompletedDate} />
        </div>

        <div className="border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <InsightTile label="Gold Clinched" value={todayPicture.clinched} tone="slate" />
            <InsightTile label="Eliminated" value={todayPicture.eliminated} tone="red" />
            <InsightTile label="Biggest Bubble Game" value={todayPicture.biggestGame} tone="amber" />
          </div>
        </div>

        {lastImpact && (
          <div className="border-b border-slate-200 bg-blue-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wide text-blue-700 dark:text-blue-400">
                  Impact Since Last Update
                </div>
                <div className="text-sm font-black text-slate-950 dark:text-slate-100">{lastImpact.title}</div>
              </div>
              <div className="flex gap-2">
                {lastImpact.recapItems.length > 0 && (
                  <button
                    type="button"
                    onClick={copyRecap}
                    className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950"
                  >
                    Copy Recap
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismissImpact}
                  className="rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500 shadow-sm ring-1 ring-blue-100 hover:text-slate-950 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
            {lastImpact.scores.length > 0 && (
              <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Final Scores
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-black text-slate-800 dark:text-slate-200">
                  {lastImpact.scores.map((score) => (
                    <span key={score} className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800 dark:text-slate-200">
                      {score}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {lastImpact.recapItems.length > 0 ? (
              <ul className="space-y-1.5 text-xs font-black text-blue-800 dark:text-blue-300">
                {lastImpact.recapItems.map((item) => (
                  <li key={item.text} className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
                    {item.text}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap gap-2 text-xs font-black text-blue-700 dark:text-blue-300">
                {lastImpact.messages.map((change) => (
                  <span
                    key={change}
                    className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700"
                  >
                    {change}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {dashboardRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No final results yet. Mark a game Final in the Games tab to populate standings.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Seed</th>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Record</th>
                    <th className="px-4 py-3 text-center">Diff</th>
                    <th className="px-4 py-3 text-center">SOS</th>
                    <th className="px-4 py-3 text-center">Gold %</th>
                    <th className="px-4 py-3 text-center">Playoff Status</th>
                    <th className="px-4 py-3 text-center">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dashboardRows.map((team, index) => {
                    const select = () => onSelectTeam(team.id);
                    const rowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select();
                      }
                    };
                    return (
                      <React.Fragment key={team.id}>
                        {index === goldCutoff && (
                          <tr
                            key="cut-line"
                            // eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role
                            role="separator"
                            aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                          >
                            <td
                              colSpan={8}
                              className="bg-slate-950 px-5 py-2 text-center text-xs font-black uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                            >
                              Gold Cut Line
                            </td>
                          </tr>
                        )}
                        <tr
                          onClick={select}
                          onKeyDown={rowKeyDown}
                          role="button"
                          tabIndex={0}
                          aria-label={`View ${displayName(team.name)} detail`}
                          className="cursor-pointer text-slate-800 hover:bg-slate-50/70 focus:bg-slate-100 focus:outline-none dark:text-slate-100 dark:hover:bg-slate-800/70 dark:focus:bg-slate-800"
                        >
                          <td className="px-5 py-4 font-black text-slate-500 dark:text-slate-400">#{team.rank}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900">
                                {teamAbbr(team.name)}
                              </div>
                              <div>
                                <div
                                  className="font-black tracking-tight text-slate-950 dark:text-slate-100"
                                  title={team.name}
                                >
                                  {displayName(team.name)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center font-black text-slate-800 dark:text-slate-100">
                            {recordText(team)}
                          </td>
                          <td
                            className={`px-4 py-4 text-center font-black ${
                              team.runDiff > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : team.runDiff < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {team.runDiff > 0 ? "+" : ""}
                            {team.runDiff}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={`Current SOS: ${team.sos.toFixed(2)}. Rank is based on opponents already played.`}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              #{currentSosRanks[team.id] || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              className={
                                team.goldPct >= 75
                                  ? pill("emerald")
                                  : team.goldPct >= 40
                                    ? pill("blue")
                                    : pill("neutral")
                              }
                            >
                              {formatGoldPct(team)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={
                                team.goldStatus === "Eliminated"
                                  ? `${displayName(team.name)} can max out at ${team.maxPoints} standings points, but ${team.blockersAhead} team${team.blockersAhead === 1 ? "" : "s"} already sit above that number.`
                                  : team.goldStatus === "Clinched"
                                    ? `${displayName(team.name)} has mathematically secured a Top ${goldCutoff} spot even if they lose out.`
                                    : `${displayName(team.name)} is still mathematically live for the Top ${goldCutoff}.`
                              }
                              aria-label={`Playoff status: ${statusLabel(team)}`}
                              className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(team)}`}
                            >
                              {statusLabel(team)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <Sparkline values={team.goldTrend} />
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {dashboardRows.map((team, index) => {
                const select = () => onSelectTeam(team.id);
                const isLastInside = index + 1 === goldCutoff;
                return (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={select}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                      aria-label={`View ${displayName(team.name)} detail`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="w-7 text-right text-xs font-black text-slate-500 dark:text-slate-400">
                          #{team.rank}
                        </span>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-[10px] font-black text-white dark:bg-slate-100 dark:text-slate-900">
                          {teamAbbr(team.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-slate-950 dark:text-slate-100">
                            {displayName(team.name)}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            {recordText(team)} ·{" "}
                            <span
                              className={
                                team.runDiff > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : team.runDiff < 0
                                    ? "text-red-600 dark:text-red-400"
                                    : ""
                              }
                            >
                              {team.runDiff > 0 ? "+" : ""}
                              {team.runDiff}
                            </span>{" "}
                            · SOS #{currentSosRanks[team.id] || "—"}
                          </span>
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={
                            team.goldPct >= 75
                              ? pill("emerald")
                              : team.goldPct >= 40
                                ? pill("blue")
                                : pill("neutral")
                          }
                        >
                          {formatGoldPct(team)}
                        </span>
                        <span
                          aria-label={`Playoff status: ${statusLabel(team)}`}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusClass(team)}`}
                        >
                          {statusLabel(team)}
                        </span>
                      </div>
                    </button>
                    {isLastInside && (
                      <div
                        role="separator"
                        aria-label={`Gold cut line: top ${goldCutoff} teams qualify`}
                        className="bg-slate-950 px-4 py-1.5 text-center text-[10px] font-black uppercase tracking-[0.22em] text-red-400 dark:bg-black"
                      >
                        Gold Cut Line
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {cutLineTeams.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight">Cut Line</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Top {goldCutoff}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {cutLineTeams.map((team) => {
              const inside = (team.rank ?? 99) <= goldCutoff;
              const onLine = Math.abs((team.rank ?? 99) - goldCutoff) <= 1;
              return (
                <div
                  key={team.id}
                  className={`rounded-2xl border p-4 ${
                    inside ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-black">{displayName(team.name)}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                        #{team.rank} · {recordText(team)} · {Math.round(team.goldPct)}% Gold
                      </div>
                    </div>
                    <span
                      className={
                        inside ? pill("emerald") : onLine ? pill("amber") : pill("neutral")
                      }
                    >
                      {inside ? "In" : onLine ? "Bubble" : "Chasing"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function ModelView(props: {
  goldCutoff: number;
  modelRows: TeamWithProjection[];
  seedRangeForTeam: (id: string) => { best: number; worst: number; baseline: number };
  gamesThatMatterMost: { game: Matchup; rank: number; label: string; reason: string; date: string }[];
  bubbleMovementRows: { team: TeamWithProjection; tier: string; sos: { label: string; opponents: string }; control: string }[];
  scheduleDifficultyForTeam: (id: string) => { label: string; opponents: string };
  teamPathNote: (t: TeamWithProjection) => string;
  formatGoldPct: (t: TeamWithProjection) => string;
  projectedCutLineTeams: TeamWithProjection[];
  nextTwoSwingGames: (id: string) => SwingGame[];
  gameForecasts: {
    game: Matchup;
    prediction: Prediction;
    awayName: string;
    homeName: string;
    winnerName: string;
    winnerPct: number;
    impact: ReturnType<Map<string, { impactLabel: "High" | "Medium" | "Low" }>["get"]>;
    explanation: string;
  }[];
  byId: Map<string, Team>;
  gameStatusClasses: (s: string) => string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
  cutoff: number;
}) {
  const {
    goldCutoff,
    modelRows,
    seedRangeForTeam,
    gamesThatMatterMost,
    bubbleMovementRows,
    scheduleDifficultyForTeam: _sd,
    teamPathNote,
    formatGoldPct,
    projectedCutLineTeams,
    nextTwoSwingGames,
    gameForecasts,
    byId,
    gameStatusClasses,
    teams: _teams,
    matchups: _matchups,
    logs: _logs,
    settings: _settings,
    cutoff: _cutoff,
  } = props;

  return (
    <section className="space-y-6">
      <div className={`${card} p-6`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">Projection</h2>
          <div className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
            Gold Cutoff: Top {goldCutoff}
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">Forecast Board</h3>
        </div>
        {modelRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">No teams yet.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Team</th>
                    <th className="px-4 py-3 text-center">Now</th>
                    <th className="px-4 py-3 text-center">Projected</th>
                    <th className="px-4 py-3 text-center">Range</th>
                    <th className="px-4 py-3 text-center">Projected Record</th>
                    <th className="px-4 py-3 text-center">Gold Odds</th>
                    <th className="px-4 py-3 text-center">Run Diff</th>
                    <th className="px-5 py-3 text-right">TPI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {modelRows.map((team) => {
                    const movement = (team.rank ?? 99) - team.projectedRank;
                    const range = seedRangeForTeam(team.id);
                    return (
                      <tr key={`forecast-${team.id}`} className="text-slate-800 hover:bg-slate-50/70 dark:text-slate-100 dark:hover:bg-slate-800/70">
                        <td className="px-5 py-4 font-black">{displayName(team.name)}</td>
                        <td className="px-4 py-4 text-center font-black">#{team.rank}</td>
                        <td className="px-4 py-4 text-center font-black">
                          #{team.projectedRank}
                          <span
                            className={`ml-2 rounded-full px-2 py-1 text-[10px] font-black ${
                              movement > 0
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : movement < 0
                                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {movement > 0
                              ? `+${movement}`
                              : movement < 0
                                ? `-${Math.abs(movement)}`
                                : "0"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center font-black">
                          #{range.best}–#{range.worst}
                        </td>
                        <td className="px-4 py-4 text-center font-black">{team.projectedRecord}</td>
                        <td className="px-4 py-4 text-center font-black">{formatGoldPct(team)}</td>
                        <td
                          className={`px-4 py-4 text-center font-black ${
                            team.projectedRunDiff > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : team.projectedRunDiff < 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-slate-500 dark:text-slate-400"
                          }`}
                        >
                          {team.projectedRunDiff > 0 ? "+" : ""}
                          {team.projectedRunDiff}
                        </td>
                        <td className="px-5 py-4 text-right font-black">
                          {team.tpi > 0 ? "+" : ""}
                          {team.tpi.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {modelRows.map((team) => {
                const movement = (team.rank ?? 99) - team.projectedRank;
                const range = seedRangeForTeam(team.id);
                return (
                  <li
                    key={`forecast-mobile-${team.id}`}
                    className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3"
                  >
                    <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                      #{team.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-slate-950 dark:text-slate-100">
                        {displayName(team.name)}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        Proj #{team.projectedRank}{" "}
                        <span
                          className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                            movement > 0
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : movement < 0
                                ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          {movement > 0
                            ? `+${movement}`
                            : movement < 0
                              ? `-${Math.abs(movement)}`
                              : "0"}
                        </span>{" "}
                        · #{range.best}–#{range.worst} · {team.projectedRecord}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        TPI {team.tpi > 0 ? "+" : ""}
                        {team.tpi.toFixed(2)} · Diff{" "}
                        <span
                          className={
                            team.projectedRunDiff > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : team.projectedRunDiff < 0
                                ? "text-red-600 dark:text-red-400"
                                : ""
                          }
                        >
                          {team.projectedRunDiff > 0 ? "+" : ""}
                          {team.projectedRunDiff}
                        </span>
                      </div>
                    </div>
                    <span className="text-right text-sm font-black text-slate-950 dark:text-slate-100">
                      {formatGoldPct(team)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className={`${card} p-5 dark:border-slate-700 dark:bg-slate-900`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            Games That Matter Most
          </h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Next up
          </span>
        </div>
        {gamesThatMatterMost.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-6 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
            No remaining games.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {gamesThatMatterMost.map((item) => (
              <div
                key={`matter-${item.game.id}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      #{item.rank} · {item.date}
                    </div>
                    <div className="mt-1 font-black text-slate-950 dark:text-slate-100">{item.label}</div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${gameStatusClasses(item.reason)}`}
                  >
                    {item.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {bubbleMovementRows.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">Bubble Watch</h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Around Top {goldCutoff}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {bubbleMovementRows.map(({ team, tier, sos }) => {
              const range = seedRangeForTeam(team.id);
              const bubbleNote =
                team.projectedRank <= goldCutoff && (team.rank ?? 99) > goldCutoff
                  ? `${displayName(team.name)} is projected to move into the Gold Bracket.`
                  : (team.rank ?? 99) <= goldCutoff && team.projectedRank > goldCutoff
                    ? `${displayName(team.name)} currently holds a Gold spot but projects to fall below the cut line.`
                    : (team.rank ?? 99) === goldCutoff
                      ? `${displayName(team.name)} currently owns the final Gold Bracket spot.`
                      : (team.rank ?? 99) === goldCutoff + 1
                        ? `${displayName(team.name)} is the first team outside the Gold Bracket.`
                        : `${displayName(team.name)} is close enough to the cut line to matter.`;
              return (
                <div
                  key={`bubble-${team.id}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950 dark:text-slate-100">{displayName(team.name)}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                        Now #{team.rank} · Projected #{team.projectedRank} · Range #{range.best}–#{range.worst}
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200">
                      {tier}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black">
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-slate-500 dark:text-slate-400">Gold</div>
                      <div className="mt-1 text-slate-950 dark:text-slate-100">{formatGoldPct(team)}</div>
                    </div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-slate-500 dark:text-slate-400">SOS</div>
                      <div className="mt-1 text-slate-950 dark:text-slate-100">{sos.label}</div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    {bubbleNote} {teamPathNote(team)} Remaining opponents: {sos.opponents}.
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {projectedCutLineTeams.length > 0 && (
        <section className={`${card} p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
              Projected Cut Line Games
            </h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Next Two
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {projectedCutLineTeams.slice(0, 6).map((team) => {
              const swings = nextTwoSwingGames(team.id);
              if (!swings.length) return null;
              return (
                <div
                  key={`model-swing-${team.id}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="font-black text-slate-950 dark:text-slate-100">{displayName(team.name)}</div>
                    <div className="text-xs font-black text-slate-500 dark:text-slate-400">
                      #{team.rank} now · #{team.projectedRank} projected
                    </div>
                  </div>
                  <div className="space-y-2">
                    {swings.map((swing) => (
                      <div
                        key={swing.game.id}
                        className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-black text-slate-950 dark:text-slate-100">
                            {swing.teamIsAway ? "at" : "vs"} {swing.opponentName}
                          </span>
                          <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                            {formatGameDate(swing.game.date)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                          Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win
                          chance
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
                          <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Win: #{swing.winSeed}
                          </div>
                          <div className="rounded-lg bg-red-50 px-2 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            Loss: #{swing.lossSeed}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={`${card} p-5`}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">Game Forecasts</h3>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {gameForecasts.length} Remaining
          </span>
        </div>
        {gameForecasts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/40 p-8 text-center font-bold text-slate-500">
            No remaining games to project.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {gameForecasts.map((item) => {
              const margin = Math.abs(item.prediction.awayScore - item.prediction.homeScore);
              const runLine = projectedRunLine(item.prediction, byId);
              const upsetRisk = upsetRiskLabel(item.winnerPct, margin);
              return (
                <article
                  key={`game-forecast-${item.game.id}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {formatGameDate(item.game.date)}
                      </div>
                      <div className="mt-1 text-base font-black tracking-tight text-slate-950 dark:text-slate-100">
                        {item.awayName} at {item.homeName}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Pick
                      </div>
                      <div className="text-sm font-black text-slate-950 dark:text-slate-100">{item.winnerName}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-black">
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Spread
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">{runLine}</div>
                    </div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Chance
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">
                        {Math.round(item.winnerPct * 100)}%
                      </div>
                    </div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Upset Risk
                      </div>
                      <div className="mt-1 text-base text-slate-950 dark:text-slate-100">{upsetRisk}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className={
                        item.prediction.confidence === "High"
                          ? pill("emerald")
                          : item.prediction.confidence === "Medium"
                            ? pill("blue")
                            : pill("neutral")
                      }
                    >
                      {item.prediction.confidence} Confidence
                    </span>
                    {margin <= 2 && <span className={pill("amber")}>Toss-Up</span>}
                    <span
                      className={
                        item.impact?.impactLabel === "High"
                          ? pill("red")
                          : item.impact?.impactLabel === "Medium"
                            ? pill("blue")
                            : pill("neutral")
                      }
                    >
                      Seed Impact: {item.impact?.impactLabel ?? "—"}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    {item.explanation}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function SettingsView({
  settings,
  setSettings,
  goldCutoff,
  teamsCount,
  aggressionMultiplier,
  importCSV,
  exportCSV,
  exportBackup,
  resetSeason,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  goldCutoff: number;
  teamsCount: number;
  aggressionMultiplier: number;
  importCSV: (file: File) => void;
  exportCSV: () => void;
  exportBackup: () => void;
  resetSeason: () => void;
}) {
  const seasonId = useId();
  const cutoffId = useId();
  const winId = useId();
  const tieId = useId();
  const capId = useId();
  const aggrId = useId();

  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className={`${card} p-6`}>
        <h2 className="text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100">Settings</h2>
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <label htmlFor={seasonId} className="block">
            <span className="text-sm font-black text-slate-700">Season</span>
            <input
              id={seasonId}
              value={settings.seasonLabel}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, seasonLabel: event.target.value }))
              }
              placeholder="Spring 26"
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={cutoffId} className="block">
            <span className="text-sm font-black text-slate-700">Gold Cutoff</span>
            <input
              id={cutoffId}
              type="number"
              min={1}
              max={Math.max(1, teamsCount)}
              value={settings.goldCutoff}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  goldCutoff: Number(event.target.value),
                }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={winId} className="block">
            <span className="text-sm font-black text-slate-700">Win Points</span>
            <input
              id={winId}
              type="number"
              step="0.5"
              min={0}
              value={settings.winPoints}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, winPoints: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={tieId} className="block">
            <span className="text-sm font-black text-slate-700">Tie Points</span>
            <input
              id={tieId}
              type="number"
              step="0.5"
              min={0}
              value={settings.tiePoints}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, tiePoints: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={capId} className="block">
            <span className="text-sm font-black text-slate-700">Max Score Cap</span>
            <input
              id={capId}
              type="number"
              min={8}
              max={30}
              value={settings.maxScoreCap}
              onChange={(event) =>
                setSettings((prev) => ({ ...prev, maxScoreCap: Number(event.target.value) }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
          <label htmlFor={aggrId} className="block">
            <span className="text-sm font-black text-slate-700">Model Aggression</span>
            <select
              id={aggrId}
              value={settings.modelAggression}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  modelAggression: event.target.value as ModelAggression,
                }))
              }
              className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="Conservative">Conservative</option>
              <option value="Balanced">Balanced</option>
              <option value="Aggressive">Aggressive</option>
            </select>
          </label>
          <label className="flex items-center justify-between rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-600">
            <span className="text-sm font-black text-slate-700">
              Run Differential Tiebreaker
            </span>
            <input
              type="checkbox"
              checked={settings.runDiffTiebreaker}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  runDiffTiebreaker: event.target.checked,
                }))
              }
              className="h-5 w-5"
              aria-label="Use run differential as a tiebreaker"
            />
          </label>
        </div>

        <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-900">
          <div className="text-[11px] font-black uppercase tracking-wide text-blue-700 dark:text-blue-400">
            Live preview
          </div>
          <p className="mt-2 leading-6">
            Standings points use Win {settings.winPoints} / Tie {settings.tiePoints}. Predictions
            cap scores at {settings.maxScoreCap}. Model aggression multiplier:{" "}
            {aggressionMultiplier.toFixed(1)}× (applied to tpi and momentum weights).
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">Data</h3>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="cursor-pointer rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800">
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                aria-label="Import schedule CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importCSV(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              onClick={exportCSV}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Export CSV
            </button>
            <button
              onClick={exportBackup}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Backup JSON
            </button>
            <button onClick={resetSeason} className={buttonClasses.danger}>
              Reset Season
            </button>
          </div>
        </div>
      </div>
      <aside className={`${card} p-6`}>
        <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">Current Setup</h3>
        <div className="mt-4 space-y-3 text-sm font-bold text-slate-600">
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Season</span>
            <span className="text-slate-950 dark:text-slate-100">{settings.seasonLabel}</span>
          </div>
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Gold Cutoff</span>
            <span className="text-slate-950 dark:text-slate-100">Top {goldCutoff}</span>
          </div>
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Win / Tie Points</span>
            <span className="text-slate-950 dark:text-slate-100">
              {settings.winPoints} / {settings.tiePoints}
            </span>
          </div>
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Run Diff Tiebreaker</span>
            <span className="text-slate-950 dark:text-slate-100">{settings.runDiffTiebreaker ? "On" : "Off"}</span>
          </div>
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Score Cap</span>
            <span className="text-slate-950 dark:text-slate-100">{settings.maxScoreCap}</span>
          </div>
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Model</span>
            <span className="text-slate-950 dark:text-slate-100">
              {settings.modelAggression} ({aggressionMultiplier.toFixed(1)}×)
            </span>
          </div>
          <div className="flex justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <span>Teams</span>
            <span className="text-slate-950 dark:text-slate-100">{teamsCount}</span>
          </div>
        </div>
      </aside>
    </section>
  );
}

function GamesView({
  teams,
  matchups: _matchups,
  logs,
  scoreboardGames,
  scoreboardPredictions,
  scoreboardTeamFilter,
  setScoreboardTeamFilter,
  newDate,
  setNewDate,
  newAway,
  setNewAway,
  newHome,
  setNewHome,
  addGameValid,
  addGame,
  toggleFinal,
  swapGame,
  removeGame,
  updateLog,
  setMatchups,
  gameStatusClasses,
}: {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  scoreboardGames: Matchup[];
  scoreboardPredictions: Map<string, { spread: string; pickName: string; pickPct: number; status: string }>;
  scoreboardTeamFilter: string;
  setScoreboardTeamFilter: (v: string) => void;
  newDate: string;
  setNewDate: (v: string) => void;
  newAway: string;
  setNewAway: (v: string) => void;
  newHome: string;
  setNewHome: (v: string) => void;
  addGameValid: boolean;
  addGame: () => void;
  toggleFinal: (id: string) => void;
  swapGame: (id: string) => void;
  removeGame: (id: string) => void;
  updateLog: (id: string, field: keyof GameLog, value: string | boolean) => void;
  setMatchups: React.Dispatch<React.SetStateAction<Matchup[]>>;
  gameStatusClasses: (s: string) => string;
}) {
  const dateId = useId();
  const awayId = useId();
  const homeId = useId();
  const filterId = useId();

  return (
    <section className="space-y-6">
      <div className={`${card} p-5`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_1fr_1fr_auto]">
          <div>
            <label htmlFor={dateId} className="sr-only">
              Game date
            </label>
            <GameDateInput
              value={newDate}
              onCommit={(v) => setNewDate(v)}
              ariaLabel="New game date (M/D)"
            />
            <input
              id={dateId}
              type="hidden"
              value={newDate}
              readOnly
              aria-hidden="true"
            />
          </div>
          <label htmlFor={awayId} className="block">
            <span className="sr-only">Away team</span>
            <select
              id={awayId}
              value={newAway}
              onChange={(event) => setNewAway(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="">Away team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={homeId} className="block">
            <span className="sr-only">Home team</span>
            <select
              id={homeId}
              value={newHome}
              onChange={(event) => setNewHome(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-bold text-slate-950 outline-none focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="">Home team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addGame}
            disabled={!addGameValid}
            className="rounded-xl bg-red-600 px-5 py-2 font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Game
          </button>
        </div>
        {!addGameValid && (newAway || newHome) && (
          <p className="mt-2 text-xs font-bold text-amber-600">
            Pick two different teams to add a game.
          </p>
        )}
      </div>

      <div className={`${card} p-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label htmlFor={filterId} className="text-sm font-black text-slate-700">
            Scoreboard Filter
          </label>
          <select
            id={filterId}
            value={scoreboardTeamFilter}
            onChange={(event) => setScoreboardTeamFilter(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-slate-950 md:w-72 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
          >
            <option value="ALL">All Teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {displayName(team.name)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {scoreboardGames.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
          No games yet. Use the form above to add one.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {scoreboardGames.map((game) => {
            const log = logs[game.id] || blankLog();
            const away = teams.find((team) => team.id === game.away);
            const home = teams.find((team) => team.id === game.home);
            const final = isFinal(log);
            const prediction = scoreboardPredictions.get(game.id);
            return (
              <article
                key={game.id}
                className={`overflow-hidden rounded-3xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${
                  final ? "border-slate-200 opacity-80 dark:border-slate-700" : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <GameDateInput
                    value={game.date}
                    ariaLabel={`Date for ${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`}
                    onCommit={(nextDate) =>
                      setMatchups((prev) =>
                        prev.map((item) =>
                          item.id === game.id ? { ...item, date: nextDate } : item
                        )
                      )
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleFinal(game.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-black ${
                        final ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
                      }`}
                      aria-label={final ? "Mark game as open" : "Mark game as final"}
                    >
                      {final ? "Final" : "Open"}
                    </button>
                    <button
                      type="button"
                      onClick={() => swapGame(game.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-black dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      aria-label="Swap home and away teams"
                    >
                      Swap
                    </button>
                    <button
                      type="button"
                      onClick={() => removeGame(game.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-black text-red-600 dark:border-slate-600 dark:bg-slate-800"
                      aria-label="Delete game"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  {!final && prediction && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700 shadow-sm ring-1 ring-slate-200">
                          Spread: {prediction.spread}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 ${gameStatusClasses(prediction.status)}`}
                        >
                          {prediction.status}
                        </span>
                      </div>
                      <span className="text-slate-500">
                        Pick: {prediction.pickName} ·{" "}
                        {Math.round(prediction.pickPct * 100)}%
                      </span>
                    </div>
                  )}
                  <ScoreRow
                    teamName={away?.name || game.away}
                    prefix="away"
                    log={log}
                    onChange={(field, value) => updateLog(game.id, field, value)}
                  />
                  <ScoreRow
                    teamName={home?.name || game.home}
                    prefix="home"
                    log={log}
                    onChange={(field, value) => updateLog(game.id, field, value)}
                  />
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-500 dark:text-slate-400">
                    <label className="flex items-center gap-2">
                      Innings
                      <input
                        value={log.innings}
                        onChange={(event) =>
                          updateLog(
                            game.id,
                            "innings",
                            event.target.value.replace(/[^0-9]/g, "").slice(0, 2)
                          )
                        }
                        onBlur={(event) => {
                          const n = clamp(parseNumber(event.target.value, 6), 1, 10);
                          updateLog(game.id, "innings", String(n));
                        }}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={2}
                        aria-label="Innings played"
                        className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center font-black text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>
                    <span>
                      {final
                        ? `Final · ${formatGameDate(game.date)}`
                        : (game.date ?? "").trim()
                          ? formatGameDateLong(game.date)
                          : "Needs Date"}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// expose for tree-shake-friendly use in DEFAULT_SETTINGS test imports
export { DEFAULT_SETTINGS };
