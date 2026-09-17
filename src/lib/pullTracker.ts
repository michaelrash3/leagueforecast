import { csvEscape, csvSection } from "./csv";
import {
  GC_FETCH_ERROR_REASONS,
  ageLevelFromName,
  gcTeamPageUrl,
  type GcFetchErrorReason,
  type GcTeamResponse,
} from "./gameChangerApi";
import type { GcHoldSource } from "./gameChangerClient";
import type { GcImportOutcome, PoolTidy } from "./gameChangerImport";

/**
 * A record of what a pull actually did, kept while it runs and downloadable afterwards.
 *
 * A nationwide pull is fifty thousand teams and the better part of an hour, and it happens once.
 * Afterwards somebody has to answer questions about it — why nine thousand teams have no age
 * level, whether the failures were a WAF or GameChanger being down, whether the hour was spent
 * fetching or waiting — and the evidence for all of it exists only while the run is going. The
 * pool that survives says what landed, never what did not, and never why.
 *
 * So this writes it down as it happens. Two rules shape the whole module:
 *
 * The first is that it must not cost anything. Everything recorded per team is a field assignment
 * or an integer; anything that would walk the pool, format a date or build a string fifty thousand
 * times is recorded once per flush instead, or worked out at the end from what was kept. Strings
 * that repeat — a WAF's challenge page is the same two hundred and fifty characters on every
 * blocked team — are interned, so forty thousand rows carry a small integer rather than the
 * sentence.
 *
 * The second is that it must not be able to break the run. Nothing here throws: a tracker that
 * takes the pull down with it has destroyed the thing it was measuring.
 */

/** Bumped when a column's meaning changes, so an old file cannot be read as a new one. */
export const PULL_TRACKER_VERSION = 1;

/**
 * What became of one id. Every id the run was asked for has exactly one of these, including the
 * ones it never reached — a row that is missing and a row that says "never attempted" look the
 * same in a count, and they mean completely different things.
 */
export type PullOutcome =
  /** Fetched and filed into the pool. */
  | "filed"
  /** Fetched, and the importer had nowhere to put it. */
  | "skipped"
  /** Failed for a reason the run recorded; the Retry button asks again. */
  | "failed"
  /** Fetched, but the save that would have kept it never landed. */
  | "fetched-not-saved"
  /** Refused after the give-up and deliberately not settled; a resume asks again. */
  | "left-unsettled"
  /** The run ended before a worker ever claimed it. */
  | "never-attempted";

/** One id's row. Every field optional but the id: a team that was never reached knows nothing. */
export type TrackedTeam = {
  teamId: string;
  /** Arrival order, so rows can be put back in the order the run saw them. */
  seq?: number;
  /** Which pass of `run()` wrote this row — a Retry or a Resume is a new one. */
  segment?: number;
  /** Seconds from the start of the run. The shape of the failures over the hour. */
  second?: number;
  /** The save this id survived in; blank means it was fetched and never written. */
  flush?: number;
  name?: string;

  // ---- the fetch side
  ok?: boolean;
  reason?: GcFetchErrorReason;
  status?: number;
  /** Which of the two upstream calls died: the team's profile, or its games. */
  failedOn?: "profile" | "games";
  contentType?: string;
  retryAfter?: string;
  /** Index into the log's `messages`, rather than the sentence on every row. */
  message?: number;
  attempts?: number;
  firstFailure?: GcFetchErrorReason;

  // ---- what GameChanger said the team was
  /** `age_group` verbatim: "9U", "11U/12U", "2027", or nothing at all. */
  ageLabel?: string;
  ageLevel?: number;
  /** An age label in the team's own name, which is the fallback when the label says nothing. */
  nameAge?: number;
  /** A four-digit year in the name — a graduation year, or a season the club wrote in. */
  nameYear?: number;
  season?: string;
  squadYear?: number;
  /** What the pasted list claimed the level was, when it claimed one. */
  listAge?: number;

  // ---- the import side
  poolTeamId?: string;
  ageGroupId?: string;
  newPage?: boolean;
  newTeam?: boolean;
  gamesAdded?: number;
  gamesUpdated?: number;
  gamesUnchanged?: number;
  gamesIgnored?: number;
  gamesOutOfSeason?: number;
  oppCreated?: number;
  oppByAvatar?: number;
  oppByName?: number;
  /** The level the opponents settled, when the team itself named none. */
  oppAge?: number;
  /** Why the schedule could not be filed, when it could not. */
  issue?: string;
};

