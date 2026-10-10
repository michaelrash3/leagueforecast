import { normalizeDateInput } from "./date";
import { displayName } from "./format";
import type { ScoutLinkRow } from "./teamRankings";
import type { GameLog, Matchup, Settings, TeamBase } from "./types";
import { isFinal } from "./util";

/**
 * What is wrong with a League Standings season, or worth a look, as findings a commissioner can
 * act on (2.3): each with a stable code, a severity, what it is about, what to do, and a
 * fingerprint, so a finding put aside comes back when what it is about changes.
 *
 * The Dashboard used to carry a list of loose sentences from the forecast's own data check ("2
 * teams have no completed results"), with nothing to say which teams, how much it mattered or
 * what to do. These say all three, and the Dashboard keeps only their count.
 */

export type FindingSeverity = "attention" | "review" | "info";

/** Lower sorts first. */
export const SEVERITY_RANK: Record<FindingSeverity, number> = { attention: 0, review: 1, info: 2 };

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  attention: "Needs attention",
  review: "Worth reviewing",
  info: "Information",
};

export type FindingCode =
  | "too-few-teams"
  | "unknown-team"
  | "self-game"
  | "final-without-score"
  | "duplicate-game"
  | "scored-not-final"
  | "past-unplayed"
  | "missing-date"
  | "invalid-date"
  | "implausible-score"
  | "uneven-schedule"
  | "short-schedule"
  | "team-without-results"
  | "duplicate-team-name"
  | "cut-line"
  | "link-gone"
  | "link-shared"
  | "link-ambiguous";

/** Where a finding can be put right: a game's card, a team's panel, or a setting. */
export type FindingTarget =
  | { kind: "game"; id: string; label: string }
  | { kind: "team"; id: string; label: string }
  | {
      kind: "setting";
      id: "goldCutoff" | "regularSeasonGamesPerTeam" | "scoutLinks";
      label: string;
    };

/**
 * A repair the app can make itself. Each is explicit (a person presses it, after seeing what it
 * will do), goes through the season's undo, and says what it changed.
 */
export type FindingRepair =
  | { kind: "removeGames"; gameIds: string[] }
  | { kind: "markFinal"; gameIds: string[] }
  | { kind: "gamesPerTeam"; from: number; to: number };

export type Finding = {
  code: FindingCode;
  severity: FindingSeverity;
  summary: string;
  detail: string;
  /** What to do about it, in words. */
  suggestion: string;
  targets: FindingTarget[];
  /** Whether the forecast's numbers are less to be trusted while it stands. */
  affectsForecast: boolean;
  repair?: FindingRepair;
  /**
   * What the finding is about, as text: its code and the ids and values it was raised on. Put
   * aside, a finding stays aside only while this is unchanged.
   */
  fingerprint: string;
};

export type LeagueAuditInput = {
  teams: readonly TeamBase[];
  matchups: readonly Matchup[];
  logs: Readonly<Record<string, GameLog>>;
  settings: Settings;
  /** Who each league team is in Team Rankings, where the season is linked (`LeagueScoutBridge`). */
  links?: readonly ScoutLinkRow[];
  /** Today, which decides what is past. */
  today: Date;
};

/** Runs more than this on one side, or a win by more, is not a youth score anyone expects. */
export const IMPLAUSIBLE_RUNS = 40;
export const IMPLAUSIBLE_MARGIN = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days from today to an "M/D" date, read in whichever year puts it nearest to today: the dates
 * carry no year, and a season is played within a few months of now, so a March game seen in
 * February is next month's and one seen in October is this spring's. Null for no date.
 */
export const daysFromToday = (date: string, today: Date): number | null => {
  const normalized = normalizeDateInput(date);
  if (!normalized) return null;
  const [month, day] = normalized.split("/").map(Number);
  if (!month || !day) return null;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  let nearest: number | null = null;
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const days = Math.round((Date.UTC(year, month - 1, day) - start) / DAY_MS);
    if (nearest === null || Math.abs(days) < Math.abs(nearest)) nearest = days;
  }
  return nearest;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const runsOf = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
};

const sortedIds = (ids: Iterable<string>) => [...new Set(ids)].sort();

/** Every number a game's card takes: the runs, and the box score's hits, strikeouts, errors, walks. */
const ENTRY_FIELDS = [
  "awayRuns",
  "homeRuns",
  "awayHits",
  "homeHits",
  "awayK",
  "homeK",
  "awayErrors",
  "homeErrors",
  "awayWalksAllowed",
  "homeWalksAllowed",
] as const satisfies readonly (keyof GameLog)[];

