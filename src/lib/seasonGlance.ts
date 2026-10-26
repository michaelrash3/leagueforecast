/**
 * League Standings' seasons at a glance: how each season this device holds ended, or how it stands,
 * worked out from the season's stored copy alone, with no engine, no worker and nothing fetched.
 * Read only while the glance is open (`SeasonsAtAGlance.tsx`).
 */
import { buildBracketProjection, type BracketProjection } from "./bracket";
import { displayName, recordText } from "./format";
import { seasonFinalOf, type SeasonFinal } from "./seasonFinal";
import { seasonNameStem, squadYearFromName } from "./seasonNames";
import { calculateTeams, effectiveGoldCutoff, rankOptionsFromSettings, rankTeams } from "./sim";
import type { SeasonMeta, SeasonSnapshot } from "./storage";
import { isFinal } from "./util";

export type SeasonGlance = {
  played: number;
  scheduled: number;
  teams: number;
  /** First in the table as it stands, as the app shows the name; null before any game is final. */
  leader: string | null;
  /** How the season ended, word for word as the Dashboard says it (`seasonFinalOf`), once it has. */
  final: SeasonFinal | null;
  /** Every regular-season game is final, and the bracket's final is not yet decided on the field. */
  bracketOpen: boolean;
  /**
   * The team this device follows in the season: its place in the table, its record, and whether it
   * is inside the Gold line (null in a league with no cut line, where nobody is outside one).
   */
  ours: { name: string; place: number; of: number; record: string; gold: boolean | null } | null;
};

type Crown = { team: { id: string; name: string } | null; source: string };

const NO_CROWN: Crown = { team: null, source: "none" };

/**
 * A bracket's champion, but only from a bracket the field decided: every game in it played or a
 * bye. A game with no score is the model's pick, and the model here is not the Dashboard's, which
 * also leans on the ratings Team Rankings feeds it, so a final played between two teams the model
 * put there could be read here for other teams than the Dashboard's. Such a bracket names no
 * champion rather than a different one.
 */
const crownOf = (bracket: BracketProjection): Crown =>
  bracket.rounds.every((round) => round.every((game) => game.winnerSource !== "projected"))
    ? { team: bracket.champion, source: bracket.championSource }
    : { team: null, source: "projected" };

/**
 * One season at a glance. The table is the standings' own (`calculateTeams`, `rankTeams`), and
 * the season's ending is the Dashboard's (`seasonFinalOf`), from brackets built the way App builds
 * them, so a champion named here is the champion the Dashboard names.
 *
 * The brackets are built only once nothing is left to play: before then no champion can be named
 * anyway, and a bracket is seeded on the final table. With no game left, the Dashboard's seeding,
 * by projected place, is the table itself, since a projection with nothing to play is the
 * standings (`projectStandings`), and the teams' ratings do not enter the order.
 */
export const seasonGlance = (
  season: Pick<SeasonSnapshot, "teams" | "matchups" | "logs" | "bracketLogs" | "settings">,
  ourTeamId: string | null
): SeasonGlance => {
  const { teams, matchups, logs, bracketLogs, settings } = season;
  const ranked = rankTeams(
    calculateTeams(teams, matchups, logs, settings),
    rankOptionsFromSettings(settings)
  );
  const scheduled = matchups.length;
  const remaining = matchups.filter((game) => !isFinal(logs[game.id])).length;
  const played = scheduled - remaining;
  const hasCutLine = settings.postseasonFormat === "cut";
  const hasPostseason = settings.postseasonFormat !== "none";
  const cutoff = effectiveGoldCutoff(settings, teams.length);
  const over = scheduled > 0 && remaining === 0;
  const gold =
    over && hasPostseason
      ? buildBracketProjection({ teams: ranked, cutoff, logs: bracketLogs, settings })
      : null;
  const silver =
    over && hasCutLine
      ? buildBracketProjection({
          teams: ranked,
          cutoff: Math.max(0, ranked.length - cutoff),
          startIndex: cutoff,
          idPrefix: "silver-bracket",
          logs: bracketLogs,
          settings,
        })
      : null;
  const final = seasonFinalOf({
    standings: ranked,
    remaining,
    scheduled,
    hasPostseason,
    champion: gold ? crownOf(gold) : NO_CROWN,
    ...(silver ? { silverChampion: crownOf(silver) } : {}),
    ourTeamId,
  });
  const leader = ranked[0];
  const place = ourTeamId ? ranked.findIndex((team) => team.id === ourTeamId) : -1;
  const mine = place >= 0 ? ranked[place] : undefined;
  return {
    played,
    scheduled,
    teams: teams.length,
    leader: leader && played > 0 ? displayName(leader.name) : null,
    final,
    bracketOpen: over && hasPostseason && final === null,
    ours: mine
      ? {
          name: displayName(mine.name),
          place: place + 1,
          of: ranked.length,
          record: recordText(mine),
          gold: hasCutLine ? place < cutoff : null,
        }
      : null,
  };
};

