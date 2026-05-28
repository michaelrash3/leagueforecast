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
          "Gold odds improved by 7 points after the projection strengthened.",
          "Recent results lifted the projected finish by 2 spots.",
        ]}
      />
    );

    expect(html).toContain("Gold odds improved by 7 points after the projection strengthened.");
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
          "Projected points improved by 1, strengthening the Gold position.",
          "Standings points slipped by 1.5 after recent results.",
          "",
        ]}
      />
    );

    expect(html).toContain("Projected points improved by 1, strengthening the Gold position.");
    expect(html).toContain("Standings points slipped by 1.5 after recent results.");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).not.toMatch(/why did this change\?|what changed\?/i);
  });

  it("keeps repeated context subtle and non-duplicative for assistive tech", () => {
    const html = renderToStaticMarkup(
      <ProjectionExplanation
        explanations={[
          "Gold odds improved by 7 points after the projection strengthened.",
          " Gold odds improved by 7 points after the projection strengthened. ",
        ]}
      />
    );

    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<aside|aria-label=|<h[1-6]/i);
  });
});
