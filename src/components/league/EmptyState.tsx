/**
 * What the league half shows before there is a season: the ways to get one started, laid out
 * as a flow rather than a wall of buttons.
 */
import { useId, useState, type ReactNode } from "react";
import { DesignFlowPanel, type DesignFlowStep } from "../DesignFlowPanel";
import type { TeamBase } from "../../lib/types";
import { displayName } from "../../lib/format";
import { EditLock } from "./EditLock";

export function EmptyState({
  importCSV,
  createSeasonFromTeamList,
  downloadRoundRobinCSV,
  seasonBuilderText,
  setSeasonBuilderText,
  teams,
  loadDemoSeason,
  openTour,
  startFromClubs,
  startFromGcOrg,
  schedulePaste,
}: {
  importCSV: (file: File) => void;
  createSeasonFromTeamList: () => void;
  downloadRoundRobinCSV: () => void;
  seasonBuilderText: string;
  setSeasonBuilderText: (v: string) => void;
  teams: TeamBase[];
  loadDemoSeason: () => void;
  openTour: () => void;
  /**
   * Starting the season from its clubs on Team Rankings (3.7), drawn under the flow once asked
   * for, with what closes it. Absent where Team Rankings cannot be read.
   */
  startFromClubs?: (close: () => void) => ReactNode;
  /**
   * Starting the season from a GameChanger organization's own schedule, through the app's
   * GameChanger proxy (`StartFromGcOrg`), drawn under the flow once asked for, with what closes it.
   */
  startFromGcOrg?: (close: () => void) => ReactNode;
  /**
   * The team-list box read as a league site's schedule instead (`LeagueSchedulePaste`), drawn
   * under it once asked for, with what closes it. A button on the box rather than a step of the
   * flow, since this screen is part of the first download and the reader is fetched on the press.
   */
  schedulePaste?: (text: string, close: () => void) => ReactNode;
}) {
  const [starting, setStarting] = useState(false);
  const [startingOrg, setStartingOrg] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  // Where closing the paste panel puts focus back: the button that opened it, still on screen.
  const readId = useId();
  const kickoffFlow: DesignFlowStep[] = [
    {
      eyebrow: "Load",
      title: "Bring in the league file",
      body: "Start with the official CSV when you have dates, teams, and scores already organized.",
      meta: "Fastest path for real schedules",
      tone: "blue",
      actions: [
        {
          label: "Import CSV",
          tone: "primary",
          edits: true,
          file: {
            accept: ".csv,text/csv",
            ariaLabel: "Import schedule CSV",
            onChange: importCSV,
          },
        },
      ],
    },
    {
      eyebrow: "Build",
      title: "Create from team names",
      body: "Paste the clubs once and generate a blank round-robin shell for scorekeeping.",
      meta: "Great for a clean new season",
      tone: "amber",
      actions: [
        { label: "Create Schedule", tone: "dark", edits: true, onClick: createSeasonFromTeamList },
        { label: "Blank CSV", onClick: downloadRoundRobinCSV },
      ],
    },
    startFromClubs || startFromGcOrg
      ? {
          eyebrow: "Link",
          title: "Start from GameChanger",
          body: "Pick the league's clubs on a Team Rankings page, or name the league's organization on GameChanger. Their games against each other come in with GameChanger's scores.",
          meta: "For leagues whose clubs are on GameChanger",
          tone: "emerald",
          actions: [
            ...(startFromClubs
              ? [{ label: "Pick clubs", edits: true, onClick: () => setStarting(true) }]
              : []),
            ...(startFromGcOrg
              ? [
                  {
                    label: "From an organization",
                    edits: true,
                    onClick: () => setStartingOrg(true),
                  },
                ]
              : []),
          ],
        }
      : {
          eyebrow: "Review",
          title: "Review season data",
          body: "Use standings, team stats, and the schedule board to confirm the season looks right.",
          meta: "Validates teams, games, and scores",
          tone: "emerald",
        },
    {
      eyebrow: "Practice",
      title: "Explore with demo data",
      body: "Load a sample season to see the model, cut line, and recap flow before importing yours.",
      meta: "Safe sandbox mode",
      tone: "red",
      actions: [{ label: "Load Demo", edits: true, onClick: loadDemoSeason }],
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <DesignFlowPanel
        title="Launch the season with a guided flow"
        subtitle="A visual setup lane keeps the first import, roster build, validation, and demo rehearsal in one place before the standings go live."
        steps={kickoffFlow}
        footer={
          <button
            type="button"
            onClick={openTour}
            className="text-sm font-semibold text-slate-500 underline decoration-dotted underline-offset-4 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
          >
            New here? Take the quick tour
          </button>
        }
      />

      {starting && startFromClubs?.(() => setStarting(false))}
      {startingOrg && startFromGcOrg?.(() => setStartingOrg(false))}

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-900">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            New Season Builder
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
            One team per line. Step 2 above turns this list into a round-robin schedule.
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
                : "Falcons\nWolves\nComets"
            }
            className="mt-4 h-44 w-full resize-none rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <EditLock>
              <button
                onClick={createSeasonFromTeamList}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800"
              >
                Create Schedule
              </button>
              {schedulePaste && (
                <button
                  id={readId}
                  onClick={() => setReading(seasonBuilderText)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Read as a schedule
                </button>
              )}
            </EditLock>
            <button
              onClick={downloadRoundRobinCSV}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Download Blank CSV
            </button>
            <button
              onClick={() =>
                setSeasonBuilderText(teams.map((team) => displayName(team.name)).join("\n"))
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              Use Current Teams
            </button>
          </div>
          {reading !== null &&
            schedulePaste?.(reading, () => {
              setReading(null);
              document.getElementById(readId)?.focus();
            })}
        </div>
      </div>
    </div>
  );
}
