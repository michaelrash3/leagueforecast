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
