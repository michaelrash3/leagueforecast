import { useMemo } from "react";
import { formatGameDate } from "../../lib/date";
import { displayName } from "../../lib/format";
import { seasonRace } from "../../lib/seasonRace";
import type { GameLog, Matchup, Settings, TeamBase } from "../../lib/types";
import { LineChart, seriesSlots, type LineSeries } from "./LineChart";

/**
 * The places the axis names: every one in a league of ten or fewer, and otherwise first and each
 * step of a size that leaves about eight. Whole places only: spaced evenly from first to last, as
 * the axis was, an eight-team league's lines were drawn at 1, 2.75, 4.5, 6.25 and 8 and labelled
 * 1, 3, 5, 6 and 8, with "5" printed on the Gold line that falls between fourth and fifth.
 */
export const placeTicks = (teamCount: number): number[] => {
  const last = Math.max(2, teamCount);
  const step = last <= 10 ? 1 : Math.ceil(last / 8);
  const ticks: number[] = [];
  for (let place = 1; place <= last; place += step) ticks.push(place);
  return ticks;
};

/**
 * Every place a team has held, game day by game day, with first at the top and the Gold line
 * drawn where the cut falls. The followed team leads, drawn heavier, with the teams on top now
 * beside it, five lines at most so the race stays readable.
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
    const slots = seriesSlots(ids);
    return ids.map((id): LineSeries => ({
      id,
      label: displayName(names.get(id) ?? id),
      values: race.places[id] ?? [],
      slot: slots.get(id) ?? 0,
      ...(id === followId ? { lead: true } : {}),
    }));
  }, [race, names, followId, teamCount]);
  // Dates as every League view writes them, "4/5" where the season stores "2026-04-05".
  const xLabels = useMemo(() => race.dates.map(formatGameDate), [race.dates]);

  if (race.dates.length < 2 || series.length === 0) return null;
  return (
    <LineChart
      series={series}
      yMin={1}
      yMax={Math.max(2, teamCount)}
      yTicks={placeTicks(teamCount)}
      valueLabel={(place) => `#${Math.round(place)}`}
      xLabels={xLabels}
      invert
      {...(cutoff ? { cutLine: { value: cutoff + 0.5, label: "Gold line" } } : {})}
    />
  );
}
