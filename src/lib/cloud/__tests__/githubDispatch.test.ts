import { describe, expect, it } from "vitest";
import {
  dispatchInputs,
  dispatchLegOnce,
  dispatchPull,
  pullDispatchToken,
  rebuildsRun,
} from "../githubDispatch";

/** A fetch that records what it was asked and answers `status`. */
const answering = (status: number, body?: unknown) => {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { asked, fetchImpl };
};

describe("dispatchPull", () => {
  it("asks GitHub to run the pull workflow on main with the leg's inputs", async () => {
    const { asked, fetchImpl } = answering(204);
    await dispatchPull({ task: "leg", jobId: "job123", leg: 2 }, "tok", fetchImpl);
    expect(asked).toHaveLength(1);
    const [{ url, init }] = asked as [{ url: string; init: RequestInit }];
    expect(url).toBe(
      "https://api.github.com/repos/michaelrash3/leagueforecast/actions/workflows/cloud-pull.yml/dispatches"
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({
      ref: "main",
      inputs: { task: "leg", job: "job123", leg: "2" },
    });
  });

  it("throws with GitHub's status and words when it will not start the run", async () => {
    const { fetchImpl } = answering(403, { message: "Resource not accessible by token" });
    await expect(dispatchPull({ task: "boards" }, "tok", fetchImpl)).rejects.toThrow(
      "GitHub would not start the pull (HTTP 403: Resource not accessible by token)."
    );
  });

  it("throws with the status alone when GitHub says nothing readable", async () => {
    const { fetchImpl } = answering(500);
    await expect(
      dispatchPull({ task: "import", jobId: "job123" }, "tok", fetchImpl)
    ).rejects.toThrow("GitHub would not start the pull (HTTP 500).");
  });
});

describe("dispatchInputs", () => {
  it("names the job only where the task has one", () => {
    expect(dispatchInputs({ task: "boards" })).toEqual({ task: "boards" });
    expect(dispatchInputs({ task: "import", jobId: "j" })).toEqual({ task: "import", job: "j" });
    expect(dispatchInputs({ task: "leg", jobId: "j", leg: 0 })).toEqual({
      task: "leg",
      job: "j",
      leg: "0",
    });
  });
});

describe("pullDispatchToken", () => {
  it("is the token where one is set, and nothing for an empty or missing one", () => {
    expect(pullDispatchToken({ PULLS_ON_GITHUB_TOKEN: " tok " })).toBe("tok");
    expect(pullDispatchToken({ PULLS_ON_GITHUB_TOKEN: "  " })).toBeUndefined();
    expect(pullDispatchToken({})).toBeUndefined();
  });
});

/** Firestore's documents held in memory, each write bumping its token, as `readAt` and `replace`. */
const memoryDocs = () => {
  const held = new Map<string, { fields: Record<string, unknown>; token: string }>();
  let writes = 0;
  return {
    held,
    readAt: async (path: string) => held.get(path) ?? null,
    replace: async (path: string, fields: Record<string, unknown>, token: string | null) => {
      if ((held.get(path)?.token ?? null) !== token) return false;
      writes += 1;
      held.set(path, { fields, token: `t${writes}` });
      return true;
    },
  };
};

describe("dispatchLegOnce", () => {
  const now = () => new Date("2026-10-24T17:00:00.000Z");
  const task = { jobId: "job123", leg: 1 };

  it("asks GitHub for a leg once, and answers already for every ask after", async () => {
    const docs = memoryDocs();
    const asked: unknown[] = [];
    const dispatch = async (ask: unknown) => {
      asked.push(ask);
    };
    expect(await dispatchLegOnce(task, { docs, dispatch, now })).toBeUndefined();
    expect(await dispatchLegOnce(task, { docs, dispatch, now })).toBe("already");
    expect(asked).toEqual([{ task: "leg", jobId: "job123", leg: 1 }]);
    expect(docs.held.get("pullJobs/job123/control/leg-1")?.fields.state).toBe("asked");
    // The next leg is a leg of its own.
    expect(await dispatchLegOnce({ ...task, leg: 2 }, { docs, dispatch, now })).toBeUndefined();
    expect(asked).toHaveLength(2);
  });

  it("asks again after GitHub refused, as a task Cloud Tasks refused was never made", async () => {
    const docs = memoryDocs();
    let refuse = true;
    const asked: unknown[] = [];
    const dispatch = async (ask: unknown) => {
      asked.push(ask);
      if (refuse) throw new Error("GitHub would not start the pull (HTTP 401).");
    };
    await expect(dispatchLegOnce(task, { docs, dispatch, now })).rejects.toThrow("HTTP 401");
    expect(docs.held.get("pullJobs/job123/control/leg-1")?.fields.state).toBe("refused");
    refuse = false;
    expect(await dispatchLegOnce(task, { docs, dispatch, now })).toBeUndefined();
    expect(await dispatchLegOnce(task, { docs, dispatch, now })).toBe("already");
    expect(asked).toHaveLength(2);
  });

  it("takes over an asking left unfinished past its time, and not one still under way", async () => {
    const docs = memoryDocs();
    const asked: unknown[] = [];
    const dispatch = async (ask: unknown) => {
      asked.push(ask);
    };
    // An asker that marked the leg and died before GitHub answered, or before it could say so.
    await docs.replace(
      "pullJobs/job123/control/leg-1",
      { state: "asking", at: "2026-10-24T16:59:00.000Z" },
      null
    );
    const at = (iso: string) => () => new Date(iso);
    // A minute on, it may still be asking.
    expect(
      await dispatchLegOnce(task, { docs, dispatch, now: at("2026-10-24T17:00:00.000Z") })
    ).toBe("already");
    expect(asked).toEqual([]);
    // Past its time, the next ask asks, and the leg is then asked for good.
    expect(
      await dispatchLegOnce(task, { docs, dispatch, now: at("2026-10-24T17:01:30.000Z") })
    ).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(docs.held.get("pullJobs/job123/control/leg-1")?.fields.state).toBe("asked");
    expect(
      await dispatchLegOnce(task, { docs, dispatch, now: at("2026-10-24T18:00:00.000Z") })
    ).toBe("already");
    expect(asked).toHaveLength(1);
  });

  it("answers already where another ask marked the leg first", async () => {
    const docs = memoryDocs();
    const racing = {
      ...docs,
      // Read as absent, then found taken: another ask wrote between the two.
      readAt: async () => null,
      replace: async () => false,
    };
    const asked: unknown[] = [];
    expect(
      await dispatchLegOnce(task, {
        docs: racing,
        dispatch: async (ask) => {
          asked.push(ask);
        },
        now,
      })
    ).toBe("already");
    expect(asked).toEqual([]);
  });
});

describe("rebuildsRun", () => {
  it("runs the rebuilds only in a build that has them and where the pulls are not on GitHub", () => {
    expect(rebuildsRun(true, {})).toBe(true);
    expect(rebuildsRun(true, { PULLS_ON_GITHUB_TOKEN: "tok" })).toBe(false);
    expect(rebuildsRun(false, {})).toBe(false);
    expect(rebuildsRun(false, { PULLS_ON_GITHUB_TOKEN: "tok" })).toBe(false);
    // An empty token is no token: the pulls, and so the rebuilds, stay on Google.
    expect(rebuildsRun(true, { PULLS_ON_GITHUB_TOKEN: " " })).toBe(true);
  });
});
