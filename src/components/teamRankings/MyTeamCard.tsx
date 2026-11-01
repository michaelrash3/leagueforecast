import type { MyTeamGlance } from "../../lib/myTeamGlance";
import { dayAndTime, formatIsoDayShort, formatStartTime } from "../../lib/date";
import { formatRating, MovementMark } from "./RankingList";
import { card } from "../../styles/tokens";
import type { RankHistoryPoint } from "../../hooks/useRankingsWorker";
import type { ExpectedRecord, WeekendAhead } from "../../lib/clubForm";
import type { UpcomingMatchup } from "../../lib/teamRankings";
import { standingWords } from "../../lib/standing";
import { MyTeamSince } from "./MyTeamSince";

type MyTeamCardProps = {
  glance: MyTeamGlance;
  /** Its place week by week, oldest first, ending a week ago; today's is the glance's own. */
  history?: RankHistoryPoint[];
  /** Which half of the season the numbers are for, when the page has one. */
  segmentName?: string;
  onOpenTeam: (teamId: string) => void;
  /**
   * Whether the schedule is still to come in: the live board has the places but not the games, so
   * "no game on the schedule" would be a guess.
   */
  nextPending?: boolean;
  /**
   * Whether the schedule could not be had: the live board's card of the club would not read, so
   * the card says nothing of a next game rather than that there is none.
   */
  nextUnread?: boolean;
  /** Scouting's Compare with on the next game's opponent, beside our club (`ScoutButton`). */
  onScout?: (opponentId: string) => void;
  /** Its record against the clubs rated here beside the one its ratings expected (`clubForm.ts`). */
  expected?: ExpectedRecord;
  /**
   * Whether the board is fitted to the latest games, for "Since you last looked" (`MyTeamSince`):
   * the line compares only a settled board with the last visit's. Left out, the line is not shown.
   */
  settled?: boolean;
};

/** "1st", "2nd", "3rd", "11th", "22nd". */
export const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n.toLocaleString()}${suffix}`;
};

/**
 * A record beside the one the ratings expected, in words: "9–11 against rated clubs, about one win
 * better than the ratings expect (8.1)". Within half a win is "about what the ratings expect".
 */
export const expectedWords = (expected: ExpectedRecord): string => {
  const { wins, losses, ties, expectedWins, oneRun } = expected;
  const record = `${wins}–${losses}${ties > 0 ? `–${ties}` : ""}`;
  const off = wins - expectedWins;
  const by = Math.round(Math.abs(off));
  const said =
    Math.abs(off) < 0.5
      ? "about what the ratings expect"
      : `about ${by === 1 ? "one win" : `${by} wins`} ${off > 0 ? "better" : "worse"} than the ratings expect`;
  const close =
    oneRun.wins + oneRun.losses > 0 ? ` · one-run games ${oneRun.wins}–${oneRun.losses}` : "";
  return `${record} against rated clubs, ${said} (${expectedWins.toFixed(1)})${close}`;
};

/**
 * The wins a weekend's games add up to, said only of the games the ratings can call: ", about 1.4
 * wins expected", "… from the 2 the ratings can call" where some cannot be, and nothing where none
 * can, which would read as a weekend expected to be lost.
 */
const weekendExpected = ({ games, called, expectedWins }: WeekendAhead): string => {
  if (called === 0) return "";
  const of = called < games.length ? ` from the ${called} the ratings can call` : "";
  return `, about ${expectedWins.toFixed(1)} wins expected${of}`;
};

/**
 * The team marked as yours, where it stands and what it plays next, above the boards.
 *
 * The line a parent reads out at the field — "#412 of 15,629, #18 in Ohio, 12-4, Saturday against
 * the Bears at 58%" — without Show all and page after page of the table. The name opens the team's
 * panel, which has the rest.
 */
/** "Aug 30" for an ISO day, as the rest of the card says its dates. */
const shortDay = (day: string): string => formatIsoDayShort(day);

/**
 * When one of a weekend's games is, within the weekend the line has named: "Sat 9:30 AM", in the
 * reader's own time, or the day alone for a game GameChanger gave no start.
 */
const weekendWhen = ({ date, startTs }: UpcomingMatchup): string =>
  [
    new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: "short",
      timeZone: "UTC",
    }),
    formatStartTime(startTs),
  ]
    .filter(Boolean)
    .join(" ");

const LINE_WIDTH = 168;
const LINE_HEIGHT = 36;

/**
 * The club's standing week by week, as a line: the share of its board at or above it, so a club
 * that holds its own draws flat. The place alone sank all season for a club in the middle, as
 * the board filled with clubs playing their first games (#439 of the clubs ranked on 1 September,
 * #2,737 of 7,126 by late October), and read as a team getting worse.
 *
 * The board is the clubs listed by rating (`of`, `nowOf`), not those listed after them, and the
 * line is drawn on the whole board, the top edge its top and the bottom edge its foot. Scaled to
 * its own range, as it was, a club near the foot that moved from the top 93% to the top 84% drew a
 * climb from the bottom edge to the top, and its owner, whose team was losing, read the line going
 * up all season. Drawn on the whole board, a club near the foot sits near the bottom edge and a
 * move of a few points is a few pixels. Only weeks it had a place on a board of known size are
 * drawn, and nothing at all until two of them are known, because one point is not a line.
 */
export function StandingLine({
  history,
  now,
  nowOf,
}: {
  history: RankHistoryPoint[];
  now: number;
  nowOf: number;
}) {
  // A week the club was listed last has a place past the clubs listed by rating, and no share of them.
  const points = [...history, { asOf: "", rank: now, of: nowOf }].flatMap((point) =>
    point.rank !== null && point.of !== undefined && point.of > 0 && point.rank <= point.of
      ? [
          {
            asOf: point.asOf,
            share: point.rank / point.of,
            words: standingWords(point.rank, point.of),
          },
        ]
      : []
  );
  if (points.length < 2) return null;
  const x = (at: number) => 4 + (at * (LINE_WIDTH - 8)) / (points.length - 1);
  const y = (share: number) => 4 + share * (LINE_HEIGHT - 8);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  // Today's point is the one without a day. A club listed last today has none, and its line ends
  // on the last week it had a share, which is said by its day, not as now.
  const when = (point: { asOf: string }) => (point.asOf ? `on ${shortDay(point.asOf)}` : "now");
  const said = points.map((point) => `${point.words} ${when(point)}`).join(", ");
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
      <svg
        role="img"
        aria-label={`Standing by week: ${said}`}
        width={LINE_WIDTH}
        height={LINE_HEIGHT}
        viewBox={`0 0 ${LINE_WIDTH} ${LINE_HEIGHT}`}
        className="shrink-0 overflow-visible"
      >
        <polyline
          points={points.map((point, at) => `${x(at)},${y(point.share)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          className="text-blue-600 dark:text-blue-400"
        />
        {points.map((point, at) => (
          <circle
            key={point.asOf || "now"}
            cx={x(at)}
            cy={y(point.share)}
            r={at === points.length - 1 ? 3 : 2}
            className="fill-blue-600 dark:fill-blue-400"
          />
        ))}
      </svg>
      <span>
        {first.words.charAt(0).toUpperCase() + first.words.slice(1)} {when(first)}, {last.words}{" "}
        {when(last)}
      </span>
    </div>
  );
}

