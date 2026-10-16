import { describe, expect, it } from "vitest";
import { startApp } from "../bootOrder";

/** A cloud start that does not end until told to, and what happened in what order. */
const harness = (leagueLive: boolean, fill: () => Promise<unknown> = async () => undefined) => {
  const said: string[] = [];
  let finish = () => undefined as void;
  const started = startApp({
    fill,
    cloud: (waitedOn) => {
      said.push(`cloud ${waitedOn ? "waited on" : "beside the page"}`);
      return new Promise<void>((resolve) => {
        finish = () => {
          said.push("cloud done");
          resolve();
        };
      });
    },
    leagueLive: () => leagueLive,
    mount: () => said.push("drawn"),
  });
  return { said, finish: () => finish(), started };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("startApp", () => {
  it("draws at once where League arrives live, with the cloud starting beside the page", async () => {
    const run = harness(true);
    await settle();
    expect(run.said).toEqual(["drawn", "cloud beside the page"]);
    run.finish();
    await run.started;
    expect(run.said).toEqual(["drawn", "cloud beside the page", "cloud done"]);
  });

  it("waits on the cloud before drawing where League still comes from the copy", async () => {
    const run = harness(false);
    await settle();
    expect(run.said).toEqual(["cloud waited on"]);
    run.finish();
    await run.started;
    expect(run.said).toEqual(["cloud waited on", "cloud done", "drawn"]);
  });

  it("draws a member's device at once, its store read only once the page is drawn", async () => {
    const said: string[] = [];
    let drawnNow = () => undefined as void;
    const drawn = new Promise<void>((resolve) => {
      drawnNow = resolve;
    });
    const asked: Array<Promise<void> | undefined> = [];
    void startApp({
      // A store, and a cloud, that never answer: neither holds the first draw.
      fill: (after) => {
        asked.push(after);
        said.push("store asked for");
        return new Promise(() => undefined);
      },
      cloud: (waitedOn) => {
        said.push(`cloud ${waitedOn ? "waited on" : "beside the page"}`);
        return new Promise(() => undefined);
      },
      leagueLive: () => false,
      memberLive: () => true,
      drawn: () => drawn,
      mount: () => said.push("drawn"),
    });
    await settle();
    expect(said).toEqual(["store asked for", "drawn", "cloud beside the page"]);
    // The store's read is told to wait for the page's first draw.
    expect(asked).toEqual([drawn]);
    drawnNow();
  });

  it("still waits for the store before drawing a visitor's page", async () => {
    const said: string[] = [];
    void startApp({
      fill: () => new Promise(() => undefined),
      cloud: async () => {
        said.push("cloud");
      },
      leagueLive: () => true,
      memberLive: () => false,
      mount: () => said.push("drawn"),
    });
    await settle();
    expect(said).toEqual([]);
  });

  it("still draws when the device's store cannot be read", async () => {
    const run = harness(true, async () => {
      throw new Error("no store");
    });
    await settle();
    expect(run.said[0]).toBe("drawn");
  });
});