/** One save: the whole story of how the run behaved over the hour, at a hundredth the cost. */
export type PullFlushSample = {
  flush: number;
  /** Seconds into the run. */
  second: number;
  /** Teams written in this save. */
  teams: number;
  /** Teams settled in the cursor after it. */
  settled: number;
  poolTeams: number;
  poolGames: number;
  poolPages: number;
  /** How long the save itself took, start to acknowledged. */
  ms: number;
  ok: boolean;
};

/** One pass of the run loop: a first go, a resume, or a retry. */
export type PullSegment = {
  segment: number;
  startedAt: string;
  endedAt?: string;
  /** How many ids this pass was handed. */
  asked: number;
  endReason?: PullEndReason;
};

export type PullEndReason =
  "finished" | "stopped" | "save-refused" | "gave-up" | "running" | "unknown";

/** A failure worth keeping the body of: the first of each distinct shape, and how many followed. */
export type PullSample = {
  reason: GcFetchErrorReason;
  status?: number;
  contentType?: string;
  failedOn?: "profile" | "games";
  retryAfter?: string;
  /** The first two hundred characters of what came back. A WAF page reads unmistakably. */
  body?: string;
  count: number;
};

/** What the paste turned into, before the run was asked for a single id. */
export type PullPaste = {
  /** Lines in what was pasted. */
  lines: number;
  /** Lines that parsed into an id. */
  parsed: number;
  /** Lines that did not, and the first few of them verbatim. */
  skipped: number;
  skippedSamples: string[];
  /** Ids dropped as too young to rank. */
  tooYoung: number;
  /** Ids already in the pool, so not fresh. */
  alreadyHere: number;
  /** Ids the run was actually handed. */
  asked: number;
};

export type PullRunLog = {
  version: number;
  startedAt: string;
  /** When the last schedule landed, as against when the tidy after it finished. */
  fetchEndedAt?: string;
  endedAt?: string;
  endReason: PullEndReason;
  segments: PullSegment[];
  paste?: PullPaste;
  /** Every id the run was asked for, so a row can be emitted for the ones never reached. */
  ids: string[];
  teams: TrackedTeam[];
  flushes: PullFlushSample[];
  /** Saves that were refused outright. Any at all and the run stopped. */
  flushFailures: number;
  /** How often each failure reason was seen. Seeded with every reason, so a zero is a zero. */
  reasons: Record<string, number>;
  /** Blocked answers seen, including the ones the give-up suppressed. */
  blocked: number;
  suppressed: number;
  refusals: number;
  gaveUpAtSecond?: number;
  holds: number;
  heldMs: number;
  longestHoldMs: number;
  /** Holds by who asked for them: GameChanger naming a wait, our ladder, or a refused route. */
  holdsBySource: Record<string, number>;
  /** Milliseconds the tab spent hidden, which is the other explanation for a slow hour. */
  hiddenMs: number;
  hiddenSpells: number;
  messages: string[];
  samples: PullSample[];
  /** What the panel told the user it would take, so the guess can be scored. */
  etaMinutes?: number;
  config: Record<string, number>;
  tidy?: Omit<PoolTidy, "state">;
  /** Whether every row in this log reached storage, or only memory. */
  persisted: boolean;
};

/** A four-digit year inside a team name: "Warriors Spring 2027", "2029 Bandits". */
const NAME_YEAR = /\b(20[2-4]\d)\b/;

export const yearFromName = (name: string): number | undefined => {
  const match = NAME_YEAR.exec(name);
  return match ? Number(match[1]) : undefined;
};

/** Which upstream call a failing URL belongs to. Two words instead of sixty characters a row. */
export const failedOnFromUrl = (url: string | undefined): "profile" | "games" | undefined => {
  if (!url) return undefined;
  return /\/games(?:\?|$)/.test(url) ? "games" : "profile";
};

const emptyReasons = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  // Seeded from the list rather than written out, so a reason added later cannot go uncounted.
  GC_FETCH_ERROR_REASONS.forEach((reason) => {
    counts[reason] = 0;
  });
  return counts;
};

