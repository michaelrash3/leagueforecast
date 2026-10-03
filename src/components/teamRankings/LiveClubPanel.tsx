import { useEffect, useMemo } from "react";
import { TeamDetailPanel } from "../TeamDetailPanel";
import { TEAM_PANEL_ID } from "../teamPanelId";
import { leagueLinkOf } from "../../lib/live/views/clubShape";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import { useClubCard } from "../../hooks/useClubCard";
import type { AgeGroup, SeasonSegment } from "../../lib/teamRankings";
import { card as cardStyle } from "../../styles/tokens";

const NO_CANDIDATES: [] = [];
const nothing = () => undefined;

/**
 * A club's panel on the cloud's board: its card, read from its bucket of the page's year through the
 * same checks as a board (`useClubCard`), drawn by Team Rankings' own panel with
 * nothing on it to change (`TeamDetailPanel` `readOnly`). A newer meta reads the card again, so a
 * publish while it is open is drawn in place. When the card cannot be read (no card for the club,
 * a bucket damaged or gone, a refusal, or offline with none kept), `onCannot` hands the club to
 * Team Rankings on this device's copy, as opening one did before there were cards.
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
  onClose: () => void;
  /** The club whose card could not be read, to open on this device's copy instead. */
  onCannot: (teamId: string) => void;
}) {
  const { card, failed } = useClubCard(source, year, teamId);
  useEffect(() => {
    if (failed) onCannot(teamId);
  }, [failed, teamId, onCannot]);

  const names = useMemo(() => new Map(Object.entries(card?.names ?? {})), [card]);

  if (!card)
    return (
      <section id={TEAM_PANEL_ID} className={`${cardStyle} p-5`} role="status" aria-live="polite">
        <p className="text-sm text-slate-500 dark:text-slate-400">Opening the club…</p>
      </section>
    );
  const leagueLink = leagueLinkOf(card, ageGroupId);
  return (
    <TeamDetailPanel
      team={card.team}
      allGames={card.games}
      ageGroupId={ageGroupId}
      ageGroupName={ageGroupName}
      ageGroups={ageGroups}
      {...(segment === undefined ? {} : { segment })}
      teamNameById={names}
      {...(leagueLink ? { leagueLink } : {})}
      {...(card.age ? { age: card.age } : {})}
      mergeCandidates={NO_CANDIDATES}
      onRename={nothing}
      onSetState={nothing}
      onUnlinkGc={nothing}
      onMergeInto={nothing}
      onClose={onClose}
      readOnly
    />
  );
}
