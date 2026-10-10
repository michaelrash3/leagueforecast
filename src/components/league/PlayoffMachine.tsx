import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  basisFor,
  basisOf,
  dropScenario,
  isStale,
  keepScenario,
  livePicks as applyingPicks,
  MOST_RUNS,
  newScenarioId,
  presetPicks,
  readScenarios,
  rebaseScenario,
  scenarioLinkHash,
  scenarioTrouble,
  troubleLine,
  type GameBasis,
  type Kept,
  type Preset,
  type SavedScenario,
} from "../../lib/savedScenarios";
import { scenarioSeason, type ScenarioPick } from "../../lib/scenario";
import { getMathGoldStatus, getRemainingCounts, predictGame } from "../../lib/sim";
import { formatGameDate, parseDateValue, seasonStartMonth } from "../../lib/date";
import { displayName, recordText } from "../../lib/format";
import { useSimulationOdds } from "../../hooks/useSimulationWorker";
import type {
  GameLog,
  Matchup,
  Settings,
  Team,
  TeamBase,
  TeamWithProjection,
} from "../../lib/types";
import { button as buttonClasses, card, fieldFocusRing, textRole } from "../../styles/tokens";

type PlayoffMachineProps = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
  /** The teams the forecast reads now, for each game's expected score. */
  liveTeams: Team[];
  ratings: { byTeam: Map<string, number>; games: Map<string, number> };
  remainingGames: Matchup[];
  cutoff: number;
  hasCutLine: boolean;
  /** The table as it stands, for what each pick changes. */
  currentRows: TeamWithProjection[];
  oddsSeed: string;
  iterations: number;
  /** The season the picks are for, whose saved scenarios this device keeps (2.7). */
  seasonId: string;
  /** The team this browser follows, the one the quick picks' team starts on. */
  followedTeamId: string | null;
  /** A scenario of this season just kept from a link, to open at once. */
  incoming?: string | null;
  /** Told once the incoming scenario is open, so it is opened once and not on every visit. */
  onIncomingOpened?: () => void;
};

/**
 * The picks being made: each game's pick, and the game as it stood when picked, which is what
 * tells a pick on a game that has since changed under it (`scenarioTrouble`).
 */
type Working = { picks: Record<string, ScenarioPick>; basis: Record<string, GameBasis> };

const NO_PICKS: Working = { picks: {}, basis: {} };

const SIDE_BUTTON =
  "rounded-md border px-2 py-1 text-xs font-semibold transition-colors aria-pressed:border-slate-950 aria-pressed:bg-slate-950 aria-pressed:text-white dark:aria-pressed:border-white dark:aria-pressed:bg-white dark:aria-pressed:text-slate-950 border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50";

const FIELD = `rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`;

const runsInput = (value: number | undefined) => (value === undefined ? "" : String(value));

