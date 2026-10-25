import { useMemo } from "react";
import { displayName } from "../../lib/format";
import { seasonRace } from "../../lib/seasonRace";
import type { GameLog, Matchup, Settings, TeamBase } from "../../lib/types";
import { LineChart, type LineSeries } from "./LineChart";

const TONES: NonNullable<LineSeries["tone"]>[] = ["blue", "amber", "red", "slate"];

/**
 * Every place a team has held, game day by game day, with first at the top and the Gold line
 * drawn where the cut falls. The followed team leads, in green, with the teams on top now beside
 * it, five lines at most so the race stays readable.
 */
/** The season as stored, from which the chart works out each game day's table (`seasonRace`). */
export type SeasonRaceInput = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
};

export function SeasonRaceChart({
  input,
  names,
  followId,
  cutoff,
  teamCount,
}: {
  input: SeasonRaceInput;
  names: ReadonlyMap<string, string>;
  followId?: string | null;
  /** Places inside the cut, for the line; none where the league has no cut line. */
  cutoff?: number;
  teamCount: number;
}) {
  // Worked out here, in the chart's own chunk, so none of it is in the first download.
  const race = useMemo(
    () => seasonRace(input.teams, input.matchups, input.logs, input.settings),
    [input.teams, input.matchups, input.logs, input.settings]
  );
  const series = useMemo(() => {
    const now = (id: string) => {
      const places = race.places[id] ?? [];
      return places[places.length - 1] ?? teamCount;
    };
    const leaders = Object.keys(race.places)
      .filter((id) => id !== followId)
      .sort((a, b) => now(a) - now(b));
    const ids = [...(followId && race.places[followId] ? [followId] : []), ...leaders].slice(0, 5);
    return ids.map((id, at): LineSeries => ({
      id,
      label: displayName(names.get(id) ?? id),
      values: race.places[id] ?? [],
      tone: id === followId ? "emerald" : TONES[(at - (followId ? 1 : 0)) % TONES.length],
    }));
  }, [race, names, followId, teamCount]);

  if (race.dates.length < 2 || series.length === 0) return null;
  return (
    <LineChart
      series={series}
      yMin={1}
      yMax={Math.max(2, teamCount)}
      yLabel=""
      xLabels={race.dates}
      invert
      highlightLast={false}
      {...(cutoff ? { cutLine: { value: cutoff + 0.5, label: "Gold line" } } : {})}
    />
  );
}
