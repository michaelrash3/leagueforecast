import { useEffect, useMemo } from "react";
import { TeamDetailPanel, type MergeCandidate } from "../TeamDetailPanel";
import { TEAM_PANEL_ID } from "../teamPanelId";
import { leagueLinkOf } from "../../lib/live/views/clubShape";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import { useClubCard } from "../../hooks/useClubCard";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { gameBreakdown } from "../../lib/gameBreakdown";
import { gameNotesOf } from "../../lib/live/gameWords";
import { overlayCard, takenWithOnCard } from "../../lib/live/liveEdits";
import type { BoardView } from "../../lib/live/views/boardShape";
import { mintStandInId, takenOffSaid } from "../../lib/notThisTeam";
import type { AgeGroup, SeasonSegment } from "../../lib/teamRankings";
import { normalizeState } from "../../lib/teamRankings/names";
import { createAgeGroupId } from "../../lib/teamRankings/seasons";
import { card as cardStyle } from "../../styles/tokens";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * A club's panel on the cloud's board: its card, read from its bucket of the page's year through the
 * same checks as a board (`useClubCard`), drawn by Team Rankings' own panel. A newer meta reads the
 * card again, so a publish while it is open is drawn in place. When the card cannot be read (no card
 * for the club, a bucket damaged or gone, a refusal, or offline with none kept), `onCannot` says so
 * in its place, with Try again (1.6e).
 *
 * Its edits go to the edit function (`edits`, 1.5): a state, a name, a GameChanger link taken off,
 * an age set or taken back, a fold into another club on the page, and a game it has only by a name
 * another schedule wrote taken off it ("Not this team", by the stored id its card keeps for such a
 * game, `ClubCard.byName`), each said in a toast and drawn over the card until the card is
 * published with it (`overlayCard`). A rename onto a name
 * another club holds, and a fold, are asked about first, with what the server says they move
 * (`rename.preview`, `merge.preview`). A club League Standings made rides along with any edit that
 * needs it on the roster (`adopt`), as the page sends it. While edits are off (offline, or before
 * the network has answered), the panel changes nothing (`readOnly`). Opening it brings the server's
 * pool up for the edits to come (`warm`).
 *
 * Under each counted game it says what the game did to the club's rating on the board on screen
 * (`board`), worked out from the card as published and that board (`gameBreakdown`, `gameWords`),
 * never from the card with this device's pending edits drawn over it: the lines explain the board,
 * which is from before those edits too. A game an edit takes off loses its row, and its line with
 * it. Where the lines do not add up to the board's row, or no board is given, the panel draws
 * none and says nothing of it.
 *
 * Loaded only when a club is opened, with the pool's codec it checks a card by, and the maths and
 * words of the lines.
 */
