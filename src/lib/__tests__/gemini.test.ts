import { describe, expect, it, vi } from "vitest";
import { buildGeminiRecapPrompt, extractGeminiText, generateGeminiRecap } from "../gemini";

const item = {
  kind: "crossed-cut-up" as const,
  text: "Aces moved above the Gold cut line (#8 → #6).",
  why: ["Seed moved from outside to inside the cutoff."],
};

describe("Gemini recap helpers", () => {
  it("builds a fact-grounded prompt from recap items", () => {
    const prompt = buildGeminiRecapPrompt({
      seasonLabel: "Spring 26",
      title: "Latest Update — Aces vs Bears",
      scores: ["Aces 7, Bears 4"],
      items: [item],
    });

    expect(prompt).toContain("using ONLY the facts below");
    expect(prompt).toContain("Aces 7, Bears 4");
    expect(prompt).toContain("Aces moved above the Gold cut line");
  });

  it("extracts text from a Gemini response", () => {
    expect(
      extractGeminiText({ candidates: [{ content: { parts: [{ text: "League story" }] } }] })
    ).toBe("League story");
  });

  it("posts to Gemini with the API key header", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "AI recap" }] } }] }),
          { status: 200 }
        )
    );

    await expect(
      generateGeminiRecap({
        apiKey: " test-key ",
        seasonLabel: "Spring 26",
        title: "Latest Update",
        scores: [],
        items: [item],
        fetcher,
      })
    ).resolves.toBe("AI recap");

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("models/gemini-2.0-flash:generateContent"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "test-key" }),
      })
    );
  });
});
