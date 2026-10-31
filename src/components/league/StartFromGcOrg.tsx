import { useMemo, useRef, useState } from "react";
import { parseGcOrgId, type GcTeamResponse } from "../../lib/gameChangerApi";
import { BATCH_SIZE, fetchGcTeams } from "../../lib/gameChangerClient";
import { fetchGcOrgTeams, type GcOrgTeamsFetch } from "../../lib/gcOrgClient";
import {
  groupOrgTeams,
  orgDraft,
  orgStartPage,
  readGcOrgTeams,
  type GcOrgGroup,
  type PulledOrgTeam,
} from "../../lib/gcOrgSchedule";
import {
  seasonFromStart,
  START_CLUBS_MAX,
  startChoices,
  type StartChoice,
  type StartDraft,
  type StartPage,
} from "../../lib/leagueStart";
import { poolFilled } from "../../lib/poolFill";
import type { BuiltSeason } from "../../lib/roundRobin";
import { loadScoutTeams } from "../../lib/teamRankingsStorage";
import { button, fieldFocusRing, surface, textRole } from "../../styles/tokens";
import { StatePanel } from "../StatePanel";
import { StartDraftReview } from "./StartDraftReview";

/** What the panel asks of GameChanger and of this device; tests hand in their own. */
export type GcOrgStartDeps = {
  /** An organization's team list, through the app's GameChanger proxy: one request. */
  findTeams: (orgId: string) => Promise<GcOrgTeamsFetch>;
  /** These teams' schedules, through the proxy: one request for every ten teams. */
  pullTeams: (teamIds: readonly string[]) => Promise<ReadonlyMap<string, GcTeamResponse>>;
  /** Each GameChanger team id this device's Team Rankings pulled a club under, and the club. */
  clubLinks: () => Promise<ReadonlyMap<string, string>>;
};

/**
 * The proxy for GameChanger, and the clubs of this device's own pool for links. A device whose
 * Team Rankings is the cloud's holds no pool, so its teams are linked to no club; a team can be
 * linked to its club by hand afterwards, as any team can.
 */
export const gcOrgStartDeps = (live: boolean): GcOrgStartDeps => ({
  findTeams: (orgId) => fetchGcOrgTeams(orgId),
  // A pull the proxy turns away (not signed in with an account on the list) stops there; each team
  // left unasked carries the proxy's reason, rather than none.
  pullTeams: async (teamIds) => {
    let refusal: string | undefined;
    const results = new Map(
      await fetchGcTeams([...teamIds], {
        onMembersOnly: (message) => {
          refusal = message;
        },
      })
    );
    if (refusal !== undefined) {
      teamIds.forEach((id) => {
        if (!results.has(id)) {
          results.set(id, { ok: false, reason: "members-only", message: refusal ?? "" });
        }
      });
    }
    return results;
  },
  clubLinks: () =>
    live
      ? Promise.resolve(new Map())
      : poolFilled().then(
          () =>
            new Map(
              loadScoutTeams()
                .filter((team) => !team.placeholder)
                .flatMap((team) => (team.gcTeams ?? []).map((link) => [link.teamId, team.id]))
            )
        ),
});

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** What the review says above the games it found. */
export const orgDraftLead = (draft: StartDraft): string =>
  draft.games.length === 0
    ? "GameChanger lists no games between these teams. The season starts with its teams and no games, and games can be added on the Schedule."
    : `${plural(draft.games.length, "game", "games")} between these teams, from their own GameChanger schedules. Untick a game that is not the league's (one played on a day either team played somebody else starts unticked), and swap a game whose home side is wrong.`;

type Busy = "teams" | "schedules" | null;

/**
 * The teams a division starts with ticked: all of them, unless there are more than a league is
 * (`START_CLUBS_MAX`), as where an organization's list gives no season or age and every team it has
 * ever had is one group; then none, and the owner ticks the league's own.
 */
const firstPicks = (group: GcOrgGroup): string[] =>
  group.teams.length > START_CLUBS_MAX ? [] : group.teams.map((team) => team.id);

/**
 * Starting a League Standings season from a GameChanger organization's own schedule (the owner's
 * ask of 26 October 2026): the organization's teams, read through the app's GameChanger proxy;
 * one season and age of them, the league's division; their schedules, pulled through the proxy as
 * Team Rankings pulls a team's; and the games between them, to look over before the season is made
 * (`gcOrgSchedule.ts`). Nothing is kept in the cloud or on this device until the season is made.
 */
