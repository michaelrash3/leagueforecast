import { useEffect, useMemo } from "react";
import { TeamDetailPanel, type MergeCandidate } from "../TeamDetailPanel";
import { TEAM_PANEL_ID } from "../teamPanelId";
import { leagueLinkOf } from "../../lib/live/views/clubShape";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import { useClubCard } from "../../hooks/useClubCard";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { overlayCard } from "../../lib/live/liveEdits";
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
 * an age set or taken back, and a fold into another club on the page, each said in a toast and
 * drawn over the card until the card is published with it (`overlayCard`). A rename onto a name
 * another club holds, and a fold, are asked about first, with what the server says they move
 * (`rename.preview`, `merge.preview`). A club League Standings made rides along with any edit that
 * needs it on the roster (`adopt`), as the page sends it. While edits are off (offline, or before
 * the network has answered), the panel changes nothing (`readOnly`). Opening it brings the server's
 * pool up for the edits to come (`warm`).
 *
 * Loaded only when a club is opened, with the pool's codec it checks a card by.
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
    />
  );
}
