import { useEffect, useMemo, useRef, useState } from "react";
import type { ClubPickOption } from "../../lib/leagueLinkOptions";
import {
  answerStart,
  defaultStartWindow,
  seasonFromStart,
  START_CLUBS_MAX,
  startChoices,
  type StartAnswer,
  type StartChoice,
  type StartDraft,
  type StartPage,
  type StartQuery,
} from "../../lib/leagueStart";
import { askLeague } from "../../lib/live/leagueAsk";
import type { BuiltSeason } from "../../lib/roundRobin";
import { segmentOn } from "../../lib/teamRankings/seasons";
import {
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
} from "../../lib/teamRankingsStorage";
import { button, fieldFocusRing, focusRing, surface, textRole } from "../../styles/tokens";
import { StatePanel } from "../StatePanel";
import { EditLock } from "./EditLock";

/** Asks one step of a start (`answerStart`): of this device's pool, or of the cloud's. */
export type StartAsker = (query: StartQuery) => Promise<StartAnswer | null>;

/** This device's own Team Rankings, read where it is kept. */
export const deviceStartAsker: StartAsker = (query) =>
  Promise.resolve(
    answerStart(query, {
      ageGroups: loadAgeGroups,
      teams: loadScoutTeams,
      gamesForYear: loadScoutGamesForYear,
    })
  );

/** The cloud's Team Rankings, asked of the server as the signed-in member (`league.start`). */
export const cloudStartAsker: StartAsker = async (query) => {
  const answer = await askLeague({
    kind: "league.start",
    today: query.today,
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.clubs === undefined ? {} : { clubs: [...query.clubs] }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
  });
  return answer ? { pages: answer.pages, clubs: answer.clubs, draft: answer.draft } : null;
};

/** What the panel says when Team Rankings did not answer a step. */
export const START_UNREAD = "Team Rankings could not be read just now.";

/** How many of a page's clubs are listed at once; typing narrows the rest. */
const CLUBS_SHOWN = 40;

