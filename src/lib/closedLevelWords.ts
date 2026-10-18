import { MIN_PAIRED_GAMES, type ClosedLevelCheck } from "./scoutBacktest";

/**
 * The Model check card's line on where a rating starts (`compareClosedLevels`): the model's own
 * constant, the level the last four weeks read, and whether that is clearly better. Numbers and
 * days only. It names no club and no league, and calls nobody closed: the owner asked that no
 * club or group be marked so anywhere on the site, and a line about the constant needs no names.
 */

const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A level in runs, with a minus of its own: two places, or as held (−1.6) when `held`. */
const levelText = (value: number, held = false): string => {
  const rounded = held ? value : Math.round(value * 100) / 100;
  const digits = held ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(2);
  return rounded < 0 ? `${MINUS}${digits}` : digits;
};

/** An ISO day as the card says one: "11 Oct". */
export const shortDay = (iso: string): string => {
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  return month ? `${Number(iso.slice(8, 10))} ${month}` : iso;
};

/**
 * Whether a re-measure judged the level at all: it read one, and scored at least
 * `MIN_PAIRED_GAMES` games with the other weeks' level, as `isClearlyBetter` asks before it calls
 * anything better. One that did not is a Monday between seasons, or at a year's edge where the
 * weeks hold few games between clubs an earlier fit rated: the card says too few games, and the
 * alarm step is handed a word that leaves its issue as it is (`closedLevelWord`), since nothing
 * was measured that could say a change ready is no longer ready.
 */
export const closedLevelJudged = (check: ClosedLevelCheck): boolean =>
  check.level !== null && check.paired !== null && check.paired.samples >= MIN_PAIRED_GAMES;

/** The one line, as a re-measure found it. */
export const closedLevelLine = (check: ClosedLevelCheck): string => {
  const head = `Starting level for leagues with few outside games: held at ${levelText(check.held, true)}`;
  const last = check.weeks[check.weeks.length - 1];
  const weeks = last ? `the four weeks to ${shortDay(last.to)}` : "the last four weeks";
  if (check.level === null) {
    return `${head}; ${weeks} had too few games between leagues to read it again.`;
  }
  const spread = check.standardError === null ? "" : ` ± ${check.standardError.toFixed(2)}`;
  const read = `${weeks} read ${levelText(check.level)}${spread} on ${check.games.toLocaleString("en-US")} games`;
  const paired = check.paired;
  const verdict = !closedLevelJudged(check)
    ? "too few games to judge"
    : check.better && paired
      ? `clearly better, by ${paired.by.toFixed(4)} runs a game, give or take ${paired.standardError.toFixed(4)}, so a change to ${levelText(check.level)} is ready`
      : "not yet clearly better";
  return `${head}; ${read}; ${verdict}.`;
};
