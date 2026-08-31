import { describe, expect, it, vi } from "vitest";
import {
  buildModelCandidates,
  discoverGeminiModels,
  GEMINI_FALLBACK_MODEL_IDS,
  isTextGenerationModel,
  modelIdFromName,
  parseGeminiModelId,
  rankGeminiModelIds,
  rankGeminiModels,
  type GeminiModelInfo,
} from "../geminiModels";

const listResponse = (names: string[]): GeminiModelInfo[] =>
  names.map((name) => ({
    name: `models/${name}`,
    supportedGenerationMethods: ["generateContent", "countTokens"],
  }));

describe("modelIdFromName", () => {
  it("strips the models/ resource prefix", () => {
    expect(modelIdFromName("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(modelIdFromName("gemini-2.5-flash")).toBe("gemini-2.5-flash");
  });
});

describe("parseGeminiModelId", () => {
  it("reads major.minor generations", () => {
    expect(parseGeminiModelId("models/gemini-2.5-flash").version).toBe(2.5);
    expect(parseGeminiModelId("gemini-3-pro-preview").version).toBe(3);
    expect(parseGeminiModelId("gemini-1.5-pro").version).toBe(1.5);
  });

  it("classifies tier and stability", () => {
    expect(parseGeminiModelId("gemini-2.5-flash-lite").tier).toBe("flash-lite");
    expect(parseGeminiModelId("gemini-2.5-flash").tier).toBe("flash");
    expect(parseGeminiModelId("gemini-2.5-pro-preview-06-05").stability).toBe(1);
    expect(parseGeminiModelId("gemini-2.0-flash-exp").stability).toBe(2);
    expect(parseGeminiModelId("gemini-2.5-flash").stability).toBe(0);
  });

  it("flags latest aliases and dated snapshots", () => {
    expect(parseGeminiModelId("gemini-flash-latest").isLatestAlias).toBe(true);
    expect(parseGeminiModelId("gemini-2.5-flash-preview-09-2025").isDatedSnapshot).toBe(true);
    expect(parseGeminiModelId("gemini-2.0-flash-001").isDatedSnapshot).toBe(true);
    expect(parseGeminiModelId("gemini-2.5-flash").isDatedSnapshot).toBe(false);
  });
});

describe("isTextGenerationModel", () => {
  it("keeps gemini text models", () => {
    expect(isTextGenerationModel({ name: "models/gemini-2.5-flash" })).toBe(true);
  });

  it("drops non-text and non-gemini models", () => {
    const rejected = [
      "models/text-embedding-004",
      "models/gemini-embedding-001",
      "models/imagen-4.0-generate-001",
      "models/veo-3.0-generate-preview",
      "models/gemini-2.5-flash-preview-tts",
      "models/gemini-2.0-flash-live-001",
      "models/gemini-2.0-flash-preview-image-generation",
      "models/gemini-pro-vision",
      "models/gemma-3-27b-it",
    ];
    rejected.forEach((name) => {
      expect(isTextGenerationModel({ name })).toBe(false);
    });
  });

  it("requires generateContent when the method list is present", () => {
    expect(
      isTextGenerationModel({
        name: "models/gemini-2.5-flash",
        supportedGenerationMethods: ["countTokens"],
      })
    ).toBe(false);
  });

  it("assumes support when the API omits the method list", () => {
    expect(isTextGenerationModel({ name: "models/gemini-2.5-flash" })).toBe(true);
  });
});

describe("rankGeminiModelIds", () => {
  it("attempts the newest generation first", () => {
    const ranked = rankGeminiModelIds([
      "gemini-1.5-flash",
      "gemini-2.5-flash",
      "gemini-3-flash",
      "gemini-2.0-flash",
    ]);
    expect(ranked).toEqual([
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ]);
  });

  it("picks up a brand new generation without a code change", () => {
    const ranked = rankGeminiModelIds(["gemini-2.5-flash", "gemini-4.5-flash", "gemini-3-pro"]);
    expect(ranked[0]).toBe("gemini-4.5-flash");
  });

  it("prefers stable over preview and experimental within a generation", () => {
    const ranked = rankGeminiModelIds([
      "gemini-2.5-flash-exp",
      "gemini-2.5-flash-preview",
      "gemini-2.5-flash",
    ]);
    expect(ranked).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-flash-preview",
      "gemini-2.5-flash-exp",
    ]);
  });

  it("orders tiers flash, pro, flash-lite inside one generation", () => {
    const ranked = rankGeminiModelIds([
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ]);
    expect(ranked).toEqual(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"]);
  });

  it("prefers a rolling id over a dated snapshot", () => {
    const ranked = rankGeminiModelIds(["gemini-2.5-flash-preview-09-2025", "gemini-2.5-flash"]);
    expect(ranked[0]).toBe("gemini-2.5-flash");
  });

  it("treats a latest alias as the newest generation, just behind the named model", () => {
    const ranked = rankGeminiModelIds([
      "gemini-1.5-flash",
      "gemini-flash-latest",
      "gemini-3-flash",
    ]);
    expect(ranked).toEqual(["gemini-3-flash", "gemini-flash-latest", "gemini-1.5-flash"]);
  });

  it("ranks a latest alias above every older numbered model", () => {
    const ranked = rankGeminiModelIds(["gemini-1.5-pro", "gemini-flash-latest"]);
    expect(ranked[0]).toBe("gemini-flash-latest");
  });

  it("dedupes and tolerates resource-prefixed ids", () => {
    expect(rankGeminiModelIds(["models/gemini-2.5-flash", "gemini-2.5-flash"])).toEqual([
      "gemini-2.5-flash",
    ]);
  });
});

describe("rankGeminiModels", () => {
  it("filters the list payload before ranking", () => {
    const ranked = rankGeminiModels([
      ...listResponse(["gemini-2.5-flash", "gemini-3-pro"]),
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ]);
    expect(ranked).toEqual(["gemini-3-pro", "gemini-2.5-flash"]);
  });
});

describe("buildModelCandidates", () => {
  it("tries a pinned model first, then discovery, then fallbacks", () => {
    const candidates = buildModelCandidates({
      pinned: "models/gemini-2.5-pro",
      discovered: ["gemini-3-flash", "gemini-2.5-flash"],
      fallbacks: ["gemini-1.5-flash"],
    });
    expect(candidates).toEqual([
      "gemini-2.5-pro",
      "gemini-3-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ]);
  });

  it("falls back to the static list when discovery returned nothing", () => {
    expect(buildModelCandidates({ discovered: [], limit: 3 })).toEqual(
      GEMINI_FALLBACK_MODEL_IDS.slice(0, 3)
    );
  });

  it("drops duplicates and honours the attempt limit", () => {
    const candidates = buildModelCandidates({
      pinned: "gemini-2.5-flash",
      discovered: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
      fallbacks: ["gemini-1.5-flash"],
      limit: 2,
    });
    expect(candidates).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });
});

describe("discoverGeminiModels", () => {
  it("sends the key as a header and returns ranked ids", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: listResponse(["gemini-2.5-flash", "gemini-3-pro"]) }),
    })) as unknown as typeof fetch;

    const ids = await discoverGeminiModels("secret-key", { fetchImpl });

    expect(ids).toEqual(["gemini-3-pro", "gemini-2.5-flash"]);
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(String(call[0])).toContain("/models");
    expect(call[1]?.headers["x-goog-api-key"]).toBe("secret-key");
  });

  it("returns an empty list when the API rejects the request", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(discoverGeminiModels("bad-key", { fetchImpl })).resolves.toEqual([]);
  });

  it("swallows network failures so callers fall back", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(discoverGeminiModels("key", { fetchImpl })).resolves.toEqual([]);
  });
});
