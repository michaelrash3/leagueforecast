/*
 * What the import calls the evidence that two GameChanger teams are one club, apart from the import
 * itself: the live page's reader of a Pool health answer checks the evidence it is sent against
 * these names, and the import's code is not the live page's to download.
 */

/** The things that are not coincidences when two GameChanger teams are the same club. */
export type GcPairingEvidence =
  /** The same badge. GameChanger keeps a club's picture across seasons; nobody else has it. */
  | "avatar"
  /**
   * Two or more coaches in common, neither of them an organisation's officer.
   *
   * The strongest thing in the data, and `gcStaff.ts` has the measurements: over an export of
   * 52,470 teams, two teams sharing two staff names are in the same town 89.0% of the time, where
   * sharing one is 43.1% — barely better than picking a team at random from the same part of the
   * country. It is the only field that says anything about an organisation, because GameChanger
   * never names one.
   */
  | "staff"
  /** Both give the same town. */
  | "city"
  /** Both give the same state. */
  | "state"
  /** They played a club in common. */
  | "shared-opponent"
  /**
   * One of the two has no schedule of its own: every game filed against it came off somebody
   * else's. That is what an abandoned duplicate looks like and what a club's second squad at one
   * age does not — a real B team has its own schedule, an id somebody created and never used has
   * none. It is the whole of what separates the two in a single season.
   */
  | "no-schedule";

/** What the panel calls each piece of evidence. */
export const GC_PAIRING_EVIDENCE_LABEL: Record<GcPairingEvidence, string> = {
  avatar: "same picture",
  staff: "the same coaches",
  city: "same town",
  state: "same state",
  "shared-opponent": "a club in common",
  "no-schedule": "one has no schedule of its own",
};