export default function LiveClubPanel({
  source,
  year,
  teamId,
  ageGroupId,
  ageGroupName,
  ageGroups,
  segment,
  edits,
  confirm,
  candidates,
  onFolded,
  onClose,
  onCannot,
  board,
}: {
  source: LiveViewSource;
  year: number | undefined;
  teamId: string;
  ageGroupId: string;
  ageGroupName: string;
  ageGroups: AgeGroup[];
  segment: SeasonSegment | undefined;
  edits: LiveEdits;
  confirm: Confirmation["request"];
  /** The clubs it could be folded into: the board's, itself left out here. */
  candidates: readonly MergeCandidate[];
  /** The club this one was folded into, whose panel opens in its place. */
  onFolded: (intoId: string) => void;
  onClose: () => void;
  /** The club whose card could not be read, to open on this device's copy instead. */
  onCannot: (teamId: string) => void;
  /**
   * The board on screen, given only while it is the board of this page and half: the board, the
   * age groups it was built from (the cloud's, which can differ from this device's), the span its
   * rating is over as the panel names it, and whether the club is the page's own.
   */
  board?: { view: BoardView; groups: AgeGroup[]; span: string; own: boolean };
}) {
  const { card, failed } = useClubCard(source, year, teamId);
  useEffect(() => {
    if (failed) onCannot(teamId);
  }, [failed, teamId, onCannot]);
  const { warm, edit, ask, say, pending, locked } = edits;
  useEffect(() => warm(), [warm]);

  const shown = useMemo(
    () =>
      card
        ? overlayCard(
            card,
            pending.map(({ command }) => command)
          )
        : null,
    [card, pending]
  );
  const foldedInto = shown && "foldedInto" in shown ? shown.foldedInto : null;
  useEffect(() => {
    if (foldedInto) onFolded(foldedInto);
  }, [foldedInto, onFolded]);
  const names = useMemo(() => new Map(Object.entries(card?.names ?? {})), [card]);
  // Worked out again only when the card read or the board handed in is a new one.
  const gameNotes = useMemo(() => {
    const fit = board?.view.fit;
    if (!board || !fit || !card) return undefined;
    const breakdown = gameBreakdown({
      teamId,
      games: card.games,
      pageId: ageGroupId,
      ageGroups: board.groups,
      segment,
      board: board.view,
    });
    return breakdown
      ? gameNotesOf(breakdown, { span: board.span, own: board.own, cap: fit.cap })
      : undefined;
  }, [board, card, teamId, ageGroupId, segment]);
  const others = useMemo(
    () => candidates.filter((candidate) => candidate.id !== teamId),
    [candidates, teamId]
  );

  if (!shown || "foldedInto" in shown)
    return (
      <section id={TEAM_PANEL_ID} className={`${cardStyle} p-5`} role="status" aria-live="polite">
        <p className="text-sm text-slate-500 dark:text-slate-400">Opening the club…</p>
      </section>
    );
  const team = shown.team;
  // Taken onto the roster with the edit where League Standings made it (`team.state`, `teams.merge`).
  const adopt = [team];

  const fold = async (intoId: string, intoName: string, games: number, dropped: number) => {
    const confirmed = await confirm({
      title: `Fold ${team.name} into ${intoName}?`,
      message: `${plural(games, "game")} will move to ${intoName}, and ${team.name} will be removed.${
        dropped > 0
          ? ` ${plural(dropped, "game")} between the two cannot survive the fold and will be dropped.`
          : ""
      }`,
      confirmLabel: "Fold in",
    });
    if (!confirmed) return;
    await edit(
      { kind: "teams.merge", fromId: team.id, intoId, adopt },
      { done: `Folded into ${intoName}.` }
    );
  };

  const rename = async (name: string) => {
    const preview = await ask({ kind: "rename.preview", teamId: team.id, name });
    if (!preview) return;
    if (preview.into) {
      await fold(preview.into.id, preview.into.name, preview.games, preview.dropped);
      return;
    }
    await edit({ kind: "team.rename", teamId: team.id, name }, { done: "Team renamed." });
  };

  const mergeInto = async (intoId: string) => {
    const preview = await ask({ kind: "merge.preview", fromId: team.id, intoId, adopt });
    if (!preview) return;
    const intoName =
      others.find((candidate) => candidate.id === intoId)?.name ?? names.get(intoId) ?? "it";
    if (!preview.found) {
      say(`${intoName} is not a club in the cloud copy to fold into, so nothing was changed.`);
      return;
    }
    await fold(intoId, intoName, preview.games, preview.dropped);
  };

  const leagueLink = leagueLinkOf(shown, ageGroupId);
  return (
    <TeamDetailPanel
      team={team}
      allGames={shown.games}
      ageGroupId={ageGroupId}
      ageGroupName={ageGroupName}
      ageGroups={ageGroups}
      {...(segment === undefined ? {} : { segment })}
      teamNameById={names}
      {...(leagueLink ? { leagueLink } : {})}
      {...(shown.age ? { age: shown.age } : {})}
      mergeCandidates={others}
      onRename={(name) => void rename(name)}
      onSetState={(typed) => {
        const state = typed.trim() === "" ? null : (normalizeState(typed) ?? null);
        void edit(
          { kind: "team.state", teamId: team.id, state, adopt: team },
          { done: state ? `Set to ${state}.` : "State cleared." }
        );
        return true;
      }}
      onUnlinkGc={(gcTeamId) =>
        void edit(
          { kind: "team.unlinkGc", teamId: team.id, gcTeamId },
          { done: "Unlinked from GameChanger." }
        )
      }
      onMergeInto={(intoId) => void mergeInto(intoId)}
      notThisTeam={{
        offered: (game) => shown.byName?.[game.id] !== undefined,
        onRefuse: (game) => {
          const gameId = shown.byName?.[game.id];
          if (gameId === undefined) return;
          const opponent = names.get(game.teamAId === team.id ? game.teamBId : game.teamAId);
          // Every game of the card the server takes off with it, as the overlay draws them off.
          const taken = takenWithOnCard(shown, gameId);
          void edit(
            {
              kind: "game.notThisTeam",
              year: year ?? null,
              gameId,
              teamId: team.id,
              standInId: mintStandInId(team.name),
            },
            {
              done: takenOffSaid(
                team.name,
                opponent,
                (taken.length > 0 ? taken : [game]).map((each) => each.date)
              ),
              undo: true,
            }
          );
        },
      }}
      {...(year === undefined
        ? {}
        : {
            onSetAge: (level: number) =>
              void edit(
                {
                  kind: "club.age",
                  year,
                  teamId: team.id,
                  level,
                  at: new Date().toISOString(),
                  pageId: createAgeGroupId(),
                },
                { done: `${team.name} is ${level}U now.`, undo: true }
              ),
            onClearAge: () =>
              void edit(
                { kind: "club.ageClear", year, teamId: team.id, pageId: createAgeGroupId() },
                { done: `${team.name} is the app's to age again.` }
              ),
          })}
      onClose={onClose}
      {...(locked ? { readOnly: true } : {})}
      {...(gameNotes ? { gameNotes } : {})}
    />
  );
}
