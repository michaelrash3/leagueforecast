import { LOPSIDED_MARGIN } from "../autoRemoved";
import { describeTidy } from "../gameChangerImport";
import type { CloudPullResult } from "./cloudRunner";

/*
 * What the nightly says of its pull beyond its first line (`scripts/nightly.ts`, README "The
 * nightly refresh on GitHub"): what the tidy changed, step by step, and what the sweep deleted
 * under the owner's 40-run rule, took off the boards and put back. Counts only, a line at a time:
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
