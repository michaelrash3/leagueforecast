import type { GcFetchErrorReason, GcTeamResponse, GcTeamSchedule } from "./gameChangerApi";

/**
 * Reading what came back from one real GameChanger pull.
 *
 * Everything about the import has been proved against recorded fixtures, which prove the code and
 * prove nothing about GameChanger. The questions a fixture cannot answer are whether the WAF lets
 * a server through at all, whether the payload today is still the shape the normalizer expects,
 * and whether the schedule that comes back carries scores. Those need one real request, and the
 * verify script (`npm run verify:gc`) is what makes it.
 *
 * What lives here is the judging, so it can be tested: given a response, what does it prove, what
 * does it not, and what should somebody do about it.
 */

export type CheckStatus = "pass" | "warn" | "fail";

export type PullCheck = {
  /** What was being asked, in a few words. */
  step: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when there is something to do. */
  advice?: string;
};

/**
 * What each failure means and what to do next. Written for somebody holding a red result, not for
 * somebody reading the source.
 */
export const ADVICE: Record<GcFetchErrorReason, string> = {
  "invalid-id":
    "That is not a GameChanger team id. It is the 12 characters after web.gc.com/teams/ — not the whole URL's last segment, which is the team's name.",
  "not-found":
    "GameChanger has no public profile for that id. Open web.gc.com/teams/<id> in a browser: if it 404s there too, the id is wrong or the team is private.",
  blocked:
    'The AWS WAF turned the server away. This is the one failure a fixture could never predict. Open the schedule page in a browser, copy the x-aws-waf-token header it sends, and set GC_EXTRA_HEADERS to {"x-aws-waf-token": "..."} in the deployment, then run this again.',
  throttled:
    "GameChanger is rate-limiting. This is a working pull being told to slow down, not a broken one. Wait for the Retry-After it gave and try again; the importer already holds the whole pull back when it sees this.",
  "upstream-error":
    "GameChanger answered with an error of its own. Try again in a few minutes; if it persists, check whether web.gc.com is up.",
  unrecognized:
    "GameChanger answered, but not in a shape this app can read — so the payload has changed. The diagnostics carry the top-level keys and the start of the body, which is what the normalizer needs to be brought back in line.",
  network:
    "The server could not reach GameChanger at all. That is a network or DNS problem at the deployment, not a GameChanger one.",
  unconfigured:
    "The proxy is not deployed or not configured. Check /api/gc-team?probe=1 answers at all.",
  timeout:
    "GameChanger did not answer in time. Usually transient; if every attempt times out, the WAF may be holding the connection open rather than refusing it.",
};

/** What one team's response proves. */
export const checkTeamResponse = (
  teamId: string,
  response: GcTeamResponse,
  /** Today, as "2026-09-16" — what "already played" is measured against. */
  today: string = new Date().toISOString().slice(0, 10)
): PullCheck[] => {
  if (!response.ok) {
    return [
      {
        step: `Pull ${teamId}`,
        status: "fail",
        detail: `${response.reason}: ${response.message}`,
        advice: ADVICE[response.reason],
      },
    ];
  }
  return [
    {
      step: `Pull ${teamId}`,
      status: "pass",
      detail: "GameChanger answered and the payload parsed.",
    },
    ...checkSchedule(response.schedule, today),
  ];
};

/**
 * Whether a schedule with no scores on it is a problem.
 *
 * It used to warn whenever nothing was scored and say the payload must have changed. On a team
 * whose season has not started that is wrong twice over: nothing is broken, and a check that warns
 * every week of every preseason is a check people stop reading. The dates are already here, so it
 * asks them — an unscored game that has not been played yet is the schedule working, and one that
 * is weeks past is the question worth raising.
 */