export const emptyPullRunLog = (startedAt: string): PullRunLog => ({
  version: PULL_TRACKER_VERSION,
  startedAt,
  endReason: "running",
  segments: [],
  ids: [],
  teams: [],
  flushes: [],
  flushFailures: 0,
  reasons: emptyReasons(),
  blocked: 0,
  suppressed: 0,
  refusals: 0,
  holds: 0,
  heldMs: 0,
  longestHoldMs: 0,
  holdsBySource: {},
  hiddenMs: 0,
  hiddenSpells: 0,
  messages: [],
  samples: [],
  config: {},
  persisted: true,
});

/** Collapses whitespace, so a message with a newline in it cannot break a row. */
const flat = (value: string): string => value.replace(/\s+/g, " ").trim();

const MAX_SAMPLES = 20;
const MAX_BODY = 200;
const MAX_SKIPPED_SAMPLES = 20;

export type PullTracker = {
  /** The record as it stands, for saving or for building the files. */
  log: () => PullRunLog;
  /** A new pass of the run loop — a first go, a Resume, or a Retry. */
  beginSegment: (startedAt: string, ids: string[]) => number;
  endSegment: (endedAt: string, reason: PullEndReason) => void;
  /** What the paste turned into before any of it was asked for. */
  paste: (paste: PullPaste) => void;
  /** One team's answer, as it lands. The hot path: assignments and integers only. */
  answered: (entry: {
    teamId: string;
    result: GcTeamResponse;
    attempts?: number;
    firstFailure?: GcFetchErrorReason;
    listAge?: number;
  }) => void;
  /** What the importer made of a schedule that arrived. */
  imported: (outcome: GcImportOutcome) => void;
  /** Everything settled in one save, and how it went. */
  flushed: (sample: PullFlushSample, teamIds: readonly string[]) => void;
  hold: (ms: number, source: GcHoldSource) => void;
  blocked: () => void;
  suppressed: (teamId: string) => void;
  gaveUp: (refusals: number, second: number) => void;
  hidden: (ms: number) => void;
  eta: (minutes: number) => void;
  config: (config: Record<string, number>) => void;
  tidied: (tidy: Omit<PoolTidy, "state">) => void;
  /** Marks the log as memory-only, because a save of it was refused. */
  unpersisted: () => void;
  finish: (endedAt: string, reason: PullEndReason) => void;
  fetchEnded: (at: string) => void;
};

/**
 * Starts recording. `now` is injected rather than read, so a test can drive the clock and so the
 * whole module stays free of the one thing that makes a record impossible to reproduce.
 */
