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
      createSeasonFromTeamList={() => undefined}
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
  });
});