const scoresCheck = (
  games: GcTeamSchedule["games"],
  played: GcTeamSchedule["games"],
  today: string
): PullCheck => {
  if (played.length > 0) {
    return {
      step: "Scores",
      status: "pass",
      detail: `${played.length} of ${games.length} carry a final score.`,
    };
  }
  const shouldHaveBeenPlayed = games.filter((game) => game.date && game.date < today);
  if (shouldHaveBeenPlayed.length === 0) {
    return {
      step: "Scores",
      status: "pass",
      detail: `Nothing to score yet — all ${games.length} of these games are still to come.`,
    };
  }
  return {
    step: "Scores",
    status: "warn",
    detail: `No game carries a score, and ${shouldHaveBeenPlayed.length} of ${games.length} ${
      shouldHaveBeenPlayed.length === 1 ? "was" : "were"
    } played before today. Either this team never reports, or the score fields have moved.`,
    advice: ADVICE.unrecognized,
  };
};

/**
 * What the schedule itself says. A pull that succeeds but brings back a nameless team or a
 * schedule with no scores has proved the plumbing and not the feature, and the difference is worth
 * stating rather than counting as a pass.
 */
export const checkSchedule = (
  schedule: GcTeamSchedule,
  today: string = new Date().toISOString().slice(0, 10)
): PullCheck[] => {
  const { profile, games } = schedule;
  const played = games.filter(
    (game) => game.teamScore !== undefined && game.opponentScore !== undefined
  );
  const named = games.filter((game) => game.opponentName.trim() !== "");
  const dated = games.filter((game) => Boolean(game.date));

  const checks: PullCheck[] = [
    {
      step: "Team profile",
      status: profile.name.trim() ? "pass" : "fail",
      detail: profile.name.trim()
        ? `${profile.name}${profile.state ? ` — ${[profile.city, profile.state].filter(Boolean).join(", ")}` : ""}`
        : "The profile parsed but carries no name, so the normalizer is reading the wrong field.",
      ...(profile.name.trim() ? {} : { advice: ADVICE.unrecognized }),
    },
    {
      step: "Age level",
      status: profile.ageLevel === undefined ? "warn" : "pass",
      detail:
        profile.ageLevel === undefined
          ? "No age level found, in the payload or in the name. Every game from this team would land on a page chosen by hand."
          : `${profile.ageLevel}U`,
    },
    {
      step: "Season",
      status: profile.season ? "pass" : "warn",
      detail: profile.season
        ? `${profile.season.season} ${profile.season.year}`
        : "No season, so the squad year has to be guessed from the dates.",
    },
    {
      step: "Schedule",
      status: games.length > 0 ? "pass" : "warn",
      detail:
        games.length > 0
          ? `${games.length} game${games.length === 1 ? "" : "s"}.`
          : "The schedule endpoint answered with nothing. A team with no games yet is fine; every team coming back empty is not.",
    },
  ];

  if (games.length > 0) {
    checks.push(
      scoresCheck(games, played, today),
      {
        step: "Opponents",
        status: named.length === games.length ? "pass" : "warn",
        detail: `${named.length} of ${games.length} name an opponent.`,
      },
      {
        step: "Dates",
        status: dated.length === games.length ? "pass" : "warn",
        detail: `${dated.length} of ${games.length} carry a date. A game with no date cannot be placed in a squad year.`,
      }
    );
  }

  return checks;
};

/** Whether a run of checks counts as a pass, and one line saying why. */
export const verdict = (checks: PullCheck[]): { ok: boolean; line: string } => {
  const failed = checks.filter((check) => check.status === "fail");
  const warned = checks.filter((check) => check.status === "warn");
  if (failed.length > 0) {
    return {
      ok: false,
      line: `${failed.length} check${failed.length === 1 ? "" : "s"} failed: ${failed
        .map((check) => check.step)
        .join(", ")}.`,
    };
  }
  if (warned.length > 0) {
    return {
      ok: true,
      line: `Everything essential passed, with ${warned.length} thing${
        warned.length === 1 ? "" : "s"
      } worth a look: ${warned.map((check) => check.step).join(", ")}.`,
    };
  }
  return { ok: true, line: "Every check passed against the live GameChanger." };
};
