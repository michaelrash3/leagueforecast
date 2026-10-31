import { useEffect, useMemo, useRef, useState } from "react";
import { parseGcOrgId } from "../../lib/gameChangerApi";
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
  type StartOrg,
  type StartPage,
  type StartQuery,
} from "../../lib/leagueStart";
import { askLeague } from "../../lib/live/leagueAsk";
import type { BuiltSeason } from "../../lib/roundRobin";
import { poolFilled } from "../../lib/poolFill";
import { segmentOn } from "../../lib/teamRankings/seasons";
import {
  loadAgeGroups,
  loadOrgMembership,
  loadScoutGamesForYear,
  loadScoutTeams,
} from "../../lib/teamRankingsStorage";
import { button, fieldFocusRing, focusRing, surface, textRole } from "../../styles/tokens";
import { StatePanel } from "../StatePanel";
import { StartDraftReview } from "./StartDraftReview";

/** Asks one step of a start (`answerStart`): of this device's pool, or of the cloud's. */
export type StartAsker = (query: StartQuery) => Promise<StartAnswer | null>;

/** This device's own Team Rankings, read where it is kept, once it is read in (`poolFill.ts`). */
export const deviceStartAsker: StartAsker = (query) =>
  poolFilled().then(() =>
    answerStart(query, {
      ageGroups: loadAgeGroups,
      teams: loadScoutTeams,
      gamesForYear: loadScoutGamesForYear,
      orgs: loadOrgMembership,
    })
  );

/** The cloud's Team Rankings, asked of the server as the signed-in member (`league.start`). */
export const cloudStartAsker: StartAsker = async (query) => {
  const answer = await askLeague({
    kind: "league.start",
    today: query.today,
    ...(query.org === undefined ? {} : { org: query.org }),
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.clubs === undefined ? {} : { clubs: [...query.clubs] }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
  });
  if (!answer) return null;
  const { kind: _kind, ...start } = answer;
  return start;
};

/** What the panel says when Team Rankings did not answer a step. */
export const START_UNREAD = "Team Rankings could not be read just now.";

/** How many of a page's clubs are listed at once; typing narrows the rest. */
const CLUBS_SHOWN = 40;

