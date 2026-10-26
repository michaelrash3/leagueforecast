import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiHealthCheck } from "./aiHealthCheck";
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

describe("the label when no sign-in may ask", () => {
  it("says the write-ups are off until the cloud copy is signed in to", () => {
    expect(aiStoryUnavailableLabel("members-only")).toBe("AI off — sign in to the cloud copy");
  });
});

describe("asking why the AI is off", () => {
  it("runs the check App hands down, and says what it found", async () => {
    // App hands the check down (`aiHealthCheck.ts`) so this panel's chunk does not import the
    // write-ups' client, and with it the browser's sign-in.
    const check = vi.fn(async () => "Gemini answered; the key works.");
    const user = userEvent.setup();
    render(
      <AiHealthCheck.Provider value={check}>
        <AiStoryPanel
          title="League Story"
          text="The Stallions clinched."
          source="local"
          model=""
          loading={false}
          unavailableReason="upstream-error"
          onRetry={() => {}}
        />
      </AiHealthCheck.Provider>
    );
    await user.click(screen.getByRole("button", { name: "Why?" }));
    expect(check).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Gemini answered; the key works.")).toBeInTheDocument();
  });
});
