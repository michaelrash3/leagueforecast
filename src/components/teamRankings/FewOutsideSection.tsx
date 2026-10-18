import { useMemo, useState } from "react";
import {
  FEW_OUTSIDE_GAMES,
  FEW_OUTSIDE_NATIONAL_TOP,
  FEW_OUTSIDE_STATE_TOP,
  namesText,
  teamsToFind,
  type FewOutsideGroup,
  type FewOutsideLeader,
  type FewOutsideList,
  type FewOutsideOpponent,
  type FewOutsideSide,
} from "../../lib/fewOutside";
import { segmentLabel } from "../../lib/teamRankings";
import { button, pill } from "../../styles/tokens";

/**
 * Pool health's leaders with few outside games (`fewOutside.ts`), as "Check the pool" finds them:
 * the owner's own clean-up list, so it says what a club's group is and whom to find, in plain
 * words, and labels no club. Each club opens its own panel, as the card's other lists do, and each
 * list of names copies as one a line, ready to search GameChanger for.
 */

/** Leaders drawn before "Show all", as the card's other long lists draw twelve. */
const LEADERS_DRAWN = 12;
/** A group's names drawn on a row; the copy holds every one. */
const NAMES_DRAWN = 12;

const count = (value: number) => value.toLocaleString();
const plural = (value: number, noun: string) => `${count(value)} ${noun}${value === 1 ? "" : "s"}`;

/** "Alder Comets (1 game against it, 3 in all)", or "(2 games)" where those are all it has. */
const opponentText = ({ name, games, rated }: FewOutsideOpponent) =>
  rated > games
    ? `${name} (${plural(games, "game")} against it, ${count(rated)} in all)`
    : `${name} (${plural(games, "game")})`;

const sideText = ({ name, rated }: FewOutsideSide) => `${name} (${plural(rated, "game")})`;

/** A group's names as a row draws them: the first twelve, and how many more the copy holds. */
const sidesText = (sides: readonly FewOutsideSide[]) =>
  `${sides.slice(0, NAMES_DRAWN).map(sideText).join(" · ")}${
    sides.length > NAMES_DRAWN ? `, and ${count(sides.length - NAMES_DRAWN)} more in the copy` : ""
  }`;

/**
 * Its group's clubs entered by hand, said for what they are: no pull has linked them to
 * GameChanger, so they are teams to find as much as the ones known only by name. `also` where the
 * row has named those first.
 */
const enteredText = (entered: readonly FewOutsideSide[], also: boolean) => {
  const one = entered.length === 1;
  return `${count(entered.length)} of its group's entries ${one ? "was" : "were"} entered by hand and ${
    one ? "has" : "have"
  } no GameChanger link; find ${one ? "it" : "them"} on GameChanger and pull ${one ? "it" : "them"}${
    also ? " too" : " to connect its group"
  }: ${sidesText(entered)}`;
};

/** What its group holds, kind by kind, and its games outside itself. */
const groupText = (group: FewOutsideGroup) =>
  [
    `Its group: ${count(group.sides)} ${group.sides === 1 ? "entry" : "entries"}`,
    ` (${count(group.pulled)} pulled`,
    group.nameOnly > 0 ? `, ${count(group.nameOnly)} known only by name` : "",
    group.byHand > 0 ? `, ${count(group.byHand)} entered by hand` : "",
    group.slots > 0 ? `, ${plural(group.slots, "TBD")}` : "",
    `) and ${plural(group.outside, "game")} outside it.`,
  ].join("");

/** Copies names to the clipboard, one a line, and says so once it has. */
function CopyNames({ sides, label }: { sides: readonly FewOutsideSide[]; label: string }) {
  const [copied, setCopied] = useState(false);
  const text = namesText(sides);
  if (!text) return null;
  const copy = () =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <button type="button" onClick={copy} className={`${button.ghost} text-xs`}>
      {copied ? "Copied" : label}
    </button>
  );
}

