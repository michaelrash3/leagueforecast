import { describe, expect, it, vi } from "vitest";
import {
  buildGroqCandidates,
  discoverGroqModels,
  groqChatBody,
  isGroqChatModel,
  rankGroqModels,
  readGroqChatText,
  GROQ_PREFERRED_MODEL_IDS,
} from "../groqModels";

/** Groq, the provider asked when Gemini cannot write a story. */
const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("which of Groq's models can write the story", () => {
  it("leaves out speech, safety classifiers, agentic systems and retired models", () => {
    expect(isGroqChatModel({ id: "llama-3.3-70b-versatile", active: true })).toBe(true);
    expect(isGroqChatModel({ id: "whisper-large-v3" })).toBe(false);
    expect(isGroqChatModel({ id: "playai-tts" })).toBe(false);
    expect(isGroqChatModel({ id: "meta-llama/llama-guard-4-12b" })).toBe(false);
    expect(isGroqChatModel({ id: "groq/compound" })).toBe(false);
    expect(isGroqChatModel({ id: "llama-3.3-70b-versatile", active: false })).toBe(false);
    expect(isGroqChatModel({})).toBe(false);
  });

  it("puts the preferred models first in their order, then others newest first", () => {
    const ranked = rankGroqModels([
      { id: "llama-3.1-8b-instant", created: 1 },
      { id: "some-lab/new-model", created: 300 },
      { id: "whisper-large-v3", created: 999 },
      { id: "llama-3.3-70b-versatile", created: 2 },
      { id: "another/older-model", created: 100 },
    ]);
    expect(ranked).toEqual([
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "some-lab/new-model",
      "another/older-model",
    ]);
  });
});

describe("the order models are asked in", () => {
  it("takes a pinned model first, then what the key listed, up to the limit", () => {
    expect(
      buildGroqCandidates({
        pinned: "moonshotai/kimi-k2-instruct",
        discovered: ["llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct", "x", "y"],
      })
    ).toEqual(["moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile", "x"]);
  });

  it("falls back to the preferred list when the key listed nothing", () => {
    expect(buildGroqCandidates({ discovered: [] })).toEqual(GROQ_PREFERRED_MODEL_IDS.slice(0, 3));
  });
});

describe("listing the key's models", () => {
  it("asks with the key as a bearer token and ranks what comes back", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        data: [
          { id: "whisper-large-v3", active: true },
          { id: "llama-3.3-70b-versatile", active: true },
        ],
      })
    );
    const result = await discoverGroqModels("q-key", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ids: ["llama-3.3-70b-versatile"] });
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.groq.com/openai/v1/models");
    expect(call[1].headers).toEqual({ authorization: "Bearer q-key" });
  });

  it("keeps Groq's own words when it refuses the key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: { message: "Invalid API Key", code: "invalid_api_key" } })
    );
    await expect(
      discoverGroqModels("bad", { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).resolves.toEqual({
      ids: [],
      error: { status: 401, code: "invalid_api_key", message: "Invalid API Key" },
    });
  });
});

describe("the chat request and its answer", () => {
  it("sends the system instruction and the prompt as OpenAI-shaped messages", () => {
    expect(groqChatBody("llama-3.3-70b-versatile", "Be brief.", "Facts.")).toMatchObject({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Facts." },
      ],
      max_completion_tokens: 2048,
    });
  });

  it("takes the written text, without a reasoning model's thinking", () => {
    expect(
      readGroqChatText({
        choices: [
          {
            message: { content: "<think>Who clinched?</think>\nThe Stallions clinched." },
            finish_reason: "stop",
          },
        ],
      })
    ).toEqual({ text: "The Stallions clinched." });
  });

  it("refuses an answer cut off at the token cap, and an empty one", () => {
    expect(
      readGroqChatText({
        choices: [{ message: { content: "The Stall" }, finish_reason: "length" }],
      })
    ).toEqual({ text: "", problem: "cut off at the token cap" });
    expect(readGroqChatText({ choices: [] })).toEqual({
      text: "",
      problem: "no usable text (empty)",
    });
  });
});