export const createPullTracker = (
  startedAt: string,
  now: () => number = () => Date.now()
): PullTracker => {
  const log = emptyPullRunLog(startedAt);
  const t0 = now();
  const rows = new Map<string, TrackedTeam>();
  const messageIndex = new Map<string, number>();
  const sampleIndex = new Map<string, PullSample>();
  let seq = 0;
  let segment = 0;

  const second = (): number => Math.round((now() - t0) / 1000);

  const row = (teamId: string): TrackedTeam => {
    const found = rows.get(teamId);
    if (found) return found;
    const made: TrackedTeam = { teamId };
    rows.set(teamId, made);
    return made;
  };

  const intern = (message: string): number => {
    const text = flat(message);
    const known = messageIndex.get(text);
    if (known !== undefined) return known;
    const at = log.messages.length;
    log.messages.push(text);
    messageIndex.set(text, at);
    return at;
  };

  const sample = (entry: PullSample): void => {
    const key = `${entry.reason}|${entry.status ?? ""}|${entry.contentType ?? ""}|${entry.failedOn ?? ""}`;
    const known = sampleIndex.get(key);
    if (known) {
      known.count += 1;
      return;
    }
    // Past the cap the shapes are already all here; counting an unbounded tail of them would only
    // grow the file with rows nobody reads.
    if (sampleIndex.size >= MAX_SAMPLES) return;
    sampleIndex.set(key, entry);
    log.samples.push(entry);
  };

  return {
    log: () => {
      log.teams = [...rows.values()];
      return log;
    },

    beginSegment: (at, ids) => {
      segment += 1;
      log.segments.push({ segment, startedAt: at, asked: ids.length });
      ids.forEach((teamId) => {
        if (!log.ids.includes(teamId)) log.ids.push(teamId);
      });
      return segment;
    },

    endSegment: (at, reason) => {
      const current = log.segments[log.segments.length - 1];
      if (!current) return;
      current.endedAt = at;
      current.endReason = reason;
    },

    paste: (paste) => {
      log.paste = { ...paste, skippedSamples: paste.skippedSamples.slice(0, MAX_SKIPPED_SAMPLES) };
    },

    answered: ({ teamId, result, attempts, firstFailure, listAge }) => {
      const entry = row(teamId);
      seq += 1;
      entry.seq = seq;
      entry.segment = segment;
      entry.second = second();
      entry.ok = result.ok;
      if (attempts !== undefined) entry.attempts = attempts;
      if (firstFailure) entry.firstFailure = firstFailure;
      if (listAge !== undefined) entry.listAge = listAge;

      if (result.ok) {
        const profile = result.schedule.profile;
        entry.name = profile.name;
        if (profile.ageLabel) entry.ageLabel = profile.ageLabel;
        if (profile.ageLevel !== undefined) entry.ageLevel = profile.ageLevel;
        const fromName = ageLevelFromName(profile.name);
        if (fromName !== undefined) entry.nameAge = fromName;
        const year = yearFromName(profile.name);
        if (year !== undefined) entry.nameYear = year;
        if (profile.season) entry.season = `${profile.season.season} ${profile.season.year}`;
        return;
      }

      entry.reason = result.reason;
      log.reasons[result.reason] = (log.reasons[result.reason] ?? 0) + 1;
      if (result.status !== undefined) entry.status = result.status;
      if (result.message) entry.message = intern(result.message);
      const diagnostics = result.diagnostics;
      if (!diagnostics) return;
      const failedOn = failedOnFromUrl(diagnostics.url);
      if (failedOn) entry.failedOn = failedOn;
      if (diagnostics.contentType) entry.contentType = diagnostics.contentType;
      if (diagnostics.retryAfter) entry.retryAfter = diagnostics.retryAfter;
      sample({
        reason: result.reason,
        ...(result.status === undefined ? {} : { status: result.status }),
        ...(diagnostics.contentType ? { contentType: diagnostics.contentType } : {}),
        ...(failedOn ? { failedOn } : {}),
        ...(diagnostics.retryAfter ? { retryAfter: diagnostics.retryAfter } : {}),
        ...(diagnostics.bodyPreview
          ? { body: flat(diagnostics.bodyPreview).slice(0, MAX_BODY) }
          : {}),
        count: 1,
      });
    },

    imported: (outcome) => {
      const entry = row(outcome.gcTeamId);
      entry.poolTeamId = outcome.teamId;
      entry.ageGroupId = outcome.ageGroupId;
      if (outcome.createdAgeGroup) entry.newPage = true;
      if (outcome.createdTeam) entry.newTeam = true;
      entry.gamesAdded = outcome.gamesAdded;
      entry.gamesUpdated = outcome.gamesUpdated;
      entry.gamesUnchanged = outcome.gamesUnchanged;
      entry.gamesIgnored = outcome.gamesIgnored;
      entry.gamesOutOfSeason = outcome.gamesOutOfSeason;
      entry.oppCreated = outcome.opponentsCreated;
      entry.oppByAvatar = outcome.opponentsMatchedByAvatar;
      entry.oppByName = outcome.opponentsMatchedByName;
      if (outcome.ageFromOpponents !== undefined) entry.oppAge = outcome.ageFromOpponents;
      if (outcome.issue) entry.issue = outcome.issue;
    },

    flushed: (flushSample, teamIds) => {
      log.flushes.push(flushSample);
      if (!flushSample.ok) log.flushFailures += 1;
      // Stamped only on a save that landed: a flush number on a row the store refused would claim
      // the team is kept when it is not.
      if (!flushSample.ok) return;
      teamIds.forEach((teamId) => {
        const entry = rows.get(teamId);
        if (entry) entry.flush = flushSample.flush;
      });
    },

    hold: (ms, source) => {
      log.holds += 1;
      log.heldMs += ms;
      log.longestHoldMs = Math.max(log.longestHoldMs, ms);
      log.holdsBySource[source] = (log.holdsBySource[source] ?? 0) + 1;
    },

    blocked: () => {
      log.blocked += 1;
    },

    suppressed: (teamId) => {
      log.suppressed += 1;
      const entry = row(teamId);
      entry.segment = segment;
      entry.second = second();
      entry.ok = false;
      entry.reason = "blocked";
    },

    gaveUp: (refusals, at) => {
      log.refusals = refusals;
      log.gaveUpAtSecond = at;
    },

    hidden: (ms) => {
      log.hiddenMs += ms;
      log.hiddenSpells += 1;
    },

    eta: (minutes) => {
      log.etaMinutes = minutes;
    },

    config: (config) => {
      log.config = { ...log.config, ...config };
    },

    tidied: (tidy) => {
      log.tidy = tidy;
    },

    unpersisted: () => {
      log.persisted = false;
    },

    fetchEnded: (at) => {
      log.fetchEndedAt = at;
    },

    finish: (at, reason) => {
      log.endedAt = at;
      log.endReason = reason;
      const current = log.segments[log.segments.length - 1];
      if (current && !current.endedAt) {
        current.endedAt = at;
        current.endReason = reason;
      }
    },
  };
};