const matches = (club: ClubPickOption, words: string[]) => {
  const text = `${club.label} ${club.detail ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
};

const scoreText = (away: number | undefined, home: number | undefined) =>
  away === undefined || home === undefined ? "To play" : `${away}–${home}`;

/**
 * Starting a League Standings season from its clubs on Team Rankings (3.7): a page, the league's
 * clubs on it, the days to look in, and the games among them to look over, each kept or left out
 * and turned round where the home side is the other one. Every step is asked of `ask`, which is
 * this device's own pool or the cloud's, so the same games come back either way. Making the season
 * is the page's (`onCreate`): this only hands it over, with the Team Rankings page it is on.
 */
export function StartFromClubs({
  ask: given,
  live,
  today,
  innings,
  onCreate,
  onClose,
}: {
  /** Who is asked; by default the cloud for a member (`live`), this device's pool otherwise. */
  ask?: StartAsker;
  live: boolean;
  today: string;
  innings: number;
  onCreate: (season: BuiltSeason, page: StartPage) => void;
  onClose: () => void;
}) {
  const ask = given ?? (live ? cloudStartAsker : deviceStartAsker);
  const [pages, setPages] = useState<StartPage[] | null>(null);
  const [pageId, setPageId] = useState("");
  const [clubs, setClubs] = useState<ClubPickOption[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [days, setDays] = useState(() => defaultStartWindow(today));
  const [draft, setDraft] = useState<StartDraft | null>(null);
  const [choices, setChoices] = useState<StartChoice[]>([]);
  const [busy, setBusy] = useState<"pages" | "clubs" | "games" | null>("pages");
  const [failed, setFailed] = useState<"pages" | "clubs" | "games" | null>(null);
  // The latest question asked: an answer to an earlier one, come late, is not drawn.
  const asked = useRef(0);

  const run = (step: "pages" | "clubs" | "games", query: StartQuery) => {
    asked.current += 1;
    const mine = asked.current;
    setBusy(step);
    setFailed(null);
    return ask(query)
      .catch(() => null)
      .then((answer) => {
        if (mine !== asked.current) return null;
        setBusy(null);
        if (!answer) setFailed(step);
        return answer;
      });
  };

  const readPages = () => {
    void run("pages", { today }).then((answer) => {
      if (!answer) return;
      setPages(answer.pages);
      // The page of the baseball year being played, the youngest level first, to begin with.
      const year = segmentOn(today).year;
      const first = answer.pages.find((page) => page.year === year) ?? answer.pages[0];
      if (first) openPage(first.id);
    });
  };

  const openPage = (id: string) => {
    setPageId(id);
    setClubs(null);
    setPicked([]);
    setDraft(null);
    setChoices([]);
    void run("clubs", { today, page: id }).then((answer) => {
      if (answer) setClubs(answer.clubs ?? []);
    });
  };

  // The pages once, as the panel opens.
  const firstRead = useRef(readPages);
  useEffect(() => firstRead.current(), []);

  const findGames = () => {
    void run("games", {
      today,
      page: pageId,
      clubs: picked,
      from: days.from,
      to: days.to,
    }).then((answer) => {
      if (!answer?.draft) {
        if (answer) setFailed("games");
        return;
      }
      setDraft(answer.draft);
      setChoices(startChoices(answer.draft));
    });
  };

  const clubById = useMemo(() => new Map((clubs ?? []).map((club) => [club.id, club])), [clubs]);
  const nameOf = (id: string) => clubById.get(id)?.label ?? id;
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const listed = (clubs ?? []).filter((club) => !picked.includes(club.id) && matches(club, words));
  const page = pages?.find((one) => one.id === pageId);
  const kept = choices.filter((choice) => choice.keep).length;

  const pick = (id: string) => {
    setPicked((now) => (now.length >= START_CLUBS_MAX ? now : [...now, id]));
    setDraft(null);
  };
  const unpick = (id: string) => {
    setPicked((now) => now.filter((one) => one !== id));
    setDraft(null);
  };
  const choose = (gameId: string, change: Partial<StartChoice>) =>
    setChoices((now) =>
      now.map((choice) => (choice.gameId === gameId ? { ...choice, ...change } : choice))
    );

  const create = () => {
    if (!draft || !page) return;
    const teams = picked.map((id) => ({ id, name: nameOf(id) }));
    onCreate(seasonFromStart(teams, draft, choices, innings), page);
  };

  const retry =
    failed === "pages" ? readPages : failed === "clubs" ? () => openPage(pageId) : findGames;

  return (
    <section aria-labelledby="start-from-clubs" className={`${surface.primary} p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="start-from-clubs" className={textRole.sectionTitle}>
            Start from Team Rankings clubs
          </h2>
          <p className={`mt-1 ${textRole.pageLead}`}>
            Pick the league&apos;s clubs and the days to look in. Their games against each other
            come in with the scores GameChanger has, and each team is linked to its club.
          </p>
        </div>
        <button type="button" onClick={onClose} className={button.ghost}>
          Close
        </button>
      </div>

      {failed && (
        <StatePanel
          kind="error"
          className="mt-4"
          title={START_UNREAD}
          actions={
            <button type="button" onClick={retry} className={button.ghost}>
              Try again
            </button>
          }
        />
      )}
      {busy && (
        <StatePanel
          kind="loading"
          className="mt-4"
          title={
            busy === "pages"
              ? "Reading Team Rankings' pages…"
              : busy === "clubs"
                ? "Reading the page's clubs…"
                : "Finding their games…"
          }
        />
      )}

      {pages && pages.length === 0 && (
        <StatePanel kind="empty" className="mt-4" title="Team Rankings has no pages yet.">
          A page comes with the first GameChanger pull at an age. Pull the league&apos;s clubs in
          Team Rankings first, then start here.
        </StatePanel>
      )}

      {pages && pages.length > 0 && (
        <div className="mt-5 grid gap-5">
          <label className="grid gap-1">
            <span className={textRole.overline}>Team Rankings page</span>
            <select
              value={pageId}
              onChange={(event) => openPage(event.target.value)}
              className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
            >
              {pages.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>

          {clubs && (
            <div className="grid gap-3">
              <span className={textRole.overline}>
                The league&apos;s clubs ({picked.length} picked)
              </span>
              {picked.length > 0 && (
                <ul aria-label="Clubs picked" className="flex flex-wrap gap-2">
                  {picked.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => unpick(id)}
                        aria-label={`Take ${nameOf(id)} out`}
                        className={`rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${focusRing}`}
                      >
                        {nameOf(id)} ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="grid gap-1">
                <span className="sr-only">Find a club on this page</span>
                <input
                  type="search"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={`Find a club among ${clubs.length.toLocaleString("en-US")}`}
                  className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
                />
              </label>
              <ul aria-label="Clubs on this page" className={`${surface.inset} grid gap-1 p-2`}>
                {listed.slice(0, CLUBS_SHOWN).map((club) => (
                  <li key={club.id}>
                    <button
                      type="button"
                      onClick={() => pick(club.id)}
                      disabled={picked.length >= START_CLUBS_MAX}
                      aria-label={`Add ${club.label}`}
                      className={`flex w-full flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left hover:bg-white disabled:opacity-50 dark:hover:bg-slate-800 ${focusRing}`}
                    >
                      <span className="text-sm font-bold text-slate-950 dark:text-slate-100">
                        {club.label}
                      </span>
                      {club.detail && <span className={textRole.meta}>{club.detail}</span>}
                    </button>
                  </li>
                ))}
                {listed.length > CLUBS_SHOWN && (
                  <li className={`px-2 py-1 ${textRole.meta}`}>
                    {(listed.length - CLUBS_SHOWN).toLocaleString("en-US")} more: type to narrow the
                    list.
                  </li>
                )}
                {listed.length === 0 && (
                  <li className={`px-2 py-1 ${textRole.meta}`}>No club here by that name.</li>
                )}
              </ul>

              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1">
                  <span className={textRole.overline}>From</span>
                  <input
                    type="date"
                    value={days.from}
                    onChange={(event) => {
                      setDays((now) => ({ ...now, from: event.target.value }));
                      setDraft(null);
                    }}
                    className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
                  />
                </label>
                <label className="grid gap-1">
                  <span className={textRole.overline}>To</span>
                  <input
                    type="date"
                    value={days.to}
                    onChange={(event) => {
                      setDays((now) => ({ ...now, to: event.target.value }));
                      setDraft(null);
                    }}
                    className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={findGames}
                  disabled={picked.length < 2 || !days.from || !days.to || busy !== null}
                  className={button.dark}
                >
                  Find their games
                </button>
              </div>
            </div>
          )}

          {draft && (
            <div className="grid gap-3">
              <p className={textRole.body}>
                {draft.games.length === 0
                  ? "Team Rankings has no games among these clubs in those days. The season starts with its teams and no games, and games can be added on the Schedule."
                  : `${draft.games.length} game${draft.games.length === 1 ? "" : "s"} among these clubs. Untick a game that is not the league's, and swap a game whose home side is the other one: GameChanger's schedules do not say which side was at home.`}
                {draft.outside > 0 &&
                  ` ${draft.outside} more ${draft.outside === 1 ? "is" : "are"} outside those days.`}
              </p>
              {draft.games.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Games among the league&apos;s clubs</caption>
                    <thead>
                      <tr className={textRole.overline}>
                        <th scope="col" className="px-2 py-1">
                          Keep
                        </th>
                        <th scope="col" className="px-2 py-1">
                          Day
                        </th>
                        <th scope="col" className="px-2 py-1">
                          Away at home
                        </th>
                        <th scope="col" className="px-2 py-1">
                          Score
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.games.map((game) => {
                        const choice = choices.find((one) => one.gameId === game.gameId);
                        const swap = choice?.swap ?? false;
                        const [away, home] = swap ? [game.home, game.away] : [game.away, game.home];
                        const [awayRuns, homeRuns] = swap
                          ? [game.homeRuns, game.awayRuns]
                          : [game.awayRuns, game.homeRuns];
                        const label = `${nameOf(away)} at ${nameOf(home)}, ${game.date}`;
                        return (
                          <tr
                            key={game.gameId}
                            className="border-t border-slate-200 align-top dark:border-slate-800"
                          >
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={choice?.keep ?? false}
                                onChange={(event) =>
                                  choose(game.gameId, { keep: event.target.checked })
                                }
                                aria-label={`Keep ${label}`}
                              />
                            </td>
                            <td className={`px-2 py-2 ${textRole.numeric}`}>{game.date}</td>
                            <td className="px-2 py-2">
                              <span className="font-bold text-slate-950 dark:text-slate-100">
                                {nameOf(away)} at {nameOf(home)}
                              </span>
                              <button
                                type="button"
                                onClick={() => choose(game.gameId, { swap: !swap })}
                                aria-label={`Swap home and away for ${label}`}
                                className={`ml-2 rounded text-xs font-bold text-blue-700 underline dark:text-blue-300 ${focusRing}`}
                              >
                                Swap
                              </button>
                              {game.tournament && (
                                <span className={`block ${textRole.meta}`}>{game.tournament}</span>
                              )}
                              {game.otherRuns && (
                                <span className={`block ${textRole.meta}`}>
                                  {nameOf(game.home)}&apos;s schedule has it{" "}
                                  {swap
                                    ? `${game.otherRuns.homeRuns}–${game.otherRuns.awayRuns}`
                                    : `${game.otherRuns.awayRuns}–${game.otherRuns.homeRuns}`}
                                  ; the score shown is {nameOf(game.away)}&apos;s. Change it on the
                                  Schedule if theirs is right.
                                </span>
                              )}
                            </td>
                            <td className={`px-2 py-2 ${textRole.numeric}`}>
                              {scoreText(awayRuns, homeRuns)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div>
                <EditLock>
                  <button type="button" onClick={create} className={button.primary}>
                    Start the season: {picked.length} teams, {kept} game{kept === 1 ? "" : "s"}
                  </button>
                </EditLock>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