const change = (value: number): string =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(value !== 0 && Math.abs(value) < 1 ? 1 : 0)}`;

const samePick = (one: ScenarioPick | undefined, two: ScenarioPick | undefined) =>
  one !== undefined &&
  two !== undefined &&
  one.winnerId === two.winnerId &&
  one.awayRuns === two.awayRuns &&
  one.homeRuns === two.homeRuns;

/** Whether two sets of picks say the same: the same games, winners and typed scores. */
const samePicks = (
  one: Readonly<Record<string, ScenarioPick>>,
  two: Readonly<Record<string, ScenarioPick>>
) => {
  const ids = Object.keys(one);
  return ids.length === Object.keys(two).length && ids.every((id) => samePick(one[id], two[id]));
};

/** What a change to the open scenario adds when it shows the picks another tab saved to it. */
const THEIR_PICKS = " The picks shown are now those another tab saved to it.";

/** What a save says when it pushed the season's oldest scenarios out to make room. */
const pushedOutLine = (kept: Kept) =>
  kept.pushedOut.length
    ? ` To make room, this device let go of ${kept.pushedOut
        .map((one) => `“${one.name}”`)
        .join(", ")}.`
    : "";

const NOT_STORED = "This browser would not keep it: its storage is full or turned off.";

/**
 * "If we beat the Bears and the Cougars lose, where are we?"
 *
 * The question every family asks in the last weeks, and the page only ever answered it for the
 * model's own picks. Here the reader settles any game left by hand — who wins, and the score if
 * they like, since run differential breaks ties — and the table, the cut line and the Gold odds
 * are worked out again with those games played (`scenarioSeason`) and the rest simulated as the
 * forecast does, each team's rank, Gold chance, clinch and elimination set against the season as
 * it stands.
 *
 * Picks go when the page does unless saved as a scenario (2.7, `savedScenarios.ts`): kept on this
 * device for the season, opened again, renamed, copied, deleted or shared as a link. A saved
 * scenario says when the season has moved on under it, and is brought up to date on request.
 */
export function PlayoffMachine({
  teams,
  matchups,
  logs,
  settings,
  liveTeams,
  ratings,
  remainingGames,
  cutoff,
  hasCutLine,
  currentRows,
  oddsSeed,
  iterations,
  seasonId,
  followedTeamId,
  incoming = null,
  onIncomingOpened,
}: PlayoffMachineProps) {
  const [work, setWork] = useState<Working>(NO_PICKS);
  const nameOf = useMemo(() => {
    const names = new Map(teams.map((team) => [team.id, displayName(team.name)]));
    return (id: string) => names.get(id) ?? id;
  }, [teams]);
  // In the season's own order, which turns over New Year when its schedule does (`seasonStartMonth`).
  const games = useMemo(() => {
    const start = seasonStartMonth(matchups.map((game) => game.date));
    return [...remainingGames].sort(
      (a, b) => parseDateValue(a.date, start) - parseDateValue(b.date, start)
    );
  }, [remainingGames, matchups]);
  /*
   * The picks played out: those on games still to play, between the teams they were picked on. A
   * game played meanwhile is the real result's to settle; one taken off the schedule or given
   * other teams no longer means what the pick did, and is left out until picked again.
   */
  const workTrouble = useMemo(() => scenarioTrouble(work, matchups, logs), [work, matchups, logs]);
  const livePicks = useMemo(() => {
    const open = new Set(remainingGames.map((game) => game.id));
    return Object.fromEntries(
      Object.entries(applyingPicks(work.picks, workTrouble)).filter(([gameId]) => open.has(gameId))
    );
  }, [work.picks, workTrouble, remainingGames]);
  const picked = Object.keys(livePicks).length;

  // Saved scenarios (2.7): kept on this device for the season, one open at a time or none.
  const [saved, setSaved] = useState<SavedScenario[]>(() => readScenarios(seasonId));
  const [savedFor, setSavedFor] = useState(seasonId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ mode: "new" | "rename"; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The scenario asked about opening in place of picks not saved ("" for none), while asked.
  const [switching, setSwitching] = useState<string | null>(null);
  const [presetTeam, setPresetTeam] = useState<string>(followedTeamId ?? "");
  const [openedIncoming, setOpenedIncoming] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const nameId = useId();
  const pickerId = useId();
  const presetTeamId = useId();
  if (savedFor !== seasonId) {
    // Another season: its own scenarios, and none of the last one's picks.
    setSavedFor(seasonId);
    setSaved(readScenarios(seasonId));
    setOpenId(null);
    setWork(NO_PICKS);
    setSaid(null);
    setNaming(null);
    setDeleting(false);
    setSwitching(null);
    setPresetTeam(followedTeamId ?? "");
  }
  if (incoming && incoming !== openedIncoming) {
    // Just kept from a link: open it.
    setOpenedIncoming(incoming);
    const list = readScenarios(seasonId);
    const scenario = list.find((one) => one.id === incoming);
    setSaved(list);
    if (scenario) {
      setOpenId(scenario.id);
      setWork({ picks: scenario.picks, basis: scenario.basis });
      setSaid(`Opened “${scenario.name}”, kept from a link.`);
    }
  }
  useEffect(() => {
    if (!incoming) return;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    onIncomingOpened?.();
  }, [incoming, onIncomingOpened]);

  const open = saved.find((one) => one.id === openId) ?? null;
  const trouble = useMemo(
    () => (open ? scenarioTrouble(open, matchups, logs) : []),
    [open, matchups, logs]
  );
  const staleness = useMemo(
    () => new Map(saved.map((one) => [one.id, isStale(scenarioTrouble(one, matchups, logs))])),
    [saved, matchups, logs]
  );
  const unsavedChanges = open !== null && !samePicks(open.picks, work.picks);
  // The quick picks' team: the one chosen, or the first in the list when it is not in this season.
  const teamForPresets = teams.some((team) => team.id === presetTeam)
    ? presetTeam
    : (teams[0]?.id ?? "");
  const liveById = useMemo(() => new Map(liveTeams.map((team) => [team.id, team])), [liveTeams]);
  const favoriteOf = (game: Matchup) => predictGame(game, liveTeams, settings, liveById).winnerId;

  const settle = (message: string | null) => {
    setSaid(message);
    setNaming(null);
    setDeleting(false);
    setSwitching(null);
  };
  /** Stores a change to the season's scenarios, and says so; false when the browser refused. */
  const store = (kept: Kept | null, message: string): kept is Kept => {
    if (!kept) {
      settle(NOT_STORED);
      return false;
    }
    setSaved(kept.list);
    settle(`${message}${pushedOutLine(kept)}`);
    return true;
  };
  /** Opens a saved scenario, or none ("") and no picks, in place of the picks shown. */
  const openScenario = (id: string) => {
    const scenario = saved.find((one) => one.id === id) ?? null;
    setOpenId(scenario?.id ?? null);
    setWork(scenario ? { picks: scenario.picks, basis: scenario.basis } : NO_PICKS);
    settle(null);
  };
  /*
   * The picker's choice. Picks on screen that are not saved, made with no scenario open or changed
   * in the one open, go only once the person says so: a glance at another scenario would otherwise
   * lose them, with nothing said and no way back. Choosing again what is open withdraws the
   * question, which is where a step through the list with the arrow keys comes back to.
   */
  const chooseScenario = (id: string) => {
    if (id === (openId ?? "")) {
      setSwitching(null);
      return;
    }
    if (picked > 0 && (open === null || unsavedChanges)) {
      settle(null);
      setSwitching(id);
      return;
    }
    openScenario(id);
  };
  const switchingTo = switching ? (saved.find((one) => one.id === switching) ?? null) : null;
  /** The picks being played out, as a scenario keeps them: on the games as they stand now. */
  const asKept = () => ({ picks: livePicks, basis: basisFor(livePicks, matchups) });
  const saveNew = (name: string) => {
    const at = new Date().toISOString();
    const scenario: SavedScenario = {
      version: 1,
      id: newScenarioId(),
      name,
      seasonId,
      ...asKept(),
      createdAt: at,
      modifiedAt: at,
    };
    if (!store(keepScenario(scenario), `Saved “${name}” on this device.`)) return;
    setOpenId(scenario.id);
    setWork({ picks: scenario.picks, basis: scenario.basis });
  };
  /**
   * The open scenario as stored now, which another tab may have changed or let go of since this
   * one read it. A change to it starts from there, so what was saved there stays but for what this
   * change is of, and one let go of there is not brought back: the page says so, and its picks
   * stay here, unsaved.
   */
  const openAsStored = (): SavedScenario | null => {
    if (!open) return null;
    const list = readScenarios(seasonId);
    const stored = list.find((one) => one.id === open.id) ?? null;
    if (!stored) {
      setSaved(list);
      setOpenId(null);
      settle(
        `“${open.name}” is no longer kept on this device: another tab let it go. Its picks are still here, unsaved.`
      );
    }
    return stored;
  };
  /**
   * Whether a change taking in the open scenario as stored is to show the picks another tab saved
   * to it meanwhile: when there are some, and none of this tab's own wait to be saved, which stay.
   * Shown older, they would pass for changes made here, and Save changes would write them over
   * picks this tab never showed.
   */
  const showsTheirPicks = (stored: SavedScenario) =>
    open !== null && !unsavedChanges && !samePicks(open.picks, stored.picks);
  const saveChanges = () => {
    const stored = openAsStored();
    if (!stored) return;
    const updated: SavedScenario = { ...stored, ...asKept(), modifiedAt: new Date().toISOString() };
    if (!store(keepScenario(updated), `Saved the changes to “${stored.name}”.`)) return;
    setWork({ picks: updated.picks, basis: updated.basis });
  };
  const rename = (name: string) => {
    const stored = openAsStored();
    if (!stored) return;
    const theirs = showsTheirPicks(stored);
    if (
      !store(
        keepScenario({ ...stored, name, modifiedAt: new Date().toISOString() }),
        `Renamed to “${name}”.${theirs ? THEIR_PICKS : ""}`
      )
    )
      return;
    if (theirs) setWork({ picks: stored.picks, basis: stored.basis });
  };
  const duplicate = () => {
    if (!open) return;
    const at = new Date().toISOString();
    const copy: SavedScenario = {
      ...open,
      id: newScenarioId(),
      name: `${open.name} (copy)`.slice(0, 80),
      ...asKept(),
      createdAt: at,
      modifiedAt: at,
    };
    if (!store(keepScenario(copy), `Made “${copy.name}”, with the picks as they are now.`)) return;
    setOpenId(copy.id);
    setWork({ picks: copy.picks, basis: copy.basis });
  };
  const remove = () => {
    if (!open) return;
    if (
      !store(
        dropScenario(seasonId, open.id),
        `Deleted “${open.name}”. Its picks are still here, unsaved.`
      )
    )
      return;
    setOpenId(null);
  };
  const bringUpToDate = () => {
    const stored = openAsStored();
    if (!stored) return;
    const theirs = showsTheirPicks(stored);
    const { scenario, dropped } = rebaseScenario(stored, matchups, logs, new Date().toISOString());
    const message = dropped.length
      ? `Brought up to date: ${dropped.length} ${dropped.length === 1 ? "pick" : "picks"} no longer applied and ${dropped.length === 1 ? "was" : "were"} taken out.`
      : "Brought up to date: every pick still applies.";
    if (!store(keepScenario(scenario), `${message}${theirs ? THEIR_PICKS : ""}`)) return;
    // The picks shown stay as they are, any not yet saved among them, and only those left out go;
    // unless they are to give way to those another tab saved, as now kept.
    setWork(theirs ? { picks: scenario.picks, basis: scenario.basis } : asKept());
  };
  const share = async () => {
    const at = new Date().toISOString();
    const hash = scenarioLinkHash({
      version: 1,
      id: open?.id ?? "shared",
      name: open?.name ?? "Shared picks",
      seasonId,
      ...asKept(),
      createdAt: at,
      modifiedAt: at,
    });
    if (!hash) {
      settle("Too many picks to fit in a link. Share fewer, or save them on this device.");
      return;
    }
    // League Standings named, so the link opens there whichever part of the app was open last.
    const url = `${window.location.origin}${window.location.pathname}?view=league#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      settle(
        "Link copied. Opening it shows these picks and asks before keeping them; it never changes the season on the device that opens it."
      );
    } catch {
      settle(`Copy this link: ${url}`);
    }
  };
  const applyPreset = (preset: Preset) => {
    // Made over the picks shown, every one of them on its game as it stands: one left out, on a
    // game changed under it, goes with the preset rather than coming back on the changed game.
    const picks = presetPicks(preset, {
      remaining: games,
      current: livePicks,
      favoriteOf,
      teamId: teamForPresets,
    });
    setWork({ picks, basis: basisFor(picks, matchups) });
    settle(null);
  };

  const scenario = useMemo(
    () =>
      picked === 0
        ? null
        : scenarioSeason({ teams, matchups, logs, settings, liveTeams, ratings }, livePicks),
    [picked, teams, matchups, logs, settings, liveTeams, ratings, livePicks]
  );
  const { odds, pending } = useSimulationOdds({
    teams: hasCutLine && scenario ? scenario.teams : [],
    remaining: scenario?.remaining ?? [],
    iterations,
    seedText: `${oddsSeed}|picks|${JSON.stringify(livePicks)}`,
    cutoff,
    settings,
  });

  const nowById = useMemo(() => new Map(currentRows.map((row) => [row.id, row])), [currentRows]);
  // Where each team would stand in the race with the picks played: what they make certain.
  const statusWith = useMemo(() => {
    if (!scenario || !hasCutLine) return new Map<string, string>();
    const counts = getRemainingCounts(
      scenario.teams,
      scenario.remaining,
      Math.max(0, Math.round(settings.regularSeasonGamesPerTeam || 0))
    );
    return new Map(
      scenario.ranked.map((team) => [
        team.id,
        getMathGoldStatus(team, scenario.ranked, counts, cutoff, settings).goldStatus,
      ])
    );
  }, [scenario, hasCutLine, settings, cutoff]);

  const choose = (game: Matchup, winnerId: string | null) =>
    setWork((before) => {
      const picks = { ...before.picks };
      const basis = { ...before.basis };
      if (winnerId === null) {
        delete picks[game.id];
        delete basis[game.id];
      } else {
        picks[game.id] = { winnerId };
        basis[game.id] = basisOf(game);
      }
      return { picks, basis };
    });
  const typeRuns = (game: Matchup, side: "awayRuns" | "homeRuns", text: string) =>
    setWork((before) => {
      const pick = before.picks[game.id];
      if (!pick) return before;
      // No more than a saved scenario keeps (`MOST_RUNS`), so what is saved is what was shown.
      const runs =
        text.trim() === "" ? undefined : Math.min(MOST_RUNS, Math.max(0, Math.round(Number(text))));
      const next: ScenarioPick = { ...pick };
      if (runs === undefined || !Number.isFinite(runs)) delete next[side];
      else next[side] = runs;
      return { ...before, picks: { ...before.picks, [game.id]: next } };
    });

  return (
    <section ref={sectionRef} aria-label="Playoff machine" className={`${card} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={textRole.sectionTitle}>Playoff machine</h3>
        {picked > 0 && (
          <button
            type="button"
            className={buttonClasses.ghost}
            onClick={() => {
              setWork(NO_PICKS);
              settle(null);
            }}
          >
            Clear picks
          </button>
        )}
      </div>
      <p className={`mt-1 ${textRole.meta}`}>
        Pick the winner of any game left and see where everyone lands. A pick plays out at the
        model&apos;s expected score unless you type one. Picks are kept only when you save them, on
        this device.
      </p>

      <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={pickerId} className="flex flex-col gap-1">
            <span className={textRole.overline}>Scenario</span>
            {/* The entry asked about while asked, so the arrow keys step on from it. */}
            <select
              id={pickerId}
              value={switching ?? openId ?? ""}
              onChange={(event) => chooseScenario(event.target.value)}
              className={FIELD}
            >
              <option value="">{saved.length ? "Unsaved picks" : "No saved scenarios yet"}</option>
              {saved.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                  {staleness.get(one.id) ? " (out of date)" : ""}
                </option>
              ))}
            </select>
          </label>
          {open ? (
            <>
              <button
                type="button"
                className={SIDE_BUTTON}
                disabled={!unsavedChanges || picked === 0}
                onClick={saveChanges}
              >
                Save changes
              </button>
              <button
                type="button"
                className={SIDE_BUTTON}
                onClick={() => {
                  setDeleting(false);
                  setSwitching(null);
                  setNaming({ mode: "rename", name: open.name });
                }}
              >
                Rename
              </button>
              <button type="button" className={SIDE_BUTTON} onClick={duplicate}>
                Duplicate
              </button>
              <button
                type="button"
                className={SIDE_BUTTON}
                onClick={() => {
                  setNaming(null);
                  setSwitching(null);
                  setDeleting(true);
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              className={SIDE_BUTTON}
              disabled={picked === 0}
              onClick={() => {
                setSwitching(null);
                setNaming({ mode: "new", name: `Scenario ${saved.length + 1}` });
              }}
            >
              Save as a scenario
            </button>
          )}
          <button
            type="button"
            className={SIDE_BUTTON}
            disabled={picked === 0}
            onClick={() => void share()}
          >
            Share
          </button>
        </div>

        {naming && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = naming.name.trim().slice(0, 80);
              if (!name) return;
              if (naming.mode === "new") saveNew(name);
              else rename(name);
            }}
          >
            <label htmlFor={nameId} className="flex flex-col gap-1">
              <span className={textRole.overline}>
                {naming.mode === "new" ? "Name the scenario" : "New name"}
              </span>
              <input
                id={nameId}
                value={naming.name}
                maxLength={80}
                onChange={(event) => setNaming({ ...naming, name: event.target.value })}
                className={FIELD}
              />
            </label>
            <button type="submit" className={SIDE_BUTTON} disabled={!naming.name.trim()}>
              {naming.mode === "new" ? "Save" : "Save name"}
            </button>
            <button type="button" className={SIDE_BUTTON} onClick={() => setNaming(null)}>
              Cancel
            </button>
          </form>
        )}

        {deleting && open && (
          <div
            role="group"
            aria-label="Delete the scenario"
            className="flex flex-wrap items-center gap-2"
          >
            <span className={textRole.body}>
              Delete “{open.name}”? Its picks stay here, unsaved.
            </span>
            <button type="button" className={SIDE_BUTTON} onClick={remove}>
              Delete it
            </button>
            <button type="button" className={SIDE_BUTTON} onClick={() => setDeleting(false)}>
              Keep it
            </button>
          </div>
        )}

        {switching !== null && (
          <div
            role="group"
            aria-label="Picks not saved"
            className="flex flex-wrap items-center gap-2"
          >
            <span role="status" className={textRole.body}>
              {open
                ? `The changes to “${open.name}” are not saved.`
                : "The picks on screen are not saved."}{" "}
              {switchingTo
                ? `Open “${switchingTo.name}” in their place?`
                : "Start again with no picks?"}
            </span>
            <button type="button" className={SIDE_BUTTON} onClick={() => openScenario(switching)}>
              Let them go
            </button>
            <button type="button" className={SIDE_BUTTON} onClick={() => setSwitching(null)}>
              Keep them
            </button>
          </div>
        )}

        {open && isStale(trouble) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/70 dark:bg-amber-950/40">
            <p className="text-sm font-black text-amber-900 dark:text-amber-100">
              The season has moved on since “{open.name}” was saved
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm text-amber-900 dark:text-amber-100">
              {trouble.map((one) => (
                <li key={one.gameId}>{troubleLine(one, nameOf)}</li>
              ))}
            </ul>
            <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">
              Picks on games played, taken off the schedule or given other teams are left out of
              what is shown.
            </p>
            <button type="button" className={`mt-2 ${SIDE_BUTTON}`} onClick={bringUpToDate}>
              Bring it up to date
            </button>
          </div>
        )}

        {games.length > 0 && (
          <div className="flex flex-wrap items-end gap-2" aria-label="Quick picks" role="group">
            <button type="button" className={SIDE_BUTTON} onClick={() => applyPreset("favorites")}>
              Favorites win
            </button>
            <button
              type="button"
              className={SIDE_BUTTON}
              onClick={() => applyPreset("fillFavorites")}
            >
              Fill the rest with favorites
            </button>
            <label htmlFor={presetTeamId} className="flex flex-col gap-1">
              <span className={textRole.overline}>Team</span>
              <select
                id={presetTeamId}
                value={teamForPresets}
                onChange={(event) => setPresetTeam(event.target.value)}
                className={FIELD}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {displayName(team.name)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={SIDE_BUTTON} onClick={() => applyPreset("winOut")}>
              Wins out
            </button>
            <button type="button" className={SIDE_BUTTON} onClick={() => applyPreset("loseOut")}>
              Loses out
            </button>
          </div>
        )}

        {said && (
          <p role="status" className={textRole.meta}>
            {said}
          </p>
        )}
      </div>

      {games.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No games left to pick.</p>
      ) : (
        <ul className="mt-3 max-h-96 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {games.map((game) => {
            const pick = livePicks[game.id];
            const score = scenario?.scores[game.id];
            const away = nameOf(game.away);
            const home = nameOf(game.home);
            return (
              <li key={game.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {formatGameDate(game.date)}
                </span>
                <span role="group" aria-label={`${away} at ${home}`} className="flex gap-1">
                  <button
                    type="button"
                    aria-pressed={pick?.winnerId === game.away}
                    className={SIDE_BUTTON}
                    onClick={() => choose(game, game.away)}
                  >
                    {away}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!pick}
                    className={SIDE_BUTTON}
                    onClick={() => choose(game, null)}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    aria-pressed={pick?.winnerId === game.home}
                    className={SIDE_BUTTON}
                    onClick={() => choose(game, game.home)}
                  >
                    {home}
                  </button>
                </span>
                {pick && (
                  <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <input
                      type="number"
                      min={0}
                      max={MOST_RUNS}
                      inputMode="numeric"
                      aria-label={`${away} runs`}
                      placeholder={score ? String(score.awayRuns) : ""}
                      value={runsInput(pick.awayRuns)}
                      onChange={(event) => typeRuns(game, "awayRuns", event.target.value)}
                      className="w-12 rounded border border-slate-300 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                    />
                    –
                    <input
                      type="number"
                      min={0}
                      max={MOST_RUNS}
                      inputMode="numeric"
                      aria-label={`${home} runs`}
                      placeholder={score ? String(score.homeRuns) : ""}
                      value={runsInput(pick.homeRuns)}
                      onChange={(event) => typeRuns(game, "homeRuns", event.target.value)}
                      className="w-12 rounded border border-slate-300 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {scenario && (
        <table className="mt-4 w-full text-sm" aria-label="Standings with your picks">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="py-1">#</th>
              <th className="py-1">Team</th>
              <th className="py-1">Record</th>
              {hasCutLine && <th className="py-1 text-right">Gold %</th>}
            </tr>
          </thead>
          <tbody>
            {scenario.ranked.map((team) => {
              const now = nowById.get(team.id);
              const moved = now?.rank !== undefined ? now.rank - team.rank : 0;
              const gold = odds[team.id];
              const goldMove = gold !== undefined && now ? gold - now.goldPct : undefined;
              // What the picks make certain that the season as it stands does not.
              const status = statusWith.get(team.id);
              const settles =
                status === "Clinched" && now?.goldStatus !== "Clinched"
                  ? "Clinches"
                  : status === "Eliminated" && now?.goldStatus !== "Eliminated"
                    ? "Out"
                    : null;
              return (
                <tr
                  key={team.id}
                  className={
                    hasCutLine && team.rank === cutoff
                      ? "border-b-2 border-dashed border-amber-500"
                      : ""
                  }
                >
                  <td className="py-1 font-bold">
                    {team.rank}
                    {moved !== 0 && (
                      <span
                        className={`ml-1 text-xs ${moved > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
                      >
                        {moved > 0 ? "▲" : "▼"}
                        {Math.abs(moved)}
                      </span>
                    )}
                  </td>
                  <td className="py-1">
                    {displayName(team.name)}
                    {settles && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-xs font-bold ${settles === "Clinches" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}
                      >
                        {settles}
                      </span>
                    )}
                  </td>
                  <td className="py-1">{recordText(team)}</td>
                  {hasCutLine && (
                    <td className="py-1 text-right">
                      {pending || gold === undefined ? (
                        "…"
                      ) : (
                        <>
                          {Math.round(gold)}%
                          {goldMove !== undefined && Math.abs(goldMove) >= 0.5 && (
                            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                              ({change(goldMove)})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