/** What the glance says of a season, a sentence a line. */
export const glanceLines = (glance: SeasonGlance): string[] => {
  const { final, ours } = glance;
  const goldLine =
    ours && ours.gold !== null
      ? [`${ours.name} ${ours.gold ? "made" : "missed"} the Gold bracket.`]
      : [];
  if (final) {
    return [
      `Regular season: ${final.leader} finished first.`,
      ...(final.champion ? [`Champion: ${final.champion}.`] : []),
      ...(final.silverChampion ? [`Silver champion: ${final.silverChampion}.`] : []),
      ...(final.ourTeam ? [final.ourTeam] : []),
      ...goldLine,
    ];
  }
  if (glance.scheduled === 0) {
    return [glance.teams > 0 ? `No games yet: ${glance.teams} teams.` : "No teams or games yet."];
  }
  if (glance.bracketOpen) {
    return [
      `Regular season: ${glance.leader ?? "nobody"} finished first.`,
      "The bracket's final has no score yet.",
      ...(ours ? [`${ours.name} finished ${ours.place} of ${ours.of}.`] : []),
      ...goldLine,
    ];
  }
  const ledBy = glance.leader ? `, led by ${glance.leader}` : "";
  const side = (gold: boolean | null) =>
    gold === null ? "" : `, ${gold ? "inside" : "outside"} the Gold line`;
  return [
    `In progress: ${glance.played} of ${glance.scheduled} played${ledBy}.`,
    ...(ours
      ? [`${ours.name}: ${ours.place} of ${ours.of} so far (${ours.record})${side(ours.gold)}.`]
      : []),
  ];
};

/**
 * Remembers each season's glance against the moment the season was last saved, so opening the
 * glance again works out only the seasons changed since: a season's stored data changes only with
 * a save, and every save that changes it moves its `updatedAt` (`storage.ts`). The creation time is
 * in the key because ids are given out again, and the followed team because choosing one is no save
 * of the season. One entry a season, so nothing builds up.
 */
export const glanceCache = () => {
  const held = new Map<string, { key: string; glance: SeasonGlance }>();
  return (
    meta: SeasonMeta,
    ourTeamId: string | null,
    read: (id: string) => SeasonSnapshot | null
  ): SeasonGlance | null => {
    const key = `${meta.createdAt}|${meta.updatedAt ?? ""}|${ourTeamId ?? ""}`;
    const kept = held.get(meta.id);
    if (kept?.key === key) return kept.glance;
    const season = read(meta.id);
    if (!season) return null;
    const glance = seasonGlance(season, ourTeamId);
    held.set(meta.id, { key, glance });
    return glance;
  };
};

export type GlanceGroup<T> = { stem: string; seasons: T[] };

const newestFirst = (
  a: Pick<SeasonMeta, "name" | "createdAt">,
  b: Pick<SeasonMeta, "name" | "createdAt">
): number => {
  const yearA = squadYearFromName(a.name) ?? -Infinity;
  const yearB = squadYearFromName(b.name) ?? -Infinity;
  if (yearA !== yearB) return yearB - yearA;
  return b.createdAt.localeCompare(a.createdAt);
};

/**
 * Seasons set side by side, one league's to a group: grouped by their names with the year taken
 * out (`seasonNameStem`), ignoring case, and each group newest first, by the squad year its name
 * gives and then by when it was made here. The groups follow their newest seasons in the same
 * order, and a group is named as its newest season's name has it.
 */
export const glanceGroups = <T extends { meta: Pick<SeasonMeta, "name" | "createdAt"> }>(
  rows: readonly T[]
): GlanceGroup<T>[] => {
  const groups = new Map<string, T[]>();
  [...rows]
    .sort((a, b) => newestFirst(a.meta, b.meta))
    .forEach((row) => {
      const key = seasonNameStem(row.meta.name).toLowerCase();
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    });
  return [...groups.values()].flatMap((seasons) => {
    const newest = seasons[0];
    return newest ? [{ stem: seasonNameStem(newest.meta.name), seasons }] : [];
  });
};
