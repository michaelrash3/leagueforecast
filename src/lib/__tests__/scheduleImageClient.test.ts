import { describe, expect, it, vi } from "vitest";
import { SCHEDULE_IMAGE_ENDPOINT } from "../scheduleImage";
import { requestScheduleImageParse } from "../scheduleImageClient";

const request = { imageBase64: "aGVsbG8=", mimeType: "image/jpeg" };

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const okBody = {
  subjectTeam: "South Lexington Red",
  games: [{ date: "2026-08-22", opponent: "Velocirabbits 9U", teamScore: 6, opponentScore: 5 }],
  model: "gemini-2.5-flash",
};

describe("requestScheduleImageParse", () => {
  it("posts the image to the endpoint and returns the sanitized games", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody));
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SCHEDULE_IMAGE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(request);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.subjectTeam).toBe("South Lexington Red");
    expect(outcome.model).toBe("gemini-2.5-flash");
    expect(outcome.games).toHaveLength(1);
  });

  it("passes the server's own reason through, so the UI can say the key is missing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "AI is not configured.", reason: "unconfigured" })
    );
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "unconfigured",
      message: "AI is not configured.",
    });
  });

  it("reads a 404 as the function not being deployed, not as a Gemini failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, null));
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("endpoint-missing");
    expect(outcome.message).toContain(SCHEDULE_IMAGE_ENDPOINT);
  });

  it("treats a 200 that is not JSON as the SPA fallback answering, not a parse", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("Unexpected token <");
          },
        }) as unknown as Response
    );
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("endpoint-missing");
  });

  it("reports a rate limit rather than silently returning nothing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "Too many screenshots. Try again shortly.", reason: "rate-limited" })
    );
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("rate-limited");
  });

  it("fails rather than importing nothing when no row survives sanitizing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { games: [{ opponent: "  " }], model: "gemini-2.5-flash" })
    );
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toBe("No games could be read from that screenshot.");
  });

  it("turns a network failure into an outcome instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const outcome = await requestScheduleImageParse(request, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome).toEqual({ ok: false, reason: "upstream-error", message: "Failed to fetch" });
  });
});