export function MyTeamCard({
  glance,
  segmentName,
  onOpenTeam,
  history,
  nextPending = false,
  nextUnread = false,
  onScout,
  expected,
  settled,
}: MyTeamCardProps) {
  const { schedule, weekend } = glance;
  const { next } = glance;
  return (
    <section aria-label="My team" className={`${card} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => onOpenTeam(glance.teamId)}
          className="text-left text-lg font-black text-slate-950 hover:underline dark:text-white"
        >
          <span aria-hidden="true" className="mr-1 text-amber-500">
            ★
          </span>
          {glance.teamName}
        </button>
        {segmentName && (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {segmentName}
          </span>
        )}
      </div>
      {settled !== undefined && (
        <MyTeamSince
          glance={glance}
          {...(segmentName ? { board: segmentName } : {})}
          settled={settled}
        />
      )}
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        <strong>
          #{glance.nationalRank.toLocaleString()} of {glance.nationalOf.toLocaleString()}
        </strong>{" "}
        nationally
        {glance.movement !== undefined && glance.movement !== 0 && (
          <>
            {" "}
            <MovementMark movement={glance.movement} />
          </>
        )}
        {glance.state && glance.stateRank !== undefined && glance.stateOf !== undefined && (
          <>
            {" · "}
            <strong>
              #{glance.stateRank.toLocaleString()} of {glance.stateOf.toLocaleString()}
            </strong>{" "}
            in {glance.state}
          </>
        )}
        {" · "}
        {glance.record} · {formatRating(glance.rating)}
      </p>
      {(schedule || expected) && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {schedule && glance.state && (
            <>
              Schedule: <strong>{ordinal(schedule.rank)} toughest</strong> of{" "}
              {schedule.of.toLocaleString()} in {glance.state}
            </>
          )}
          {schedule && glance.state && expected && " · "}
          {expected && expectedWords(expected)}
        </p>
      )}
      {history && (
        <StandingLine history={history} now={glance.nationalRank} nowOf={glance.listedOf} />
      )}
      {(next || !nextUnread) && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {next ? (
            <>
              Next: {next.date ? dayAndTime(shortDay(next.date), next.startTs) : "date to come"} vs{" "}
              <strong>{next.opponentName}</strong>
              {next.opponentRank !== undefined && ` (#${next.opponentRank.toLocaleString()})`}
              {next.winProb === undefined
                ? " — not rated yet"
                : next.unconnected
                  ? ` — ${Math.round(next.winProb * 100)}% to win, a guess: no shared opponents yet`
                  : ` — ${Math.round(next.winProb * 100)}% to win`}
              {onScout && next.winProb !== undefined && (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => onScout(next.opponentId)}
                    aria-label={`Scout ${next.opponentName}`}
                    className="font-bold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Scout
                  </button>
                </>
              )}
            </>
          ) : nextPending ? (
            "Next game: loading…"
          ) : (
            "No game on the schedule yet."
          )}
        </p>
      )}
      {weekend && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Weekend to {shortDay(weekend.sunday)}: {weekend.games.length} games
          {weekendExpected(weekend)}
          {weekend.toughest && weekend.likeliest && (
            <>
              {" · toughest vs "}
              <strong>{weekend.toughest.opponentName}</strong> (
              {Math.round(weekend.toughest.winProb! * 100)}%, {weekendWhen(weekend.toughest)})
              {" · likeliest vs "}
              <strong>{weekend.likeliest.opponentName}</strong> (
              {Math.round(weekend.likeliest.winProb! * 100)}%, {weekendWhen(weekend.likeliest)})
            </>
          )}
        </p>
      )}
    </section>
  );
}
