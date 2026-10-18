import type { AgelessAside } from "./agelessQueue";

/*
 * The asides a rule makes, in a module of their own (`agelessQueue.ts` reads and re-exports them):
 * the device's reader of the server's answers checks a count against them, and taking them from
 * the queue would bring the queue, and the import it reads, into whatever loads that reader.
 */

/**
 * The asides a rule makes, the queue's own reading of a row (`setAsideByRule`) and a roster short
 * of nine, in the order the card counts them. A team the owner answered, and one the rota has
 * stopped asking about, are not among them: neither comes back by itself.
 */
export const RULE_ASIDES = [
  "no-age-named",
  "no-games",
  "short-roster",
  "no-team-name",
  "made-up",
  "high-school",
] as const satisfies readonly AgelessAside[];

export type AgelessRuleAside = (typeof RULE_ASIDES)[number];

/** How many rows of the list each rule set aside, in `RULE_ASIDES` order, none that set none. */
export type AgelessSetAside = { aside: AgelessRuleAside; count: number }[];