// ---------- reading it back ----------

/**
 * What became of an id, from what was recorded rather than from a flag set at the time.
 *
 * Derived at the end on purpose. During the run an id's fate is not yet decided — a team fetched
 * at minute five is only "fetched and not saved" once the run ends without the save that would
 * have kept it — and a flag written early would be wrong for exactly the ids that matter.
 */
export const outcomeOf = (
  entry: TrackedTeam | undefined,
  settled: ReadonlySet<string>
): PullOutcome => {
  if (!entry || entry.seq === undefined) {
    // Never reported at all. Either the run ended first, or it was suppressed on the way out.
    return entry?.reason === "blocked" ? "left-unsettled" : "never-attempted";
  }
  if (!entry.ok) {
    // Reported as a failure but never settled: the give-up dropped it, so a resume asks again.
    return settled.has(entry.teamId) ? "failed" : "left-unsettled";
  }
  if (!settled.has(entry.teamId)) return "fetched-not-saved";
  return entry.issue ? "skipped" : "filed";
};

/** The sub-reason behind the outcome, in whichever vocabulary applies. */
export const whyOf = (entry: TrackedTeam | undefined, outcome: PullOutcome): string => {
  if (outcome === "skipped") return entry?.issue ?? "";
  if (outcome === "failed" || outcome === "left-unsettled") return entry?.reason ?? "";
  return "";
};

// ---------- the files ----------

const TEAM_HEADERS = [
  "Seq",
  "Team ID",
  "Team Name",
  "Segment",
  "Outcome",
  "Why",
  "Second",
  "Flush",
  "Attempts",
  "First Failure",
  "HTTP Status",
  "Failed On",
  "Content Type",
  "Retry After",
  "Message #",
  "GC Age Label",
  "Age Level",
  "Name Age",
  "Name Year",
  "Season",
  "List Age",
  "Pool Team ID",
  "Page",
  "New Page",
  "New Team",
  "Added",
  "Updated",
  "Unchanged",
  "Ignored",
  "Out Of Season",
  "Opp New",
  "Opp By Avatar",
  "Opp By Name",
  "Age From Opponents",
];

const cell = (value: string | number | boolean | undefined): string =>
  value === undefined ? "" : typeof value === "boolean" ? (value ? "yes" : "") : String(value);

/**
 * One row per id the run was asked for — including the ones it never reached.
 *
 * That last part is the whole point of keying on the cursor's list rather than on what was
 * recorded. A file that simply leaves out the ids a stopped run never got to has a row count that
 * disagrees with what was asked for, and no way to tell "the run ended early" from "the tracker
 * lost them".
 */
export const pullTeamsCsv = (log: PullRunLog, settled: readonly string[]): string => {
  const kept = new Set(settled);
  const byId = new Map(log.teams.map((entry) => [entry.teamId, entry]));
  const rows = log.ids.map((teamId) => {
    const entry = byId.get(teamId);
    const outcome = outcomeOf(entry, kept);
    return [
      cell(entry?.seq),
      teamId,
      cell(entry?.name),
      cell(entry?.segment),
      outcome,
      whyOf(entry, outcome),
      cell(entry?.second),
      cell(entry?.flush),
      cell(entry?.attempts),
      cell(entry?.firstFailure),
      cell(entry?.status),
      cell(entry?.failedOn),
      cell(entry?.contentType),
      cell(entry?.retryAfter),
      cell(entry?.message),
      cell(entry?.ageLabel),
      cell(entry?.ageLevel),
      cell(entry?.nameAge),
      cell(entry?.nameYear),
      cell(entry?.season),
      cell(entry?.listAge),
      cell(entry?.poolTeamId),
      cell(entry?.ageGroupId),
      cell(entry?.newPage),
      cell(entry?.newTeam),
      cell(entry?.gamesAdded),
      cell(entry?.gamesUpdated),
      cell(entry?.gamesUnchanged),
      cell(entry?.gamesIgnored),
      cell(entry?.gamesOutOfSeason),
      cell(entry?.oppCreated),
      cell(entry?.oppByAvatar),
      cell(entry?.oppByName),
      cell(entry?.oppAge),
    ]
      .map(csvEscape)
      .join(",");
  });
  return [TEAM_HEADERS.join(","), ...rows].join("\n");
};