/**
 * Whether anything has been entered on a game's card: marked final, or any of its numbers typed
 * in, a box score without runs included. Not the innings, which every card is given from the
 * league's setting, so it says nothing of whether anyone has touched the game.
 */
const hasEntries = (log: GameLog | undefined) =>
  isFinal(log) || ENTRY_FIELDS.some((field) => Boolean(log?.[field]?.trim()));

/** A game's pair and day, whichever side is home: what two copies of it share. Null undated. */
const fixtureOf = (game: Matchup) => {
  const date = normalizeDateInput(game.date);
  if (!date || game.away === game.home) return null;
  return `${[game.away, game.home].sort().join("~")}@${date}`;
};

export const auditLeague = ({
  teams,
  matchups,
  logs,
  settings,
  links = [],
  today,
}: LeagueAuditInput): Finding[] => {
  const findings: Finding[] = [];
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const nameOf = (id: string) => displayName(teamById.get(id)?.name || id);
  const gameLabel = (game: Matchup) =>
    `${nameOf(game.away)} at ${nameOf(game.home)}${
      normalizeDateInput(game.date) ? `, ${normalizeDateInput(game.date)}` : ""
    }`;
  const gameTarget = (game: Matchup): FindingTarget => ({
    kind: "game",
    id: game.id,
    label: gameLabel(game),
  });
  const teamTarget = (id: string): FindingTarget => ({ kind: "team", id, label: nameOf(id) });
  const add = (finding: Omit<Finding, "fingerprint">, values: readonly (string | number)[] = []) =>
    findings.push({
      ...finding,
      fingerprint: [
        finding.code,
        ...sortedIds(finding.targets.map((target) => `${target.kind}:${target.id}`)),
        ...values.map(String),
      ].join("|"),
    });

  /*
   * One team, not none: a season with no teams yet is one being set up, which the season builder
   * on the Dashboard is already walking through, and a warning there would only be noise.
   */
  if (teams.length === 1) {
    add({
      code: "too-few-teams",
      severity: "attention",
      summary: "Only one team",
      detail: "The forecast compares teams, so it needs at least two to say anything.",
      suggestion: "Add teams in Settings, or import a schedule.",
      targets: [],
      affectsForecast: true,
    });
  }

  // ---------- Games that cannot be counted as they stand ----------

  const unknown = matchups.filter((game) => !teamById.has(game.away) || !teamById.has(game.home));
  if (unknown.length) {
    add({
      code: "unknown-team",
      severity: "attention",
      summary: `${plural(unknown.length, "game")} with a team not on the roster`,
      detail:
        "A game naming a team that is not in the season is left out of the standings and the forecast.",
      suggestion: "Delete the game, or add the team it names.",
      targets: unknown.map(gameTarget),
      affectsForecast: true,
    });
  }
  const selfGames = matchups.filter((game) => game.away === game.home);
  if (selfGames.length) {
    add({
      code: "self-game",
      severity: "attention",
      summary: `${plural(selfGames.length, "game")} of a team against itself`,
      detail: "A team cannot play itself; such a game counts as both a win and a loss for it.",
      suggestion: "Change one of the two teams, or delete the game.",
      targets: selfGames.map(gameTarget),
      affectsForecast: true,
    });
  }

  const blankFinals = matchups.filter((game) => {
    const log = logs[game.id];
    return (
      isFinal(log) && (runsOf(log?.awayRuns ?? "") === null || runsOf(log?.homeRuns ?? "") === null)
    );
  });
  if (blankFinals.length) {
    add(
      {
        code: "final-without-score",
        severity: "attention",
        summary: `${plural(blankFinals.length, "game")} marked final without both scores`,
        detail:
          "A final with a score missing is counted as if the missing side scored nothing, which can turn it into a shutout or a 0-0 tie.",
        suggestion: "Enter both scores, or mark the game as scheduled again.",
        targets: blankFinals.map(gameTarget),
        affectsForecast: true,
      },
      blankFinals.map((game) => `${logs[game.id]?.awayRuns ?? ""}-${logs[game.id]?.homeRuns ?? ""}`)
    );
  }

  // ---------- The same game twice ----------

  /*
   * A league date carries no time, so two games of one pair on one day are a copy (a schedule
   * imported twice, a game added by hand that was already there) or a doubleheader, and nothing on
   * the schedule says which. So this never needs attention, which could not be put aside: the
   * commissioner knows which it is. Finals with different scores are two games played, and read as
   * a doubleheader. Finals with one score are how one game entered twice looks, and count twice if
   * it is; and a copy not yet final is played by the forecast as a game still to come, a game too
   * many left for each team. Either way the forecast is affected until someone says which it is.
   */
  const runsFor = (game: Matchup, team: string) => {
    const value = (game.away === team ? logs[game.id]?.awayRuns : logs[game.id]?.homeRuns) ?? "";
    return runsOf(value) ?? value.trim();
  };
  const byFixture = new Map<string, Matchup[]>();
  matchups.forEach((game) => {
    const key = fixtureOf(game);
    if (key) byFixture.set(key, [...(byFixture.get(key) ?? []), game]);
  });
  byFixture.forEach((copies) => {
    const first = copies[0];
    if (!first || copies.length < 2) return;
    const entered = copies.filter((game) => hasEntries(logs[game.id]));
    const finals = copies.filter((game) => isFinal(logs[game.id]));
    const sameScore = (a: Matchup, b: Matchup) =>
      runsFor(a, first.away) === runsFor(b, first.away) &&
      runsFor(a, first.home) === runsFor(b, first.home);
    const repeated = finals.filter((game) =>
      finals.some((other) => other !== game && sameScore(game, other))
    );
    const doubleheader = finals.length === copies.length && repeated.length === 0;
    /*
     * Offered only where nothing entered would go: with at most one copy given anything, a box
     * score without runs included, that one is kept and the rest have nothing at all on them.
     * With more, which is the real game is a person's call.
     */
    const keep = entered[0] ?? copies[0];
    const removable = copies.filter((game) => game !== keep);
    const repair =
      removable.length && entered.length <= 1
        ? { kind: "removeGames" as const, gameIds: removable.map((game) => game.id) }
        : undefined;
    add(
      {
        code: "duplicate-game",
        severity: doubleheader ? "info" : "review",
        summary: doubleheader
          ? `${nameOf(first.away)} and ${nameOf(first.home)} played ${copies.length} games on ${normalizeDateInput(first.date)}`
          : `${gameLabel(first)} is on the schedule ${copies.length} times`,
        detail: doubleheader
          ? "Finals with different scores read as a doubleheader, which needs nothing done. If one is a copy given a wrong score, it counts as a game of its own."
          : repeated.length
            ? "Finals with the same score are how one game entered twice looks, and then it counts more than once in the standings. A doubleheader can end the same way twice, and then nothing is wrong."
            : "A schedule imported twice leaves copies like this, and the forecast plays each copy not yet final as a game still to come. If the two teams play a doubleheader that day, nothing is wrong.",
        suggestion: doubleheader
          ? "Nothing, if they played twice that day; otherwise delete the copy that is not the real game."
          : repair
            ? "Delete the extra copies, or put this aside if it is a doubleheader."
            : "Open each copy and delete the ones that are not the real game, or put this aside if it is a doubleheader.",
        targets: copies.map(gameTarget),
        affectsForecast: !doubleheader,
        ...(repair ? { repair } : {}),
      },
      /*
       * Put aside as a doubleheader, it stays aside as its games are played, and comes back only
       * if two finals turn out with one score, which is the copy it was taken not to be.
       */
      [repeated.length]
    );
  });

  // ---------- Dates ----------

  const undated = matchups.filter((game) => !(game.date ?? "").trim());
  if (undated.length) {
    add({
      code: "missing-date",
      severity: "info",
      summary: `${plural(undated.length, "game")} without a date`,
      detail:
        "An undated game counts, but it is placed last when results are put in order, so recent form and the trend line read it as the newest.",
      suggestion: "Add the date on each game's card.",
      targets: undated.map(gameTarget),
      affectsForecast: false,
    });
  }
  const unreadable = matchups.filter(
    (game) => (game.date ?? "").trim() && !normalizeDateInput(game.date)
  );
  if (unreadable.length) {
    add(
      {
        code: "invalid-date",
        severity: "review",
        summary: `${plural(unreadable.length, "game")} with a date that cannot be read`,
        detail: "These are treated as having no date at all. The app reads dates as M/D.",
        suggestion: "Retype the date on each game's card as M/D, for example 5/3.",
        targets: unreadable.map(gameTarget),
        affectsForecast: false,
      },
      unreadable.map((game) => game.date)
    );
  }

  // ---------- Past games not finished ----------

  const past = matchups.filter((game) => {
    if (isFinal(logs[game.id])) return false;
    const days = daysFromToday(game.date, today);
    return days !== null && days < 0;
  });
  const scoredNotFinal = past.filter((game) => {
    const log = logs[game.id];
    return runsOf(log?.awayRuns ?? "") !== null && runsOf(log?.homeRuns ?? "") !== null;
  });
  if (scoredNotFinal.length) {
    add(
      {
        code: "scored-not-final",
        severity: "attention",
        summary: `${plural(scoredNotFinal.length, "past game")} scored but not marked final`,
        detail:
          "A score counts only once its game is marked final, so these are not in the standings or the forecast yet.",
        suggestion: "Check each score, then mark the game final.",
        targets: scoredNotFinal.map(gameTarget),
        affectsForecast: true,
        repair: { kind: "markFinal", gameIds: scoredNotFinal.map((game) => game.id) },
      },
      scoredNotFinal.map((game) => `${logs[game.id]?.awayRuns}-${logs[game.id]?.homeRuns}`)
    );
  }
  const unplayed = past.filter((game) => !scoredNotFinal.includes(game));
  if (unplayed.length) {
    add({
      code: "past-unplayed",
      severity: "review",
      summary: `${plural(unplayed.length, "past game")} still without a score`,
      detail:
        "Their dates have gone by, so the forecast still treats them as games to come. A rained-out game can stay; one that was played wants its score.",
      suggestion:
        "Enter the score, change the date if it was moved, or delete it if it was cancelled.",
      targets: unplayed.map(gameTarget),
      affectsForecast: true,
    });
  }

  // ---------- Scores ----------

  const implausible = matchups.filter((game) => {
    const log = logs[game.id];
    if (!isFinal(log)) return false;
    const away = runsOf(log?.awayRuns ?? "");
    const home = runsOf(log?.homeRuns ?? "");
    if (away === null || home === null) return false;
    return (
      away > IMPLAUSIBLE_RUNS ||
      home > IMPLAUSIBLE_RUNS ||
      Math.abs(away - home) > IMPLAUSIBLE_MARGIN
    );
  });
  if (implausible.length) {
    add(
      {
        code: "implausible-score",
        severity: "review",
        summary: `${plural(implausible.length, "final")} with an unusual score`,
        detail: `More than ${IMPLAUSIBLE_RUNS} runs on one side, or a win by more than ${IMPLAUSIBLE_MARGIN}, is more often a typo than a game. The run differential cap limits what each counts for.`,
        suggestion: "Check each score against the scorebook.",
        targets: implausible.map(gameTarget),
        affectsForecast: false,
      },
      implausible.map((game) => `${logs[game.id]?.awayRuns}-${logs[game.id]?.homeRuns}`)
    );
  }

  // ---------- The schedule ----------

  const known = matchups.filter(
    (game) => teamById.has(game.away) && teamById.has(game.home) && game.away !== game.home
  );
  const scheduled = new Map(teams.map((team) => [team.id, 0]));
  const completed = new Map(teams.map((team) => [team.id, 0]));
  known.forEach((game) => {
    for (const id of [game.away, game.home]) {
      scheduled.set(id, (scheduled.get(id) ?? 0) + 1);
      if (isFinal(logs[game.id])) completed.set(id, (completed.get(id) ?? 0) + 1);
    }
  });
  const counts = [...scheduled.values()];
  const most = counts.length ? Math.max(...counts) : 0;
  const fewest = counts.length ? Math.min(...counts) : 0;
  if (teams.length >= 2 && most > 0 && most - fewest >= 2) {
    const short = teams.filter((team) => (scheduled.get(team.id) ?? 0) === fewest);
    add(
      {
        code: "uneven-schedule",
        severity: "info",
        summary: `The schedule gives teams ${fewest} to ${most} games`,
        detail:
          "Standings go by winning percentage, so an uneven schedule still ranks fairly, but a team with fewer games has fewer chances to move.",
        suggestion: "Check for games missing from the schedule.",
        targets: short.map((team) => teamTarget(team.id)),
        affectsForecast: false,
      },
      [fewest, most]
    );
  }
  const perTeam = Math.max(0, Math.round(settings.regularSeasonGamesPerTeam || 0));
  if (perTeam > 0 && teams.length >= 2) {
    const shortOfSetting = teams.filter((team) => (scheduled.get(team.id) ?? 0) < perTeam);
    if (shortOfSetting.length) {
      const even = fewest === most && most > 0;
      add(
        {
          code: "short-schedule",
          severity: "review",
          summary: `${plural(shortOfSetting.length, "team")} with fewer games scheduled than the ${perTeam} per team set`,
          detail:
            "Clinching and elimination count the games each team has left from that setting, so games that are not on the schedule hold them back.",
          suggestion: even
            ? `Set games per team to ${most}, what the schedule has, or add the missing games.`
            : "Add the missing games, or change games per team in Settings.",
          targets: [
            { kind: "setting", id: "regularSeasonGamesPerTeam", label: "Games per team" },
            ...shortOfSetting.map((team) => teamTarget(team.id)),
          ],
          affectsForecast: true,
          ...(even ? { repair: { kind: "gamesPerTeam" as const, from: perTeam, to: most } } : {}),
        },
        [perTeam, fewest, most]
      );
    }
  }

  const finalsPlayed = [...completed.values()];
  const playedMedian = finalsPlayed.length
    ? ([...finalsPlayed].sort((a, b) => a - b)[Math.floor(finalsPlayed.length / 2)] ?? 0)
    : 0;
  const withoutResults = teams.filter((team) => (completed.get(team.id) ?? 0) === 0);
  if (withoutResults.length && finalsPlayed.some((count) => count > 0)) {
    add({
      code: "team-without-results",
      severity: playedMedian >= 3 ? "review" : "info",
      summary: `${plural(withoutResults.length, "team")} without a final yet`,
      detail:
        "The forecast knows nothing of a team until it has a result, so it rates it as the league average.",
      suggestion: "Enter its scores as games are played.",
      targets: withoutResults.map((team) => teamTarget(team.id)),
      affectsForecast: true,
    });
  }

  // ---------- Teams ----------

  const byName = new Map<string, TeamBase[]>();
  teams.forEach((team) => {
    const key = team.name.trim().replace(/\s+/g, " ").toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), team]);
  });
  byName.forEach((same) => {
    if (same.length < 2) return;
    add({
      code: "duplicate-team-name",
      severity: "review",
      summary: `${plural(same.length, "team")} called ${displayName(same[0]?.name ?? "")}`,
      detail:
        "Two teams of one name are two teams to the app, each with its own record, which is right for two squads of one club and wrong for one team entered twice.",
      suggestion: "Rename one, or move the games of a team entered twice onto the other.",
      targets: same.map((team) => teamTarget(team.id)),
      affectsForecast: false,
    });
  });

  // ---------- The format ----------

  if (
    settings.postseasonFormat === "cut" &&
    teams.length >= 2 &&
    (settings.goldCutoff < 1 || settings.goldCutoff >= teams.length)
  ) {
    add(
      {
        code: "cut-line",
        severity: "attention",
        summary: `A Gold cut line of ${settings.goldCutoff} with ${plural(teams.length, "team")}`,
        detail:
          "With the cut line there, every team is in or every team is out, so Gold odds and clinching say nothing.",
        suggestion: "Set the Gold cut line between 1 and one fewer than the number of teams.",
        targets: [{ kind: "setting", id: "goldCutoff", label: "Gold cut line" }],
        affectsForecast: true,
      },
      [settings.goldCutoff, teams.length]
    );
  }

  // ---------- Links to Team Rankings ----------

  const scoutTarget: FindingTarget = {
    kind: "setting",
    id: "scoutLinks",
    label: "Team Rankings links",
  };
  const gone = links.filter((row) => row.staleScoutTeamId);
  if (gone.length) {
    add(
      {
        code: "link-gone",
        severity: "review",
        summary: `${plural(gone.length, "team")} linked to a club Team Rankings no longer has`,
        detail:
          "The club picked for each was merged away or deleted, so none of its tournament results reach the forecast.",
        suggestion: "Pick the club again under Team Rankings links in Settings.",
        targets: [scoutTarget, ...gone.map((row) => teamTarget(row.leagueTeamId))],
        affectsForecast: settings.useScoutResults,
      },
      gone.map((row) => row.staleScoutTeamId ?? "")
    );
  }
  const shared = links.filter((row) => row.conflictWith?.length);
  if (shared.length) {
    add({
      code: "link-shared",
      severity: settings.useScoutResults ? "attention" : "review",
      summary: `${plural(shared.length, "team")} linked to the same club as another`,
      detail:
        "One club's tournament results go to every league team linked to it, so they are counted more than once.",
      suggestion: "Give each league team its own club under Team Rankings links in Settings.",
      targets: [scoutTarget, ...shared.map((row) => teamTarget(row.leagueTeamId))],
      affectsForecast: settings.useScoutResults,
    });
  }
  const ambiguous = links.filter(
    (row) => row.how !== "picked" && row.how !== "off" && (row.ambiguousCount ?? 0) > 1
  );
  if (ambiguous.length) {
    add(
      {
        code: "link-ambiguous",
        severity: "info",
        summary: `${plural(ambiguous.length, "team")} whose name more than one club in Team Rankings carries`,
        detail:
          "The link is a guess from the name, so the results that reach the forecast may be another club's.",
        suggestion: "Pick the right club under Team Rankings links in Settings.",
        targets: [scoutTarget, ...ambiguous.map((row) => teamTarget(row.leagueTeamId))],
        affectsForecast: false,
      },
      ambiguous.map((row) => `${row.leagueTeamId}:${row.scoutTeamId ?? ""}`)
    );
  }

  return findings.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code)
  );
};

