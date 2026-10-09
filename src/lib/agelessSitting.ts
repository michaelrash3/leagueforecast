import { isClearedReason } from "./agelessCleared";
import { agelessBatch, agelessWaiting, type AgelessRow } from "./agelessQueue";
import { agelessClearable, CLEARABLE_RULES, type AgelessAnswered } from "./agelessTriage";
import type { AgeUnknownList } from "./ageUnknown";
import type { DeletedClubs } from "./deletedGames";
import type { NamedAges } from "./namedAges";

/**
 * What the card of teams waiting on an age shows at a sitting (`AgelessReviewView`), worked out the
 * same way from a device's list and from the server's (`ageless.queue`, `queries.ts`): how many the
 * list holds and how many wait on a person, the ten in front of them, and the rows each rule has
 * settled, counted under the rule that claimed them.
 */

/** A rule's rows the card can clear, as the card draws them: how many, and a few by name. */
export type AgelessGroup = {
  rule: { id: string; label: string; because: string };
  count: number;
  /** The first three, by name or by id where there is none. */
  examples: string[];
};

export type AgelessSitting = {
  /** Every team on the list, answered or not: the card is drawn only while there is one. */
  listed: number;
  /** The teams still waiting on a person. */
  waiting: number;
  /** The ones in front of the person: the ten pinned (`agelessBatch`), less any answered since. */
  batch: AgelessRow[];
  groups: AgelessGroup[];
};

/**
 * The rows the rules have settled, grouped under the rule that claimed each, in `CLEARABLE_RULES`
 * order.
 */
export const clearGroups = (clearable: readonly AgelessAnswered[]): AgelessGroup[] => {
  const byRule = new Map<string, { hit: AgelessAnswered; rows: AgelessAnswered[] }>();
  clearable.forEach((hit) => {
    const group = byRule.get(hit.rule.id);
    if (group) group.rows.push(hit);
    else byRule.set(hit.rule.id, { hit, rows: [hit] });
  });
  return CLEARABLE_RULES.flatMap((id) => {
    const group = byRule.get(id);
    if (!group) return [];
    const { rule } = group.hit;
    return [
      {
        rule: { id: rule.id, label: rule.label, because: rule.because },
        count: group.rows.length,
        examples: group.rows.slice(0, 3).map(({ row }) => row.name ?? row.teamId),
      },
    ];
  });
};

/** The card at a sitting, from the list, the answers given, today, and the ten pinned. */
export const agelessSitting = (
  list: AgeUnknownList,
  named: NamedAges,
  dropped: DeletedClubs,
  now: Date,
  pinned: readonly string[]
): AgelessSitting => {
  const waiting = agelessWaiting(list, named, dropped, now);
  return {
    listed: list.length,
    waiting: waiting.length,
    batch: agelessBatch(waiting, pinned),
    groups: clearGroups(agelessClearable(waiting.map((row) => row.entry))),
  };
};

/**
 * What clearing the rows of the rules ticked takes off the list: the teams, by GameChanger id, and
 * how many of them each rule claimed, by its label, for the question asked first. Only the rows a
 * pass can say why it cleared (`isClearedReason`), as the device's own pass clears them.
 */
export const agelessClearPlan = (
  clearable: readonly AgelessAnswered[],
  rules: ReadonlySet<string>
): { teamIds: string[]; byRule: { label: string; count: number }[] } => {
  const rows = clearable.filter(
    ({ rule, verdict }) => rules.has(rule.id) && isClearedReason(verdict.kind)
  );
  const byRule = new Map<string, { label: string; count: number }>();
  rows.forEach(({ rule }) => {
    const known = byRule.get(rule.id);
    if (known) known.count += 1;
    else byRule.set(rule.id, { label: rule.label, count: 1 });
  });
  return { teamIds: rows.map(({ row }) => row.teamId), byRule: [...byRule.values()] };
};
