/**
 * Setup for the component suite (the jsdom project in vite.config.ts).
 *
 * Three things every component test wants and none of them should have to say: the extra matchers
 * from jest-dom, unmounting whatever the last test rendered, and waiting for a pull or a tidy it
 * started to finish. Without the cleanup, one test's markup is still in the document when the next
 * one queries it, and a getByRole that should find one button finds two.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { isPoolBusy, livePull } from "../lib/pullSession";

/*
 * A test is not over while a pull or a tidy it set going is still at work. With no worker, as in
 * jsdom, the tidy fetches its code only once it starts (`usePoolTidy`), and 20 tests in 13 files
 * ended in the middle of one (counted on 2 November 2026 by checking `isPoolBusy` after each test).
 * When such a test was the last in its file, the code was still loading after the file's
 * environment was torn down, and the run failed with an EnvironmentTeardownError (CI on #511). When
 * it was not the last, the tidy finished during the next test and could save its pool into the
 * storage that test had just cleared.
 *
 * Registered before the cleanup below, so it runs after it: Vitest runs `afterEach` hooks
 * last-registered first. The page is gone by then and starts nothing new, and what it started
 * already is waited for. A job still going after ten seconds is not waited for any longer: the test
 * that started it fails, saying so.
 */
afterEach(async () => {
  await vi.waitFor(
    () => {
      if (isPoolBusy()) {
        throw new Error(
          `The test ended with a ${livePull()?.kind ?? "pool job"} still running, and it did not finish within ten seconds.`
        );
      }
    },
    { timeout: 10_000, interval: 10 }
  );
});

afterEach(() => {
  cleanup();
});
