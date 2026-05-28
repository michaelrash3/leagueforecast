import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectionExplanation } from "./ProjectionExplanation";

describe("ProjectionExplanation", () => {
  it("renders nothing when no meaningful explanation text exists", () => {
    expect(renderToStaticMarkup(<ProjectionExplanation explanations={[]} />)).toBe("");
    expect(renderToStaticMarkup(<ProjectionExplanation explanations={[" ", ""]} />)).toBe("");
  });

  it("renders explanation strings without a heading or feature label", () => {
    const html = renderToStaticMarkup(
      <ProjectionExplanation
        explanations={[
          "Gold odds lifted by 7 points after the projection moved up.",
          "Recent results lifted the projected finish by 2 spots.",
        ]}
      />
    );

    expect(html).toContain("Gold odds lifted by 7 points after the projection moved up.");
    expect(html).toContain("Recent results lifted the projected finish by 2 spots.");
    expect(html).not.toMatch(/why did this change\?/i);
    expect(html).not.toMatch(/what changed\?/i);
    expect(html).not.toMatch(/<h[1-6]/i);
  });

  it("trims blank entries while preserving ordered inline explanations", () => {
    const html = renderToStaticMarkup(
      <ProjectionExplanation
        explanations={[
          " ",
          "Projected points nudged up by 1, lifting the Gold outlook.",
          "Standings points dipped by 1.5 after recent results.",
          "",
        ]}
      />
    );

    expect(html).toContain("Projected points nudged up by 1, lifting the Gold outlook.");
    expect(html).toContain("Standings points dipped by 1.5 after recent results.");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).not.toMatch(/why did this change\?|what changed\?/i);
  });

  it("keeps repeated context subtle without noisy live-region behavior", () => {
    const html = renderToStaticMarkup(
      <ProjectionExplanation
        explanations={[
          "Gold odds lifted by 7 points after the projection moved up.",
          " Gold odds lifted by 7 points after the projection moved up. ",
        ]}
      />
    );

    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).not.toMatch(/role="status"|aria-live=|<aside|aria-label=|<h[1-6]/i);
  });
});
