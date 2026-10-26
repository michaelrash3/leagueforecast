import type { StartChoice, StartDraft } from "../../lib/leagueStart";
import { button, focusRing, textRole } from "../../styles/tokens";
import { EditLock } from "./EditLock";

const scoreText = (away: number | undefined, home: number | undefined) =>
  away === undefined || home === undefined ? "To play" : `${away}–${home}`;

/**
 * The games a start found, to be looked over before the season is made: each kept or left out and
 * turned round where the home side is the other one, and the button that makes the season. Shared
 * by a start from Team Rankings clubs (`StartFromClubs`) and one from a GameChanger organization
 * (`StartFromGcOrg`), which say in `lead` where the games came from and what to check.
 */
export function StartDraftReview({
  draft,
  choices,
  onChoose,
  nameOf,
  teams,
  lead,
  onStart,
}: {
  draft: StartDraft;
  choices: readonly StartChoice[];
  onChoose: (gameId: string, change: Partial<StartChoice>) => void;
  nameOf: (id: string) => string;
  /** How many teams the season is made with. */
  teams: number;
  /** What is said above the games. */
  lead: string;
  onStart: () => void;
}) {
  const kept = choices.filter((choice) => choice.keep).length;
  return (
    <div className="grid gap-3">
      <p className={textRole.body}>{lead}</p>
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
                        onChange={(event) => onChoose(game.gameId, { keep: event.target.checked })}
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
                        onClick={() => onChoose(game.gameId, { swap: !swap })}
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
                          ; the score shown is {nameOf(game.away)}&apos;s. Change it on the Schedule
                          if theirs is right.
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
          <button type="button" onClick={onStart} className={button.primary}>
            Start the season: {teams} teams, {kept} game{kept === 1 ? "" : "s"}
          </button>
        </EditLock>
      </div>
    </div>
  );
}
