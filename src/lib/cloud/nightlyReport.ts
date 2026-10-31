import { LOPSIDED_MARGIN } from "../autoRemoved";
import { describeTidy } from "../gameChangerImport";
import {
  standInReport,
  standInShareLines,
  standInWhyLines,
  type StandInReport,
} from "../standInReport";
import { segmentOn } from "../teamRankings/seasons";
import { loadAgeGroups, loadScoutGamesForYear, loadScoutTeams } from "../teamRankingsStorage";
import type { CloudPullResult, CloudPullStage } from "./cloudRunner";
import { memoryWords, type MemoryUse } from "./memoryUse";

/*
 * What the nightly says of its pull beyond its first line (`scripts/nightly.ts`, README "The
 * nightly refresh on GitHub"): what the tidy changed, step by step, what the sweep deleted under
 * the owner's 40-run rule, took off the boards and put back, how much of the squad year leans on
 * a stand-in once they are done, and the memory after each step. Counts only, a line at a time:
 * the repository's Actions logs are public, so no club's name or id is said, and the run hands
 * over nothing that holds one (`CloudPullResult.tidy` is the tidy's counts without its pool).
 */

/** What the tidy changed, a line a step in the tidy's own words (`describeTidy`), and its passes. */
export const tidyLines = (tidy: CloudPullResult["tidy"]): string[] => {
  if (!tidy) return [];
  const passes = `${tidy.passes} ${tidy.passes === 1 ? "pass" : "passes"}`;
  const steps = describeTidy(tidy);
  if (steps.length === 0) return [`  The tidy, in ${passes}, changed nothing.`];
  return [`  The tidy, in ${passes}:`, ...steps.map((step) => `    ${step}`)];
};

/**
 * What the sweep did: the clubs deleted for a game won or lost by `LOPSIDED_MARGIN` or more and
 * the games that went with them, as the nightly has said it since the rule was made, and beside it
 * the marks of clubs plainly made up it put on and lifted, by GameChanger team ("Clubs removed for
 * you"), which never count a deleted club again (`CloudPullResult.marks`). A save held says what it
 * would have done.
 */
export const sweptLines = ({
  end,
  deleted,
  marks,
}: Pick<CloudPullResult, "end" | "deleted" | "marks">): string[] => {
  const held = end === "held";
  return [
    ...(deleted
      ? [
          `  ${held ? "Would have deleted" : "Deleted"} for a game won or lost by ${LOPSIDED_MARGIN} or more: ${deleted.clubs} clubs, and ${deleted.games} games that went with them.`,
        ]
      : []),
    ...(marks
      ? [
          `  Clubs removed for you, as plainly made up: ${marks.marked} GameChanger ${marks.marked === 1 ? "team" : "teams"} ${held ? "would have been " : ""}taken off the boards, and ${marks.lifted} put back.`,
        ]
      : []),
  ];
};

/**
 * A squad year's stand-ins (`standInReport`) in the model sweep's own words (`standInShareLines`,
 * `standInWhyLines`): the share of the year's games, and of its played games, with a club known
 * only by name or a bracket slot on a side, and the clubs known only by name by where a pulled
 * club of the name is and by why none was joined. Numbers only: the report's lists of the clubs
 * holding the most games name them, and are never said.
 */
export const standInLines = (report: StandInReport): string[] => [
  `  Stand-ins of squad year ${report.year}, a club known only by name or a bracket slot on a side:`,
  ...[...standInShareLines(report), ...standInWhyLines(report)].map((line) => `  ${line}`),
];

/**
 * The stand-ins of the squad year being played on the members' day `today` (`segmentOn`), off the
 * pool the store holds: every game stored for the year, as the stand-in rule's readings counted
 * them when the share was 28.4% of the year and 25.1% of its played games (README, "Placeholders"),
 * not the boards' pool the model sweep's own report reads, which adds League Standings' games and
 * leaves out the clubs taken off. Asked for no lists of names at all.
 */
export const storedStandInLines = (today: string): string[] => {
  const { year } = segmentOn(today);
  return standInLines(
    standInReport(loadScoutTeams(), loadScoutGamesForYear(year), loadAgeGroups(), year, 0)
  );
};

/** What a pull had just done as its next stage began, by the stage it had been in. */
const STAGE_DONE: Record<CloudPullStage["stage"], string> = {
  loading: "loading the copy",
  fetching: "asking GameChanger",
  filing: "filing, tidying and sweeping",
  tidying: "tidying",
  saving: "saving",
};

/**
 * The memory after each step of the night (`memoryWords`), said as the next begins, so a run that
 * runs out of memory has said what each step before it held: as a stage of the pull begins, after
 * the stage before it (`stage`); after the pull's last stage once it is over (`done`); and after a
 * step of the night's own, by name (`after`).
 */
export const stageMemory = (read: () => MemoryUse, say: (line: string) => void) => {
  let at: CloudPullStage["stage"] | null = null;
  const after = (step: string) => say(`  Memory after ${step}: ${memoryWords(read())}.`);
  return {
    stage: (next: CloudPullStage["stage"]) => {
      if (next === at) return;
      if (at) after(STAGE_DONE[at]);
      at = next;
    },
    done: () => {
      if (at) after(STAGE_DONE[at]);
      at = null;
    },
    after,
  };
};
