/**
 * What a League Standings season's own name says about it. A season is named by whoever made it —
 * "Fall 2026", "2027 Spring", "NKB 9U 2026-27" — so these read the shapes people write and say
 * nothing where a name does not say.
 */

/** A four-digit year, and a second one after a dash or slash when the name gives a span. */
const YEAR = /\b((?:19|20)\d{2})(?:\s*[-–/]\s*((?:19|20)?\d{2}))?\b/g;

const SEASON_WORD = /\b(fall|autumn|winter|spring|summer)\b/gi;

/**
 * The season word written right beside a year, before or after it: "Fall 2026", "2026-fall". Only
 * spaces or one hyphen may stand between them, so a dash that parts two halves of a name is not
 * read across: in "2026 Fall - 2027 Spring" the Fall is the 2026's, not the 2027's.
 */
const besideBefore = /\b(fall|autumn|winter|spring|summer)(?:\s+|-)$/i;
const besideAfter = /^(?:\s+|-)(fall|autumn|winter|spring|summer)\b/i;

/**
 * The squad year a season's name places it in, or nothing when the name gives no year or one that
 * cannot be told. A squad year runs August to July and is called by its spring, as Team Rankings
 * files it (`squadYearForGcSeason`): "Fall 2026" is squad year 2027, "Spring 2027" and "2027
 * Spring" are 2027, and a span names the year it ends, so "2026-27" is 2027.
 *
 * The last year in the name is the one read, with the season word beside it, or else the one
 * season word the name has: "Fall Ball 2026" is a fall league, while "Fall 2026 / Spring 2027" is
 * read by its spring. A lone "Winter 2026" gives nothing, since a winter's label names either year
 * it straddles (`squadYearsForGcSeason`), and an age like "9U" is never a year.
 */
export const squadYearFromName = (name: string): number | undefined => {
  const years = [...name.matchAll(YEAR)];
  const last = years[years.length - 1];
  if (!last) return undefined;
  const year = Number(last[1]);
  const second = last[2];
  if (second !== undefined) {
    const later =
      second.length === 2 ? Math.floor(year / 100) * 100 + Number(second) : Number(second);
    if (later === year + 1) return later;
  }
  const at = last.index ?? 0;
  // Autumn is fall by another name, so a name using both still has one season word.
  const words = new Set(
    [...name.matchAll(SEASON_WORD)].map((word) => word[1]?.toLowerCase().replace("autumn", "fall"))
  );
  const beside =
    besideBefore.exec(name.slice(0, at))?.[1] ??
    besideAfter.exec(name.slice(at + last[0].length))?.[1] ??
    (words.size === 1 ? [...words][0] : undefined);
  const season = beside?.toLowerCase();
  if (season === "fall" || season === "autumn") return year + 1;
  if (season === "winter") return undefined;
  return year;
};

/** A two-digit year written beside a season word ("Spring 26") or after an apostrophe ("'26"). */
const SHORT_YEAR = /\b(fall|autumn|winter|spring|summer)\s+['‘’]?(\d{2})\b|(^|\s)['‘’](\d{2})\b/gi;

/**
 * The name with each short year the stem takes out written in full, as this century's: "Spring
 * '26" is "Spring 2026" and "NKB '26 Fall" is "NKB 2026 Fall". So `squadYearFromName`, which reads
 * only four-digit years, can place a season named the short way beside its siblings named the long
 * way, which the stem puts in one group (`glanceGroups`).
 */
export const withFullYears = (name: string): string =>
  name.replace(
    SHORT_YEAR,
    (
      _short: string,
      season: string | undefined,
      besideSeason: string | undefined,
      before: string | undefined,
      afterApostrophe: string | undefined
    ) =>
      season !== undefined
        ? `${season} 20${besideSeason ?? ""}`
        : `${before ?? ""}20${afterApostrophe ?? ""}`
  );

/** What may be left standing at either end, or twice over, once a year is taken out. */
const SEPARATOR = /[-–—/|·:,]/;

/**
 * A season's name with its year taken out: what one league's seasons have in common from year to
 * year, so League Standings can set them side by side (`seasonGlance.ts`). "Fall 2026" and "Fall
 * 2027" are both "Fall", "NKB 9U 2026-27" is "NKB 9U", and "Spring '26" is "Spring". A name with
 * no year is its own stem, and one that is only a year has none ("").
 *
 * Only a year is taken out. A span goes whole when its second year is a later one, and otherwise
 * the four-digit year alone ("2026 - 12 teams"); a short year only beside a season word or after an
 * apostrophe, so "Division 12" keeps its 12; and an age like "9U" is never a year. A second year of
 * two digits is read as one only where a span is written that way: tight against its dash or slash
 * ("2026-27", "2026-28"), or ending the name ("Wolves 2026 - 27"). Spaced out with more after it,
 * it is a count, as in "Spring 2026 - 27 teams", which keeps its 27 and its dash. A season word
 * stays, since a league's fall and spring seasons are different leagues to compare, and so does
 * anything else a name says, case included: the stem is shown as the group's name.
 */
export const seasonNameStem = (name: string): string => {
  const cut = name
    .replace(
      YEAR,
      (whole: string, first: string, second: string | undefined, at: number, all: string) => {
        const year = Number(first);
        const later =
          second === undefined
            ? undefined
            : second.length === 2
              ? Math.floor(year / 100) * 100 + Number(second)
              : Number(second);
        const written =
          second?.length === 4 ||
          !/\s/.test(whole) ||
          /^[\s)\]}]*$/.test(all.slice(at + whole.length));
        return later !== undefined && later > year && written
          ? " "
          : ` ${whole.slice(first.length)}`;
      }
    )
    .replace(
      SHORT_YEAR,
      (
        _short: string,
        season: string | undefined,
        _besideSeason: string | undefined,
        before: string | undefined
      ) => season ?? before ?? ""
    )
    // Brackets the year sat in alone, as in "Fall (2026)".
    .replace(/[([{]\s*[)\]}]/g, " ");
  const words = cut.split(/\s+/).filter(Boolean);
  // A separator left at either end, or beside another, stood between the year and something else.
  const kept = words.filter((word, index) => {
    if (!SEPARATOR.test(word) || word.length > 1) return true;
    const next = words[index + 1];
    return index > 0 && next !== undefined && !(next.length === 1 && SEPARATOR.test(next));
  });
  return kept
    .join(" ")
    .replace(/\s+([,:])/g, "$1")
    .replace(/^[-–—/|·:,\s]+|[-–—/|·:,\s]+$/g, "");
};