export function FewOutsideSection({
  list,
  openTeam,
}: {
  list: FewOutsideList;
  /** Opens a club's own panel, with the squad year of its row and the page whose board it leads. */
  openTeam?: (teamId: string, year?: number, pageId?: string) => void;
}) {
  const [all, setAll] = useState(false);
  const leaders = list.leaders;
  /** Every name to find on the list, each once, for the one copy of them all. */
  const everyName = useMemo(
    () => list.leaders.flatMap((leader) => teamsToFind(list, leader)),
    [list]
  );
  if (leaders.length === 0) return null;
  const shown = all ? leaders : leaders.slice(0, LEADERS_DRAWN);
  // Each group's facts once, with the first club drawn in it; later clubs in it say so.
  const firstIn = new Map<number, FewOutsideLeader>();
  // And its names to find once, with the first club drawn that played none of its own.
  const namesWith = new Map<number, FewOutsideLeader>();

  return (
    <div
      className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800"
      data-testid="pool-few-outside"
    >
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Leaders with few outside games
      </h3>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
        <strong>{count(leaders.length)}</strong> {leaders.length === 1 ? "club" : "clubs"} in a
        state&apos;s top {FEW_OUTSIDE_STATE_TOP} or the nation&apos;s top {FEW_OUTSIDE_NATIONAL_TOP}{" "}
        {leaders.length === 1 ? "plays" : "play"} in{" "}
        {list.groups.length === 1 ? "a group" : `${count(list.groups.length)} groups`} of teams that{" "}
        {list.groups.length === 1 ? "has" : "have"} played fewer than {FEW_OUTSIDE_GAMES} games
        outside {list.groups.length === 1 ? "itself" : "themselves"}. Each club&apos;s places are
        those of the board its page opens on. A club&apos;s rating starts at its group&apos;s level,
        and the group&apos;s own games cannot say whether that level is right; only games against
        teams outside it can. GameChanger names those opponents on a schedule but gives them no id,
        so they are found by hand: copy the names, search for each on GameChanger, and paste its id
        into the next pull.
      </p>
      <ul className="mt-2 space-y-2" aria-label="Leaders with few outside games">
        {shown.map((leader) => {
          const group = list.groups[leader.group];
          if (!group) return null;
          const first = firstIn.get(leader.group);
          if (!first) firstIn.set(leader.group, leader);
          const own = leader.opponents;
          const named = group.toFind;
          const entered = group.byHandSides;
          const shownWith = own.length === 0 ? namesWith.get(leader.group) : undefined;
          if (own.length === 0 && !shownWith) namesWith.set(leader.group, leader);
          return (
            <li
              key={`${leader.year ?? "none"}|${leader.pageId}|${leader.teamId}`}
              className="break-words text-xs text-slate-500 dark:text-slate-400"
            >
              {openTeam ? (
                <button
                  type="button"
                  onClick={() => openTeam(leader.teamId, leader.year ?? undefined, leader.pageId)}
                  className="text-left font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {leader.name}
                </button>
              ) : (
                <span className="font-bold text-slate-700 dark:text-slate-200">{leader.name}</span>
              )}{" "}
              {leader.stateRank !== null && leader.state ? (
                <span className={pill("amber")}>
                  #{leader.stateRank} in {leader.state}
                </span>
              ) : null}{" "}
              {leader.page}
              {leader.segment && leader.year !== null
                ? `, ${segmentLabel(leader.year, leader.segment)}`
                : ""}
              {leader.rank <= FEW_OUTSIDE_NATIONAL_TOP ? ` · #${leader.rank} nationally` : ""}
              {" · "}
              <span className="whitespace-nowrap">{leader.record}</span>
              <p className="mt-0.5">
                {first ? `In the same group as ${first.name}, above.` : groupText(group)}
              </p>
              {own.length > 0 ? (
                <p className="mt-0.5">
                  Pull these opponents to connect its group: {own.map(opponentText).join(" · ")}{" "}
                  <CopyNames sides={own} label="Copy the names" />
                </p>
              ) : named.length === 0 && entered.length === 0 ? (
                <p className="mt-0.5">
                  Every team in its group is already pulled
                  {group.slots > 0 ? ", and a TBD names nobody" : ""}, so there is no one in it to
                  find.
                </p>
              ) : shownWith ? (
                <p className="mt-0.5">
                  It played no opponent known only by name; its group&apos;s are listed with{" "}
                  {shownWith.name}, above.
                </p>
              ) : (
                <p className="mt-0.5">
                  It played no opponent known only by name
                  {named.length > 0
                    ? `. Pull these opponents to connect its group, the ones the rest of its group played: ${sidesText(named)}`
                    : ", and no team in its group is known only by name"}
                  {entered.length > 0 ? `. ${enteredText(entered, named.length > 0)}` : ""}{" "}
                  <CopyNames sides={teamsToFind(list, leader)} label="Copy the names" />
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {leaders.length > LEADERS_DRAWN && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {all
            ? `All ${count(leaders.length)}, by state rank. `
            : `Drawing ${LEADERS_DRAWN} of ${count(leaders.length)}, by state rank. `}
          <button
            type="button"
            onClick={() => setAll((shownAll) => !shownAll)}
            className="underline hover:text-slate-950 dark:hover:text-white"
          >
            {all ? `Show the first ${LEADERS_DRAWN}` : `Show all ${count(leaders.length)}`}
          </button>
        </p>
      )}
      <div className="mt-3">
        <CopyNames
          sides={everyName}
          label={`Copy every name to find (${count(new Set(everyName.map(({ name }) => name)).size)})`}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Nothing is changed for you. Pulling an opponent brings in its schedule, and its games
        against teams outside the group are what join the group to the rest. It does not always: an
        opponent can turn out to play only the same few teams. A club stays on this list until its
        group has played {FEW_OUTSIDE_GAMES} games outside itself.
      </p>
    </div>
  );
}
