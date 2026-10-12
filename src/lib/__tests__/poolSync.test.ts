/**
 * @vitest-environment jsdom
 *
 * Talking between tabs is a browser thing: half of this is a `storage` event, which needs a window
 * to be dispatched on. The rest of the lib suite stays in node, where it is faster.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listenForLocalPoolWrites,
  openPoolBroadcast,
  POOL_CHANNEL,
  SILENT_BROADCAST,
  TAB_ID,
  type PoolMessage,
} from "../poolSync";

/** A BroadcastChannel that only talks to the other instances made in the same test. */
class FakeChannel {
  static open: FakeChannel[] = [];
  onmessage: ((event: MessageEvent<PoolMessage>) => void) | null = null;
  closed = false;

  constructor(public name: string) {
    FakeChannel.open.push(this);
  }

  postMessage(data: PoolMessage) {
    FakeChannel.open.forEach((channel) => {
      if (channel.closed || channel.name !== this.name) return;
      // A real BroadcastChannel delivers to every other subscriber, and on some browsers to the
      // sender too, which is exactly the echo the tab id is there to filter.
      channel.onmessage?.({ data } as MessageEvent<PoolMessage>);
    });
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeChannel.open = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telling the other tabs", () => {
  it("passes on a key another tab changed", () => {
    const heard: string[] = [];
    openPoolBroadcast((key) => heard.push(key));
    // A second tab, with an id of its own.
    new FakeChannel(POOL_CHANNEL).postMessage({ tab: "another-tab", key: "games" });

    expect(heard).toEqual(["games"]);
  });

  it("ignores the echo of its own write", () => {
    const heard: string[] = [];
    const channel = openPoolBroadcast((key) => heard.push(key));
    channel?.post("games");

    // The tab that wrote already has the value; re-reading would only race its own queued write.
    expect(heard).toEqual([]);
  });

  it("sends the key, not the pool", () => {
    const sent: PoolMessage[] = [];
    openPoolBroadcast(() => undefined);
    const listener = new FakeChannel(POOL_CHANNEL);
    listener.onmessage = (event) => sent.push(event.data);

    openPoolBroadcast(() => undefined)?.post("teams");

    // Copying tens of megabytes to every open tab on every save is what this avoids.
    expect(sent).toEqual([{ tab: TAB_ID, key: "teams" }]);
  });

  it("ignores a message that is not one of ours", () => {
    const heard: string[] = [];
    openPoolBroadcast((key) => heard.push(key));
    const other = new FakeChannel(POOL_CHANNEL);
    other.postMessage({ tab: "another-tab" } as PoolMessage);

    expect(heard).toEqual([]);
  });

  it("hands back nothing where there is no BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(openPoolBroadcast(() => undefined)).toBeNull();
  });

  it("hands back nothing when the channel will not open", () => {
    vi.stubGlobal("BroadcastChannel", function Refuses(): never {
      throw new Error("blocked");
    });
    expect(openPoolBroadcast(() => undefined)).toBeNull();
  });

  it("has a silent stand-in that does nothing rather than throwing", () => {
    expect(() => {
      SILENT_BROADCAST.post("games");
      SILENT_BROADCAST.close();
    }).not.toThrow();
  });

  it("stops listening once closed", () => {
    const heard: string[] = [];
    const channel = openPoolBroadcast((key) => heard.push(key));
    channel?.close();
    new FakeChannel(POOL_CHANNEL).postMessage({ tab: "another-tab", key: "games" });

    expect(heard).toEqual([]);
  });
});

describe("hearing another tab's localStorage writes", () => {
  const fire = (key: string | null) => {
    const event = new Event("storage") as StorageEvent;
    Object.defineProperty(event, "key", { value: key });
    window.dispatchEvent(event);
  };

  it("passes on a pool key", () => {
    const heard: string[] = [];
    const stop = listenForLocalPoolWrites(
      (key) => heard.push(key),
      (key) => key === "pool_games"
    );
    fire("pool_games");
    stop();

    expect(heard).toEqual(["pool_games"]);
  });

  it("ignores a key that is not the pool's", () => {
    const heard: string[] = [];
    const stop = listenForLocalPoolWrites(
      (key) => heard.push(key),
      (key) => key === "pool_games"
    );
    fire("something_else");
    stop();

    expect(heard).toEqual([]);
  });

  it("treats a cleared storage as everything changing at once", () => {
    const heard: string[] = [];
    const stop = listenForLocalPoolWrites(
      (key) => heard.push(key),
      () => false
    );
    // A null key is how a browser says the whole of storage went, not that no key did.
    fire(null);
    stop();

    expect(heard).toEqual([""]);
  });

  it("stops when asked", () => {
    const heard: string[] = [];
    listenForLocalPoolWrites(
      (key) => heard.push(key),
      () => true
    )();
    fire("pool_games");

    expect(heard).toEqual([]);
  });
});
