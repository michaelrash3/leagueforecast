import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiStoryPanel, aiStoryUnavailableLabel } from "./AiStoryPanel";

/** The AI write-up card says which provider wrote what it shows: Gemini, or Groq after it. */
const panel = (source: "gemini" | "groq" | "local", model: string) =>
  render(
    <AiStoryPanel
      title="League Story"
      text="The Stallions clinched."
      source={source}
      model={model}
      loading={false}
      unavailableReason={null}
      onRetry={() => {}}
    />
  );

describe("who the AI badge says wrote the story", () => {
  it("credits Groq when Groq wrote it", () => {
    panel("groq", "llama-3.3-70b-versatile");
    expect(screen.getByTitle("Written by Groq (llama-3.3-70b-versatile)")).toHaveTextContent("AI");
    expect(screen.getByRole("button", { name: "Rewrite" })).toBeInTheDocument();
  });

  it("credits Gemini when Gemini wrote it", () => {
    panel("gemini", "gemini-3-flash");
    expect(screen.getByTitle("Written by Gemini (gemini-3-flash)")).toHaveTextContent("AI");
  });

  it("shows no badge on the app's own text", () => {
    panel("local", "");
    expect(screen.queryByText("AI")).toBeNull();
  });
});

describe("the label when a limit stopped the write-up", () => {
  it("names no one provider, since Groq may have been at its limit too", () => {
    expect(aiStoryUnavailableLabel("rate-limited")).toBe("AI limit reached");
  });
});
