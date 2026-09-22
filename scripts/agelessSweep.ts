/**
 * Runs the ageless triage rules over a real pool and prints what they would do.
 *
 * A research tool rather than a feature, and a gate rather than a convenience: `agelessTriage.ts`
 * holds a dozen candidate rules for clearing the thirty-six thousand teams nobody could age, none
 * of them wired to anything, and none of them may ship before this has run against a real export
 * and somebody has read the names it prints. That is this repo's standing rule — a number in a
 * comment says what was measured — and it matters more here than usual, because the cost of a
 * wrong rule is not symmetric. A team left unrated costs its own ranking. A team rated at the
 * wrong age, or deleted, corrupts every club it played, and a wrongly refused club leaves nothing
 * behind to notice it by.
 *
 *   npm run ageless:sweep -- <backup.json> [--rule=NAME] [--sample=20] [--seed=1] [--csv]
 *
 * **JSON, and the whole-browser backup.** The waiting list rides in the backup's `answers` block,
 * and `parseTeamRankingsCsv` has nowhere to put one — `CSV_SECTIONS` covers the schedule, the age
 * groups, the teams and the games, and stops. A `.csv` is refused by name rather than read as an
 * empty list, because "this file has no waiting teams" and "this file cannot carry them" are very
 * different answers and only one of them is worth acting on.
 *
 * What it prints is arranged around the ways a sweep like this produces a confident, tidy, wrong
 * answer:
 *
 *   - two rules both credited with the same twelve thousand rows, so their totals add up to more
 *     than the backlog and each looks indispensable;
 *   - a rule measured only against the teams it was written for, never against the teams it would
 *     wreck, so its false positives are invisible by construction;
 *   - a threshold picked because it was the first one tried;
 *   - a sample that reshuffles every run, so nobody can work through it;
 *   - and the residue — what is *left* after every rule has run — quietly never reported, which is
 *     the number that says whether any of this was worth doing.
 */
import { readFileSync } from "node:fs";
import {
  looksLikeJsonBackup,
  parseTeamRankingsJson,
  type TeamRankingsBackup,
} from "../src/lib/teamRankingsBackup.ts";
import {
  AGELESS_RULES,
  agelessVerdicts,
  type AgelessVerdict,
} from "../src/lib/agelessTriage.ts";
import { ageLevelFromName } from "../src/lib/gameChangerApi.ts";
import { whyNoAge } from "../src/lib/agelessEvidence.ts";
import { MIN_OPPONENT_AGE_EVIDENCE } from "../src/lib/gameChangerImport.ts";
import type { AgeUnknownTeam } from "../src/lib/ageUnknown.ts";

/**
 * The Node globals this script needs, declared here for the reason `recencySweep.ts` gives:
 * installing `@types/node` would change global timer typings for the browser project too.
 */
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

// ---------- arguments ----------

type Options = {
  file: string;
  rule?: string;
  sample: number;
  seed: number;
  csv: boolean;
};

const readOptions = (argv: string[]): Options | null => {
  const rest = argv.slice(2);
  const file = rest.find((arg) => !arg.startsWith("--"));
  if (!file) return null;
  const flag = (name: string): string | undefined =>
    rest.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  return {
    file,
    ...(flag("rule") ? { rule: flag("rule") } : {}),
    sample: Number(flag("sample") ?? 12),
    seed: Number(flag("seed") ?? 1),
    csv: rest.includes("--csv"),
  };
};

/**
 * A sample that does not move between runs.
 *
 * The point of printing names is that somebody reads them, decides the rule is wrong about four
 * of them, and re-runs to see whether a change fixed those four. A sample drawn afresh each time
 * makes that impossible, so the order is a hash of the team id and nothing else — stable across
 * runs, across machines, and across changes to the rules.
 */
const shuffleKey = (teamId: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let at = 0; at < teamId.length; at += 1) {
    hash = (Math.imul(hash ^ teamId.charCodeAt(at), 0x01000193) >>> 0) % 0xffffffff;
  }
  return hash;
};