const matches = (club: ClubPickOption, words: string[]) => {
  const text = `${club.label} ${club.detail ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
};

/** The steps a start asks one at a time, each with its own wait and its own "Try again". */
type StartStep = "pages" | "clubs" | "games" | "org";

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/**
 * What the panel says about an organization it was asked to start from: what was found and put in,
 * or why nothing was. `org` is undefined only where an answer left it out.
 */
export const orgStartNote = (
  org: StartOrg | undefined,
  picked: number,
  pageName: string | undefined
): string => {
  if (!org) return "Team Rankings said nothing about that organization. Try again.";
  if (!org.found)
    return "That organization is not in the Organizations file Team Rankings keeps. Load the crawl's Organizations CSV in Team Rankings → Import, then try again, or start from the organization's own GameChanger schedule with From an organization.";
  const teams = org.teams ?? 0;
  const pulled = org.pulled ?? 0;
  const name = org.name || "The organization";
  const unpulled = teams - pulled;
  const notYet =
    unpulled > 0
      ? ` ${plural(unpulled, "of its teams is", "of its teams are")} not pulled into Team Rankings yet.`
      : "";
  if (!pageName || picked === 0)
    return `${name} lists ${plural(teams, "team", "teams")}, and none is a club Team Rankings has pulled yet.`;
  return `${name}: ${plural(picked, "club", "clubs")} on ${pageName}, all picked.${notYet}`;
};

const SWAP =
  "swap a game whose home side is the other one: GameChanger's schedules do not say which side was at home.";

/**
 * What the review says above a start's games, as their boxes stand when it opens (`startChoices`):
 * how many there are, how many start unticked as a tournament's and so are to be ticked where they
 * are the league's, and what else to check. It said to untick what was not the league's whatever
 * the boxes showed, over a draft whose every game started unticked.
 */
export const clubsDraftLead = (draft: StartDraft): string => {
  const total = draft.games.length;
  const outside =
    draft.outside > 0
      ? ` ${draft.outside} more ${draft.outside === 1 ? "is" : "are"} outside those days.`
      : "";
  if (total === 0)
    return `Team Rankings has no games among these clubs in those days. The season starts with its teams and no games, and games can be added on the Schedule.${outside}`;
  const games = plural(total, "game", "games");
  const unticked = draft.games.filter((game) => game.tournament).length;
  const one = unticked === 1;
  const why = one
    ? "since it looks like a tournament game (it says why): tick it if it is the league's"
    : "since they look like tournament games (each says why): tick the ones that are the league's";
  const lead =
    unticked === 0
      ? `${games} among these clubs, ${total === 1 ? "ticked" : "all ticked"}. Untick a game that is not the league's, and ${SWAP}`
      : unticked === total
        ? `${games} among these clubs, ${one ? "unticked" : "all unticked"}, ${why}, and ${SWAP}`
        : `${games} among these clubs. ${unticked} ${one ? "starts" : "start"} unticked, ${why}. Untick any other that is not, and ${SWAP}`;
  return `${lead}${outside}`;
};

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
  const [busy, setBusy] = useState<StartStep | null>("pages");
  const [failed, setFailed] = useState<StartStep | null>(null);
  const [orgText, setOrgText] = useState("");
  // What the last organization asked about came back with; null before one is asked about.
  const [orgSaid, setOrgSaid] = useState<{ org: StartOrg | undefined; picked: number } | null>(
    null
  );
  // The latest question asked: an answer to an earlier one, come late, is not drawn.
  const asked = useRef(0);

  const run = (step: StartStep, query: StartQuery) => {
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
    setOrgSaid(null);
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

  // One question in place of a page's clubs and then their games: the organization's clubs found,
  // on the page most of them are on, picked, with the draft of their games over the days shown.
  const orgId = parseGcOrgId(orgText);
  const startFromOrg = () => {
    if (!orgId) return;
    void run("org", { today, org: orgId, from: days.from, to: days.to }).then((answer) => {
      if (!answer) return;
      if (answer.pages.length > 0) setPages(answer.pages);
      if (answer.page === undefined || !answer.clubs || !answer.draft) {
        setOrgSaid({ org: answer.org, picked: 0 });
        return;
      }
      setOrgSaid({ org: answer.org, picked: (answer.picked ?? []).length });
      setPageId(answer.page);
      setClubs(answer.clubs);
      setPicked(answer.picked ?? []);
      setFilter("");
      setDraft(answer.draft);
      setChoices(startChoices(answer.draft));
    });
  };

  const clubById = useMemo(() => new Map((clubs ?? []).map((club) => [club.id, club])), [clubs]);
  const nameOf = (id: string) => clubById.get(id)?.label ?? id;
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const listed = (clubs ?? []).filter((club) => !picked.includes(club.id) && matches(club, words));
  const page = pages?.find((one) => one.id === pageId);

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
    failed === "pages"
      ? readPages
      : failed === "clubs"
        ? () => openPage(pageId)
        : failed === "org"
          ? startFromOrg
          : findGames;

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
                : busy === "org"
                  ? "Finding the organization's clubs and their games…"
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
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              startFromOrg();
            }}
          >
            <label className="grid gap-1">
              <span className={textRole.overline}>GameChanger organization ID or link</span>
              <span className={textRole.meta}>
                The league&apos;s organization picks its clubs, and the page most of them are on,
                from the Organizations file Team Rankings keeps.
              </span>
              <input
                type="text"
                value={orgText}
                onChange={(event) => setOrgText(event.target.value)}
                placeholder="NRsPUpJj6Eed or web.gc.com/organizations/…"
                autoComplete="off"
                spellCheck={false}
                className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={!orgId || busy !== null} className={button.dark}>
                Start from the organization
              </button>
              {orgText.trim() !== "" && !orgId && (
                <span className={textRole.meta}>
                  That is not an organization ID or a gc.com organizations link.
                </span>
              )}
            </div>
            {orgSaid && (
              <p role="status" className={textRole.body}>
                {orgStartNote(orgSaid.org, orgSaid.picked, page?.name)}
              </p>
            )}
          </form>

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
            <StartDraftReview
              draft={draft}
              choices={choices}
              onChoose={choose}
              nameOf={nameOf}
              teams={picked.length}
              lead={clubsDraftLead(draft)}
              onStart={create}
            />
          )}
        </div>
      )}
    </section>
  );
}
