/**
 * Setup for the component suite (the jsdom project in vite.config.ts).
 *
 * Two things every component test wants and none of them should have to say: the extra matchers
 * from jest-dom, and unmounting whatever the last test rendered. Without the cleanup, one test's
 * markup is still in the document when the next one queries it, and a getByRole that should find
 * one button finds two.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