const sampleOf = (rows: AgeUnknownTeam[], count: number, seed: number): AgeUnknownTeam[] =>
  [...rows]
    .sort((a, b) => shuffleKey(a.teamId, seed) - shuffleKey(b.teamId, seed))
    .slice(0, Math.max(0, count));

// ---------- printing ----------

const rule = "=".repeat(96);
const pct = (part: number, whole: number): string =>
  whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;
const n = (value: number): string => value.toLocaleString();

const describeVerdict = (verdict: AgelessVerdict): string => {
  switch (verdict.kind) {
    case "age":
      return `${verdict.level}U`;
    case "rec":
      return verdict.level === undefined ? "rec" : `rec, ${verdict.level}U`;
    default:
      return verdict.kind;
  }
};

const describeRow = (row: AgeUnknownTeam): string => {
  const evidence = row.evidence;
  const bits = [
    JSON.stringify(row.name ?? ""),
    evidence?.state ?? evidence?.city ?? "",
    evidence ? `${evidence.games}g/${evidence.opponents}opp` : "no evidence",
    evidence?.ngb?.length ? evidence.ngb.join("+") : "",
    evidence?.sampleOpponents?.length ? `played ${evidence.sampleOpponents.join("; ")}` : "",
  ].filter(Boolean);
  return bits.join("  ·  ");
};

// ---------- the sweep ----------

