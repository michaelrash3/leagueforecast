/** The Sunday ending a date's week ("2026-10-30" to "2026-11-01"), so Friday to Sunday are one. */
export const weekEndingSunday = (date: string | undefined): string | undefined => {
  if (!date) return undefined;
  const at = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(at)) return undefined;
  const day = new Date(at).getUTCDay();
  return new Date(at + ((7 - day) % 7) * 86_400_000).toISOString().slice(0, 10);
};

/**
 * The clubs of a team's next playing weekend, each once, in the order they are played: the week of
 * the first dated game still to come. "Add our next opponents" took every game left, which put the
 * rest of the season into one weekend's field. A game with no date could be any weekend, so it is
 * left out wherever anything is dated, and only where nothing is are the undated ones the field.
 */
export const nextWeekendOpponents = (
  upcoming: readonly { date: string; opponentId: string }[]
): string[] => {
  const dated = upcoming
    .filter((row) => weekEndingSunday(row.date) !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = dated[0];
  const field = first
    ? dated.filter((row) => weekEndingSunday(row.date) === weekEndingSunday(first.date))
    : upcoming;
  return [...new Set(field.map((row) => row.opponentId))];
};
