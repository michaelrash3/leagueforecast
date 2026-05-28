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
});