const main = (): void => {
  const options = readOptions(process.argv);
  if (!options) {
    console.error(
      "usage: npm run ageless:sweep -- <backup.json> [--rule=NAME] [--sample=20] [--seed=1] [--csv]"
    );
    process.exitCode = 1;
    return;
  }

  const raw = readFileSync(options.file, "utf8");
  if (!looksLikeJsonBackup(raw)) {
    console.error(
      `! ${options.file} is not a JSON backup.\n` +
        "  The waiting list rides in the backup's answers block, and the CSV format has nowhere to\n" +
        "  put one. Use the whole-browser backup — League_Forecast_Backup_<date>.json."
    );
    process.exitCode = 1;
    return;
  }

  const parsed: unknown = JSON.parse(raw);
  const backup: TeamRankingsBackup | null =
    parseTeamRankingsJson(raw) ??
    (typeof parsed === "object" && parsed !== null && "teamRankings" in parsed
      ? parseTeamRankingsJson(JSON.stringify((parsed as { teamRankings: unknown }).teamRankings))
      : null);
  if (!backup) {
    console.error(`! ${options.file} is not a Team Rankings backup.`);
    process.exitCode = 1;
    return;
  }

  const waiting = backup.answers?.ageUnknown ?? [];
  console.log(rule);
  console.log(`Ageless sweep · ${options.file}`);
  console.log(rule);
  console.log(
    `${n(waiting.length)} teams waiting on an age · ${n(backup.teams.length)} teams in the pool · ` +
      `${n(backup.games.length)} games`
  );

  if (waiting.length === 0) {
    console.error(
      "\n! This backup carries no waiting list.\n" +
        "  The Team Rankings pool backup does not write the answers block; the whole-browser one\n" +
        "  does. Look for League_Forecast_Backup_<date>.json."
    );
    process.exitCode = 1;
    return;
  }

  const rules = options.rule
    ? AGELESS_RULES.filter((entry) => entry.id.includes(options.rule ?? ""))
    : AGELESS_RULES;

  // One pass, every rule, so a row's verdicts are known together and the overlap below is real
  // rather than a second walk that might disagree with the first.
  const caught = new Map<string, AgeUnknownTeam[]>();
  const verdictOf = new Map<string, Map<string, AgelessVerdict>>();
  const anyRule = new Set<string>();
  waiting.forEach((row) => {
    agelessVerdicts(row).forEach(({ rule: hit, verdict }) => {
      if (!rules.includes(hit)) return;
      const rows = caught.get(hit.id) ?? [];
      rows.push(row);
      caught.set(hit.id, rows);
      const perRow = verdictOf.get(hit.id) ?? new Map();
      perRow.set(row.teamId, verdict);
      verdictOf.set(hit.id, perRow);
      anyRule.add(row.teamId);
    });
  });

  console.log("");
  console.log("WHAT EACH RULE CATCHES");
  console.log("-".repeat(96));
  console.log(
    `${"rule".padEnd(24)} ${"tier".padEnd(8)} ${"caught".padEnd(10)} ${"share".padEnd(8)} what it would do`
  );
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    const verdicts = verdictOf.get(entry.id);
    const kinds = new Map<string, number>();
    rows.forEach((row) => {
      const verdict = verdicts?.get(row.teamId);
      if (!verdict) return;
      const label = describeVerdict(verdict);
      kinds.set(label, (kinds.get(label) ?? 0) + 1);
    });
    const summary = [...kinds.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, count]) => `${n(count)} ${label}`)
      .join(", ");
    console.log(
      `${entry.id.padEnd(24)} ${entry.tier.padEnd(8)} ${n(rows.length).padEnd(10)} ` +
        `${pct(rows.length, waiting.length).padEnd(8)} ${summary}`
    );
  });

  /*
   * The overlap, because two rules crediting themselves with the same rows is the easiest way for
   * this report to claim more than it can deliver. What matters per rule is its *marginal* catch:
   * the rows nothing else would have reached.
   */
  console.log("");
  console.log("MARGINAL CATCH — rows no other rule reaches");
  console.log("-".repeat(96));
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    const others = new Set<string>();
    rules.forEach((other) => {
      if (other.id === entry.id) return;
      (caught.get(other.id) ?? []).forEach((row) => others.add(row.teamId));
    });
    const only = rows.filter((row) => !others.has(row.teamId));
    console.log(
      `${entry.id.padEnd(24)} ${n(only.length).padEnd(10)} of ${n(rows.length)} (${pct(only.length, rows.length)})`
    );
  });

  /*
   * The tripwire. Every team already in the pool has an age and is connected to the rest of it, so
   * a rule that fires on one of those names is either eating a working club or relabelling a team
   * the pool currently ranks. It is the closest thing to a false-positive rate available without
   * ground truth, and it costs nothing.
   *
   * The pool's names are cleaned — age labels stripped — so a name rule sees a shorter string here
   * than it will on a waiting row. That understates the rules that read an age and leaves the
   * division and marker rules, which is what this is for, honest.
   */
  console.log("");
  console.log("TRIPWIRE — the same rules against teams that already work");
  console.log("-".repeat(96));
  const pooled: AgeUnknownTeam[] = backup.teams.map((team) => ({
    teamId: team.id,
    name: team.name,
    firstSeen: "",
    lastTried: "",
    tries: 0,
  }));
  rules.forEach((entry) => {
    const hits = pooled.filter((row) => entry.read(row) !== undefined);
    const shown = sampleOf(hits, 3, options.seed)
      .map((row) => JSON.stringify(row.name ?? ""))
      .join("  ");
    console.log(
      `${entry.id.padEnd(24)} ${n(hits.length).padEnd(10)} ${pct(hits.length, pooled.length).padEnd(8)} ${shown}`
    );
  });

  /*
   * And the question the grade words exist to answer: how often does a USSSA or Perfect Game grade
   * travel *with* an age? Where it does, the age veto covers it. Where it does not, the bare grade
   * is what reaches this backlog — which is exactly where reading it as an age does the damage.
   */
  const GRADES = /\b(?:a{1,3}|majors?|minors?)\b/i;
  const gradedPool = backup.teams.filter((team) => GRADES.test(team.name));
  const gradedWithAge = gradedPool.filter((team) => ageLevelFromName(team.name) !== undefined);
  const gradedWaiting = waiting.filter((row) => GRADES.test(row.name ?? ""));
  const gradedWaitingWithAge = gradedWaiting.filter(
    (row) => ageLevelFromName(row.name ?? "") !== undefined
  );
  console.log("");
  console.log("THE GRADE QUESTION — does A/AA/AAA/Major travel with an age?");
  console.log("-".repeat(96));
  console.log(
    `in the pool:   ${n(gradedPool.length)} names carry a grade, ${n(gradedWithAge.length)} also carry an age (${pct(gradedWithAge.length, gradedPool.length)})`
  );
  console.log(
    `still waiting: ${n(gradedWaiting.length)} names carry a grade, ${n(gradedWaitingWithAge.length)} also carry an age (${pct(gradedWaitingWithAge.length, gradedWaiting.length)})`
  );

  /*
   * Disconfirmation: a row whose opponents *do* write ages is not in a closed cluster, whatever
   * its name says. Any refusal rule firing on one of those is suspect, and a non-zero count here
   * means a veto is missing or mis-ordered rather than that the rule is merely imperfect.
   */
  console.log("");
  console.log("DISCONFIRMED — caught although its opponents do name ages");
  console.log("-".repeat(96));
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    const contradicted = rows.filter(
      (row) => (row.evidence?.namedAnAge ?? 0) >= MIN_OPPONENT_AGE_EVIDENCE
    );
    if (contradicted.length === 0) return;
    console.log(`${entry.id.padEnd(24)} ${n(contradicted.length)}`);
    sampleOf(contradicted, 2, options.seed).forEach((row) =>
      console.log(`    ${describeRow(row)}`)
    );
  });

  // Samples last, because they are what somebody actually reads.
  console.log("");
  console.log(`A SAMPLE OF WHAT EACH RULE CAUGHT (seed ${options.seed})`);
  console.log(rule);
  rules.forEach((entry) => {
    const rows = caught.get(entry.id) ?? [];
    if (rows.length === 0) return;
    console.log("");
    console.log(`${entry.id} — ${entry.label} (${n(rows.length)})`);
    console.log(`  ${entry.because}`);
    sampleOf(rows, options.sample, options.seed).forEach((row) => {
      const verdict = verdictOf.get(entry.id)?.get(row.teamId);
      console.log(`    ${verdict ? describeVerdict(verdict).padEnd(10) : "".padEnd(10)}${describeRow(row)}`);
    });
  });

  /*
   * The residue, which is the number that says whether any of this was worth doing: what is still
   * on the list after every rule has had its turn.
   */
  const left = waiting.filter((row) => !anyRule.has(row.teamId));
  console.log("");
  console.log(rule);
  console.log(
    `LEFT OVER — ${n(left.length)} of ${n(waiting.length)} (${pct(left.length, waiting.length)}) that no rule reaches`
  );
  console.log(rule);
  sampleOf(left, options.sample, options.seed).forEach((row) => {
    console.log(`    ${describeRow(row)}`);
    if (row.evidence) console.log(`      ${whyNoAge(row.evidence, MIN_OPPONENT_AGE_EVIDENCE)}`);
  });

  if (options.csv) {
    console.log("");
    console.log("Team ID,Team Name,Rules,Verdict,State,Games,Opponents,Naming An Age,NGB");
    waiting.forEach((row) => {
      const hits = agelessVerdicts(row).filter(({ rule: hit }) => rules.includes(hit));
      if (hits.length === 0) return;
      const cells = [
        row.teamId,
        JSON.stringify(row.name ?? ""),
        hits.map(({ rule: hit }) => hit.id).join(" "),
        describeVerdict(hits[0]!.verdict),
        row.evidence?.state ?? "",
        String(row.evidence?.games ?? 0),
        String(row.evidence?.opponents ?? 0),
        String(row.evidence?.namedAnAge ?? 0),
        (row.evidence?.ngb ?? []).join(" "),
      ];
      console.log(cells.join(","));
    });
  }

  console.log("");
  console.log(
    "Nothing here is applied. Read the samples, and especially the tripwire: a rule that fires on\n" +
      "teams the pool already ranks is a rule that would break working data. What survives that is\n" +
      "what is worth shipping."
  );
};

main();
