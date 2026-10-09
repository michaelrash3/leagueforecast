import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScoutLinkPanel } from "../components/ScoutLinkPanel";
import { useScoutBridge } from "./useScoutBridge";
import type { LeagueBridgeAnswer } from "../lib/live/leagueAnswers";
import type { LeagueAsker } from "../lib/live/leagueAsk";
import type { QueryOf } from "../lib/live/queries";
import { resetTeamRankingsStore } from "../lib/teamRankingsStorage";

/*
 * The link panel and the hook together, as Settings draws them on a member's device: the wide
 * picker's box is the panel's, the clubs it lists are asked of the server by the hook, and a
 * season switched to with the box still ticked lists its own. Placeholder names throughout.
 */

const ANSWER: LeagueBridgeAnswer = {
  bridge: {
    results: [],
    seasonLinked: true,
    rows: [{ leagueTeamId: "lt1", leagueTeamName: "Rays", how: "none" }],
    linkedCount: 0,
    countedResults: 0,
  },
  candidates: [{ name: "Rays", clubs: [] }],
};
const TEAMS = [{ id: "lt1", name: "Rays" }];

type Asked = QueryOf<"league.bridge" | "league.clubs" | "league.fill">;

function Settings({ season, asker }: { season: string; asker: LeagueAsker }) {
  const scout = useScoutBridge({
    activeSeasonId: season,
    teams: TEAMS,
    seasonFixtures: [],
    useScoutResults: true,
    onLink: () => {},
    asker,
  });
  return (
    <ScoutLinkPanel
      bridge={scout.bridge}
      {...(scout.unanswered ? { unanswered: scout.unanswered } : {})}
      candidatesFor={scout.candidatesFor}
      wideOptions={scout.wideOptions}
      {...(scout.wideStatus ? { wideStatus: scout.wideStatus } : {})}
      onWide={scout.wantWide}
      seasonLabel={season}
      countingOn
      onPick={() => {}}
    />
  );
}

const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

describe("the wide picker across a season switch", () => {
  beforeEach(() => {
    localStorage.clear();
    resetTeamRankingsStore();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  it("asks for the new season's clubs when the box is still ticked", async () => {
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      if (query.kind === "league.clubs")
        return { kind: "league.clubs", clubs: [{ id: "S-R", label: "Rays" }] };
      return { kind: "league.bridge", ...ANSWER };
    }) as LeagueAsker;
    const { rerender } = render(<Settings season="s1" asker={asker} />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    await settle();
    rerender(<Settings season="s2" asker={asker} />);
    await settle();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(asked.filter((query) => query.kind === "league.clubs")).toEqual([
      { kind: "league.clubs", season: "s1" },
      { kind: "league.clubs", season: "s2" },
    ]);
  });

  it("says the list is coming, then that it could not be asked for, and asks again", async () => {
    let letGo = () => {};
    let held = new Promise<void>((resolve) => (letGo = resolve));
    let answering = false;
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      if (query.kind !== "league.clubs") return { kind: "league.bridge", ...ANSWER };
      await held;
      return answering ? { kind: "league.clubs", clubs: [{ id: "S-R", label: "Rays" }] } : null;
    }) as LeagueAsker;
    render(<Settings season="s1" asker={asker} />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText(/Asking Team Rankings in the cloud for every club/)).toBeTruthy();
    await act(async () => letGo());
    expect(screen.queryByText(/Asking Team Rankings in the cloud for every club/)).toBeNull();
    expect(screen.getByText(/could not be asked for its clubs just now/)).toBeTruthy();
    held = Promise.resolve();
    answering = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(async () => {});
    expect(screen.queryByText(/could not be asked for its clubs just now/)).toBeNull();
    expect(asked.filter((query) => query.kind === "league.clubs")).toHaveLength(2);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: "Rays" })).toBeTruthy();
  });

  it("asks for no season's clubs once the panel is gone, its box unticked when drawn again", async () => {
    const asked: Asked[] = [];
    const asker = (async (query: Asked) => {
      asked.push(query);
      if (query.kind === "league.clubs")
        return { kind: "league.clubs", clubs: [{ id: "S-R", label: "Rays" }] };
      return { kind: "league.bridge", ...ANSWER };
    }) as LeagueAsker;
    // The hook lives on in App while Settings, and the panel with it, is left for another tab.
    function App({ season, settings }: { season: string; settings: boolean }) {
      const scout = useScoutBridge({
        activeSeasonId: season,
        teams: TEAMS,
        seasonFixtures: [],
        useScoutResults: true,
        onLink: () => {},
        asker,
      });
      return settings ? (
        <ScoutLinkPanel
          bridge={scout.bridge}
          candidatesFor={scout.candidatesFor}
          wideOptions={scout.wideOptions}
          onWide={scout.wantWide}
          seasonLabel={season}
          countingOn
          onPick={() => {}}
        />
      ) : null;
    }
    const { rerender } = render(<App season="s1" settings />);
    await settle();
    fireEvent.click(screen.getByRole("checkbox"));
    await settle();
    rerender(<App season="s1" settings={false} />);
    rerender(<App season="s2" settings={false} />);
    await settle();
    expect(asked.filter((query) => query.kind === "league.clubs")).toEqual([
      { kind: "league.clubs", season: "s1" },
    ]);
  });

  it("says it is asking, or could not ask, rather than that no age group claims the season", async () => {
    const asker = (async () => null) as LeagueAsker;
    render(<Settings season="Spring 2027" asker={asker} />);
    expect(screen.getByText(/Asking Team Rankings in the cloud what it has for/)).toBeTruthy();
    expect(screen.queryByText(/No age group claims/)).toBeNull();
    await settle();
    expect(screen.getByText(/could not be asked about/)).toBeTruthy();
    expect(screen.queryByText(/No age group claims/)).toBeNull();
  });
});