/** What each severity counts, for the Dashboard and a tab's badge. */
export const severityCounts = (findings: readonly Finding[]) => {
  const counts: Record<FindingSeverity, number> = { attention: 0, review: 0, info: 0 };
  findings.forEach((finding) => {
    counts[finding.severity] += 1;
  });
  return counts;
};

/**
 * Findings put aside, by fingerprint, with the severity each had then. One comes back when what it
 * is about changes (its fingerprint) or it grows more serious; one that needs attention is never
 * put aside at all.
 */
export type Dismissals = Readonly<Record<string, FindingSeverity>>;

export const canDismiss = (finding: Finding) => finding.severity !== "attention";

export const isDismissed = (finding: Finding, dismissals: Dismissals): boolean => {
  if (!canDismiss(finding)) return false;
  const was = dismissals[finding.fingerprint];
  return was !== undefined && SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[was];
};

/** What a repair will do, line by line, for the preview shown before it is made. */
export const repairPreview = (
  repair: FindingRepair,
  { teams, matchups, logs }: Pick<LeagueAuditInput, "teams" | "matchups" | "logs">
): string[] => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const nameOf = (id: string) => displayName(teamById.get(id)?.name || id);
  const gameById = new Map(matchups.map((game) => [game.id, game]));
  const label = (id: string) => {
    const game = gameById.get(id);
    if (!game) return id;
    const date = normalizeDateInput(game.date);
    return `${nameOf(game.away)} at ${nameOf(game.home)}${date ? `, ${date}` : ""}`;
  };
  switch (repair.kind) {
    case "removeGames":
      return repair.gameIds.map((id) => `Delete ${label(id)} (nothing entered).`);
    case "markFinal":
      return repair.gameIds.map(
        (id) =>
          `Mark ${label(id)} final at ${logs[id]?.awayRuns ?? ""}-${logs[id]?.homeRuns ?? ""}.`
      );
    case "gamesPerTeam":
      return [`Change games per team from ${repair.from} to ${repair.to}.`];
  }
};

