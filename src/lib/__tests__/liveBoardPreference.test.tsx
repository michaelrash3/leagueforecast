import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLiveBoard, subscribeLiveBoard, writeLiveBoard } from "../preferences";
import { forgetAppKeys } from "../resetApp";

/*
 * This device's switch for opening Team Rankings on the cloud's board: on unless turned off (1.6e),
 * heard by whoever is listening, and gone with the rest of the app's keys, which puts it back on.
 */

beforeEach(() => window.localStorage.clear());

describe("the switch for the cloud's board", () => {
  it("is on until turned off, and off until turned on again", () => {
    expect(readLiveBoard()).toBe(true);
    writeLiveBoard(false);
    expect(readLiveBoard()).toBe(false);
    expect(window.localStorage.getItem("lf_live_v1")).toBe("off");
    writeLiveBoard(true);
    expect(readLiveBoard()).toBe(true);
  });

  it("is off only for its own word for off", () => {
    window.localStorage.setItem("lf_live_v1", "false");
    expect(readLiveBoard()).toBe(true);
    window.localStorage.setItem("lf_live_v1", "off");
    expect(readLiveBoard()).toBe(false);
  });

  it("tells its listeners when it is turned, until they stop listening", () => {
    const heard = vi.fn();
    const stop = subscribeLiveBoard(heard);
    writeLiveBoard(true);
    writeLiveBoard(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    writeLiveBoard(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("is forgotten with the rest of the app's keys, and on again", () => {
    writeLiveBoard(false);
    forgetAppKeys(window.localStorage);
    expect(readLiveBoard()).toBe(true);
  });
});