export function StartFromGcOrg({
  live,
  innings,
  onCreate,
  onClose,
  deps: given,
}: {
  live: boolean;
  innings: number;
  /** Makes the season, and places it on its Team Rankings page where one is known. */
  onCreate: (season: BuiltSeason, page: StartPage | undefined) => void;
  onClose: () => void;
  deps?: GcOrgStartDeps;
}) {
  const deps = useMemo(() => given ?? gcOrgStartDeps(live), [given, live]);
  const [orgText, setOrgText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null);
  const [groups, setGroups] = useState<GcOrgGroup[] | null>(null);
  const [groupKey, setGroupKey] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pulled, setPulled] = useState<ReadonlyMap<string, PulledOrgTeam>>(new Map());
  const [unpulled, setUnpulled] = useState<{ name: string; message: string }[]>([]);
  const [draft, setDraft] = useState<StartDraft | null>(null);
  const [choices, setChoices] = useState<StartChoice[]>([]);
  // The latest question asked: an answer to an earlier one, come late, is not drawn.
  const asked = useRef(0);
  // The picking's changes: a pull that ends after one keeps what it brought, but draws no review of
  // a picking that is no longer the one shown (Codex on #460).
  const selection = useRef(0);

  const orgId = parseGcOrgId(orgText);
  const group = groups?.find((one) => one.key === groupKey);
  const nameOf = (id: string) =>
    group?.teams.find((team) => team.id === id)?.name ??
    pulled.get(id)?.schedule.profile.name ??
    id;

  const findTeams = () => {
    if (!orgId) return;
    asked.current += 1;
    const mine = asked.current;
    setBusy("teams");
    setProblem(null);
    setGroups(null);
    setDraft(null);
    setPulled(new Map());
    setUnpulled([]);
    void deps.findTeams(orgId).then((answer) => {
      if (mine !== asked.current) return;
      setBusy(null);
      if (!answer.ok) {
        setProblem({
          title:
            answer.reason === "not-found"
              ? "GameChanger lists no public organization with that ID."
              : "GameChanger's list of the organization's teams could not be had.",
          detail: answer.message,
        });
        return;
      }
      const reading = readGcOrgTeams(answer.raw);
      if (!reading.ok) {
        setProblem({
          title: "GameChanger answered in a shape this app cannot read yet.",
          detail: `${reading.message}${reading.keys ? ` It held: ${reading.keys.join(", ")}.` : ""}`,
        });
        return;
      }
      const found = groupOrgTeams(reading.teams);
      const first = found[0];
      if (!first) {
        setProblem({ title: "GameChanger lists no teams for this organization." });
        return;
      }
      setGroups(found);
      setGroupKey(first.key);
      setPicked(firstPicks(first));
    });
  };

  const chooseGroup = (key: string) => {
    selection.current += 1;
    setGroupKey(key);
    const chosen = groups?.find((one) => one.key === key);
    setPicked(chosen ? firstPicks(chosen) : []);
    setDraft(null);
  };

  const toggle = (id: string, on: boolean) => {
    selection.current += 1;
    setPicked((now) => (on ? [...now, id] : now.filter((one) => one !== id)));
    setDraft(null);
  };

  // Only the teams not pulled already are asked for, so going back and forth costs nothing more.
  const pullSchedules = () => {
    const wanted = picked.filter((id) => !pulled.has(id));
    asked.current += 1;
    const mine = asked.current;
    const picking = selection.current;
    // The division's own pulled teams, ticked or not, are what its opponents are told apart by and
    // its tournament days read from; another division's, kept for going back to it, would make a
    // name the two share nobody's (Codex on #460).
    const division = new Set(group?.teams.map((team) => team.id));
    const draftOf = (all: ReadonlyMap<string, PulledOrgTeam>) => {
      const made = orgDraft(
        [...all.values()].filter((team) => division.has(team.teamId)),
        picked.filter((id) => all.has(id))
      );
      setDraft(made);
      setChoices(startChoices(made));
    };
    if (wanted.length === 0) {
      draftOf(pulled);
      return;
    }
    setBusy("schedules");
    setProblem(null);
    void deps
      .pullTeams(wanted)
      .catch(() => new Map<string, GcTeamResponse>())
      .then((results) => {
        if (mine !== asked.current) return;
        setBusy(null);
        const all = new Map(pulled);
        const missed: { name: string; message: string }[] = [];
        wanted.forEach((id) => {
          const result = results.get(id);
          if (result?.ok) all.set(id, { teamId: id, schedule: result.schedule });
          else
            missed.push({
              name: nameOf(id),
              message: result ? result.message : "GameChanger was not asked for it.",
            });
        });
        setPulled(all);
        setUnpulled(missed);
        if (picking === selection.current) draftOf(all);
      });
  };

  const inLeague = picked.filter((id) => pulled.has(id));
  const asks = Math.ceil(picked.filter((id) => !pulled.has(id)).length / BATCH_SIZE);
  const tooMany = picked.length > START_CLUBS_MAX;
  const create = () => {
    if (!draft || !group) return;
    const clubs = inLeague.map((id) => ({ id, name: nameOf(id) }));
    const page = orgStartPage(
      group,
      inLeague.flatMap((id) => {
        const team = pulled.get(id);
        return team ? [team] : [];
      }),
      draft
    );
    void deps
      .clubLinks()
      .catch(() => new Map<string, string>())
      .then((links) =>
        onCreate(
          // Each club is the organization's GameChanger team, its id the one kept beside the link.
          seasonFromStart(
            clubs,
            draft,
            choices,
            innings,
            (id) => links.get(id),
            (id) => id
          ),
          page
        )
      );
  };

  const choose = (gameId: string, change: Partial<StartChoice>) =>
    setChoices((now) =>
      now.map((choice) => (choice.gameId === gameId ? { ...choice, ...change } : choice))
    );

  return (
    <section aria-labelledby="start-from-gc-org" className={`${surface.primary} p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="start-from-gc-org" className={textRole.sectionTitle}>
            Start from a GameChanger organization
          </h2>
          <p className={`mt-1 ${textRole.pageLead}`}>
            The league&apos;s organization on GameChanger lists its teams. Pick the season and age
            that is your league, and the games between those teams come in from their own schedules,
            with the scores GameChanger has.
          </p>
        </div>
        <button type="button" onClick={onClose} className={button.ghost}>
          Close
        </button>
      </div>

      <form
        className="mt-5 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          findTeams();
        }}
      >
        <label className="grid gap-1">
          <span className={textRole.overline}>GameChanger organization ID or link</span>
          <span className={textRole.meta}>
            Asked of GameChanger through this app&apos;s proxy: one request for the
            organization&apos;s teams, then one for every ten teams&apos; schedules.
          </span>
          <input
            type="text"
            value={orgText}
            onChange={(event) => setOrgText(event.target.value)}
            placeholder="SgtwZI3tbazX or web.gc.com/organizations/…/schedule"
            autoComplete="off"
            spellCheck={false}
            className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!orgId || busy !== null} className={button.dark}>
            Find its teams
          </button>
          {orgText.trim() !== "" && !orgId && (
            <span className={textRole.meta}>
              That is not an organization ID or a gc.com organizations link.
            </span>
          )}
        </div>
      </form>

      {problem && (
        <StatePanel kind="error" className="mt-4" title={problem.title}>
          {problem.detail}
        </StatePanel>
      )}
      {busy && (
        <StatePanel
          kind="loading"
          className="mt-4"
          title={
            busy === "teams"
              ? "Asking GameChanger for the organization's teams…"
              : "Pulling their schedules from GameChanger…"
          }
        />
      )}

      {groups && group && (
        <div className="mt-5 grid gap-5">
          <fieldset className="grid gap-1">
            <legend className={textRole.overline}>Which season and age is the league</legend>
            {groups.map((one) => (
              <label key={one.key} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="gc-org-group"
                  checked={one.key === groupKey}
                  onChange={() => chooseGroup(one.key)}
                />
                <span className="font-bold text-slate-950 dark:text-slate-100">{one.label}</span>
                <span className={textRole.meta}>{plural(one.teams.length, "team", "teams")}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="grid gap-1">
            <legend className={textRole.overline}>
              The league&apos;s teams ({picked.length} picked)
            </legend>
            {picked.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  selection.current += 1;
                  setPicked([]);
                  setDraft(null);
                }}
                className={`justify-self-start ${button.ghost}`}
              >
                Untick all
              </button>
            )}
            {group.teams.map((team) => (
              <label key={team.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(team.id)}
                  onChange={(event) => toggle(team.id, event.target.checked)}
                />
                <span className="font-bold text-slate-950 dark:text-slate-100">{team.name}</span>
                {(team.city || team.state) && (
                  <span className={textRole.meta}>
                    {[team.city, team.state].filter(Boolean).join(", ")}
                  </span>
                )}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={pullSchedules}
              disabled={picked.length < 2 || tooMany || busy !== null}
              className={button.dark}
            >
              Pull their schedules
            </button>
            <span className={textRole.meta}>
              {tooMany
                ? `A league is at most ${START_CLUBS_MAX} teams: untick the ones that are not yours.`
                : asks === 0
                  ? picked.length > 0
                    ? "Pulled already: nothing more is asked of GameChanger."
                    : "Tick the league's teams."
                  : `${plural(asks, "request", "requests")} to GameChanger through this app's proxy.`}
            </span>
          </div>

          {unpulled.length > 0 && (
            <StatePanel
              kind="error"
              title={`${plural(unpulled.length, "team", "teams")} could not be pulled, and ${unpulled.length === 1 ? "is" : "are"} left out.`}
            >
              <ul className="mt-1 grid gap-1">
                {unpulled.map((miss) => (
                  <li key={miss.name}>
                    {miss.name}: {miss.message}
                  </li>
                ))}
              </ul>
            </StatePanel>
          )}

          {draft && (
            <StartDraftReview
              draft={draft}
              choices={choices}
              onChoose={choose}
              nameOf={nameOf}
              teams={inLeague.length}
              lead={orgDraftLead(draft)}
              onStart={create}
            />
          )}
        </div>
      )}
    </section>
  );
}
