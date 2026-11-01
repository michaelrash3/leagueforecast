import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";
import { archiveSection } from "./teamRankings/sections";
import { preloadTeamRankings } from "./teamRankingsChunk";

/*
 * What the live board loads ahead of its handover (`LiveTeamRankings`): the page's code, and the
 * section's it hands over on, so the page it opens draws that section at once rather than saying
 * the section is loading.
 */
describe("the live board's preload of Team Rankings", () => {
  it("fetches the section's code with the page's, so the section is drawn at once", async () => {
    await preloadTeamRankings("archive");
    render(
      <Suspense fallback={<p>Still loading</p>}>
        <archiveSection.View entries={[]} />
      </Suspense>
    );
    expect(screen.getByRole("heading", { name: "Finished seasons" })).toBeInTheDocument();
    expect(screen.queryByText("Still loading")).toBeNull();
  });
});