const pair = (item: string, value: string | number | boolean | undefined): string =>
  [item, cell(value)].map(csvEscape).join(",");

const seconds = (from: string, to: string | undefined): number | undefined => {
  if (!to) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.round((end - start) / 1000);
};

/**
 * The run in sections: totals, the pass-by-pass shape, the failure reasons, the save timeline, and
 * the handful of distinct messages and bodies behind forty thousand identical rows.
 *
 * Tens of kilobytes, and the file to read first. Everything here is one number for the whole run,
 * which is exactly why none of it belongs in the fifty-thousand-row file beside it.
 */
export const pullSummaryCsv = (log: PullRunLog, settled: readonly string[]): string => {
  const kept = new Set(settled);
  const byId = new Map(log.teams.map((entry) => [entry.teamId, entry]));
  const outcomes = new Map<PullOutcome, number>();
  const levels = new Map<
    string,
    { filed: number; nameAge: number; nameYear: number; fromOpponents: number }
  >();
  log.ids.forEach((teamId) => {
    const entry = byId.get(teamId);
    const outcome = outcomeOf(entry, kept);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    if (!entry?.ok) return;
    /*
     * Counted against what GameChanger itself said, not against what the import settled on — so
     * "none" stays the count of teams that arrived with no age, and the opponent column beside it
     * says how many of those the schedule answered for.
     */
    const key = entry.ageLevel === undefined ? "none" : String(entry.ageLevel);
    const at = levels.get(key) ?? { filed: 0, nameAge: 0, nameYear: 0, fromOpponents: 0 };
    at.filed += 1;
    if (entry.nameAge !== undefined) at.nameAge += 1;
    if (entry.nameYear !== undefined) at.nameYear += 1;
    if (entry.oppAge !== undefined) at.fromOpponents += 1;
    levels.set(key, at);
  });

  const run = [
    pair("Tracker version", log.version),
    pair("Generated at", new Date().toISOString()),
    pair("Started at", log.startedAt),
    pair("Fetching ended at", log.fetchEndedAt),
    pair("Ended at", log.endedAt),
    pair("Elapsed seconds", seconds(log.startedAt, log.endedAt)),
    pair("Fetching seconds", seconds(log.startedAt, log.fetchEndedAt)),
    pair("End reason", log.endReason),
    pair("Every row saved", log.persisted),
    pair("Ids asked", log.ids.length),
    pair("Rows written", log.teams.length),
    pair("Ids settled", settled.length),
    ...(
      [
        "filed",
        "skipped",
        "failed",
        "fetched-not-saved",
        "left-unsettled",
        "never-attempted",
      ] as PullOutcome[]
    ).map((outcome) => pair(`Outcome: ${outcome}`, outcomes.get(outcome) ?? 0)),
    pair("Blocked answers seen", log.blocked),
    pair("Blocked answers suppressed", log.suppressed),
    pair("Refusals before giving up", log.refusals),
    pair("Gave up at second", log.gaveUpAtSecond),
    pair("Holds", log.holds),
    pair("Held seconds", Math.round(log.heldMs / 1000)),
    pair("Longest hold seconds", Math.round(log.longestHoldMs / 1000)),
    ...Object.entries(log.holdsBySource).map(([source, count]) => pair(`Holds: ${source}`, count)),
    pair("Saves", log.flushes.length),
    pair("Saves refused", log.flushFailures),
    pair("Tab hidden seconds", Math.round(log.hiddenMs / 1000)),
    pair("Tab hidden spells", log.hiddenSpells),
    pair("ETA shown, minutes", log.etaMinutes),
    ...Object.entries(log.config).map(([item, value]) => pair(`Config: ${item}`, value)),
    ...(log.paste
      ? [
          pair("Paste: lines", log.paste.lines),
          pair("Paste: ids parsed", log.paste.parsed),
          pair("Paste: lines skipped", log.paste.skipped),
          pair("Paste: too young to rank", log.paste.tooYoung),
          pair("Paste: already in the pool", log.paste.alreadyHere),
          pair("Paste: ids asked for", log.paste.asked),
        ]
      : []),
    ...(log.tidy
      ? [
          pair("Tidy: placeholders named", log.tidy.named),
          pair("Tidy: teams folded", log.tidy.folded),
          pair("Tidy: squads paired", log.tidy.paired),
          pair("Tidy: rows collapsed", log.tidy.collapsed),
          pair("Tidy: rows pruned", log.tidy.pruned),
          pair("Tidy: rows reclaimed", log.tidy.reclaimed),
          pair("Tidy: rows refiled", log.tidy.refiled),
          pair("Tidy: passes", log.tidy.passes),
        ]
      : []),
  ];

  return [
    csvSection("Run", ["Item", "Value"], run),
    csvSection(
      "Segments",
      ["Segment", "Started", "Ended", "Ids Asked", "End Reason"],
      log.segments.map((entry) =>
        [entry.segment, entry.startedAt, entry.endedAt ?? "", entry.asked, entry.endReason ?? ""]
          .map(csvEscape)
          .join(",")
      )
    ),
    csvSection(
      "Reasons",
      ["Reason", "Count"],
      Object.entries(log.reasons).map(([reason, count]) => [reason, count].map(csvEscape).join(","))
    ),
    csvSection(
      "Timeline",
      [
        "Flush",
        "Second",
        "Teams",
        "Settled",
        "Pool Teams",
        "Pool Games",
        "Pool Pages",
        "Save ms",
        "Saved",
      ],
      log.flushes.map((entry) =>
        [
          entry.flush,
          entry.second,
          entry.teams,
          entry.settled,
          entry.poolTeams,
          entry.poolGames,
          entry.poolPages,
          entry.ms,
          entry.ok ? "yes" : "",
        ]
          .map(csvEscape)
          .join(",")
      )
    ),
    csvSection(
      "Messages",
      ["Number", "Message"],
      log.messages.map((message, at) => [at, message].map(csvEscape).join(","))
    ),
    csvSection(
      "Samples",
      ["Reason", "HTTP Status", "Content Type", "Failed On", "Retry After", "Count", "Body"],
      log.samples.map((entry) =>
        [
          entry.reason,
          entry.status ?? "",
          entry.contentType ?? "",
          entry.failedOn ?? "",
          entry.retryAfter ?? "",
          entry.count,
          entry.body ?? "",
        ]
          .map(csvEscape)
          .join(",")
      )
    ),
    csvSection(
      "Levels",
      ["Age Level", "Teams", "Name Has An Age", "Name Has A Year", "Settled By Opponents"],
      [...levels.entries()]
        .sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : Number(a[0]) - Number(b[0])))
        .map(([level, counts]) =>
          [level, counts.filed, counts.nameAge, counts.nameYear, counts.fromOpponents]
            .map(csvEscape)
            .join(",")
        )
    ),
    csvSection(
      "Skipped Lines",
      ["Line"],
      (log.paste?.skippedSamples ?? []).map((line) => csvEscape(line))
    ),
    csvSection("Look Up", ["Item", "Value"], [pair("Team page", gcTeamPageUrl("<Team ID>"))]),
  ].join("\n\n");
};

/** A few numbers worth watching while the run is going, rather than reading afterwards. */
export type PullLiveSummary = {
  blocked: number;
  heldSeconds: number;
  saves: number;
  lastSaveMs?: number;
  perMinute?: number;
};

export const liveSummary = (log: PullRunLog, done: number, elapsedMs: number): PullLiveSummary => {
  const last = log.flushes[log.flushes.length - 1];
  return {
    blocked: log.blocked,
    heldSeconds: Math.round(log.heldMs / 1000),
    saves: log.flushes.length,
    ...(last ? { lastSaveMs: last.ms } : {}),
    ...(elapsedMs > 0 ? { perMinute: Math.round(done / (elapsedMs / 60_000)) } : {}),
  };
};