/**
 * The copies "Delete the extra copies" deletes, worked out again from the season as it stands when
 * the repair is made rather than as the finding saw it, since League kept live takes in another
 * device's edits while the question is open. A copy goes only if it is still there with nothing
 * entered on it, and never as the last copy of its game, whichever copy the finding meant to keep:
 * that one deleted elsewhere meanwhile leaves the game on the schedule once, not off it.
 */
export const copiesToDelete = (
  gameIds: readonly string[],
  { matchups, logs }: Pick<LeagueAuditInput, "matchups" | "logs">
): string[] => {
  const copiesLeft = new Map<string, number>();
  matchups.forEach((game) => {
    const fixture = fixtureOf(game);
    if (fixture) copiesLeft.set(fixture, (copiesLeft.get(fixture) ?? 0) + 1);
  });
  const gameById = new Map(matchups.map((game) => [game.id, game]));
  return gameIds.filter((id) => {
    const game = gameById.get(id);
    const fixture = game ? fixtureOf(game) : null;
    const left = fixture ? (copiesLeft.get(fixture) ?? 0) : 0;
    if (!fixture || left < 2 || hasEntries(logs[id])) return false;
    copiesLeft.set(fixture, left - 1);
    return true;
  });
};

/** Whether a repair takes something away, and so asks to be confirmed. */
export const repairIsDestructive = (repair: FindingRepair) => repair.kind === "removeGames";
