import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

/** The empty season with its team-list box held as App holds it, and a stand-in paste panel. */
function Season({
  schedulePaste,
}: {
  schedulePaste: (text: string, close: () => void) => ReactNode;
}) {
  const [text, setText] = useState("");
  return (
    <EmptyState
      importCSV={() => undefined}
      saveTeamList={() => undefined}
      downloadRoundRobinCSV={() => undefined}
      seasonBuilderText={text}
      setSeasonBuilderText={setText}
      teams={[]}
      loadDemoSeason={() => undefined}
      openTour={() => undefined}
      schedulePaste={schedulePaste}
    />
  );
}

describe("reading the team-list box as a schedule", () => {
  it("hands what is in the box to the paste panel, and closes it", async () => {
    const user = userEvent.setup();
    render(
      <Season
        schedulePaste={(text, close) => (
          <button type="button" onClick={close}>
            Read: {text}
          </button>
        )}
      />
    );

    await user.type(screen.getByLabelText("Team list"), "9/12 Falcons @ Wolves");
    await user.click(screen.getByRole("button", { name: "Read as a schedule" }));
    await user.click(screen.getByRole("button", { name: "Read: 9/12 Falcons @ Wolves" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Read:/ })).toBeNull());
    // Closed, focus is back on the button that opened it.
    expect(screen.getByRole("button", { name: "Read as a schedule" })).toHaveFocus();
  });
});

/*
 * The start screen in a parent's words. It opened on "A visual setup lane keeps the first import,
 * roster build, validation, and demo rehearsal in one place", and called the sample season "Safe
 * sandbox mode", which it is not: loaded over a season, it replaces it, with an undo.
 */
describe("the start screen's words", () => {
  it("says what each way in is for, without the app's own jargon", () => {
    render(<Season schedulePaste={() => null} />);
    expect(screen.queryByText(/setup lane|rehearsal|sandbox|guided flow/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "Start your season" })).toBeInTheDocument();
    expect(screen.getByText("Made-up teams and scores")).toBeInTheDocument();
  });
});
