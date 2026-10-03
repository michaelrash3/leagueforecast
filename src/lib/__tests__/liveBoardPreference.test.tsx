import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLiveBoard, subscribeLiveBoard, writeLiveBoard } from "../preferences";
import { forgetAppKeys } from "../resetApp";

/*
 * This device's switch for opening Team Rankings on the cloud's board: off unless turned on, heard
 * by whoever is listening, and gone with the rest of the app's keys.
 */

beforeEach(() => window.localStorage.clear());

describe("the switch for the cloud's board", () => {
  it("is off until turned on, and off again once turned off", () => {
    expect(readLiveBoard()).toBe(false);
    writeLiveBoard(true);
    expect(readLiveBoard()).toBe(true);
    writeLiveBoard(false);
    expect(readLiveBoard()).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it("is off for anything stored under its key but its own word", () => {
    window.localStorage.setItem("lf_live_v1", "true");
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

  it("is forgotten with the rest of the app's keys", () => {
    writeLiveBoard(true);
    forgetAppKeys(window.localStorage);
    expect(readLiveBoard()).toBe(false);
  });
});
