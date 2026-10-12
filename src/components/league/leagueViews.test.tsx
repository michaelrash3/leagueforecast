import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";
import { LIKELY_NEXT, viewChunk } from "./leagueViews";

/*
 * A League view loaded on demand (2.1): a placeholder while it loads, drawn at once once loaded,
 * and a failed load one view's Try again, which fetches afresh, rather than a failure kept for good.
 */

const Greeting = ({ name }: { name: string }) => <p>Hello {name}</p>;

/** A load the test settles by hand. */
const deferred = () => {
  let resolve: (component: typeof Greeting) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<typeof Greeting>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const drawn = (View: ComponentType<{ name: string }>, onReset?: () => void) => (
  <ErrorBoundary area="Greeting" {...(onReset ? { onReset } : {})}>
    <Suspense fallback={<p>Loading Greeting…</p>}>
      <View name="Aces" />
    </Suspense>
  </ErrorBoundary>
);

describe("a League view loaded on demand", () => {
  it("shows a placeholder while it loads, and is drawn at once from then on", async () => {
    const load = deferred();
    const chunk = viewChunk(() => load.promise, "Greeting");
    const first = render(drawn(chunk.View));
    expect(screen.getByText("Loading Greeting…")).toBeInTheDocument();
    await act(async () => load.resolve(Greeting));
    expect(await screen.findByText("Hello Aces")).toBeInTheDocument();
    first.unmount();
    // Back to the tab: no placeholder in between.
    render(drawn(chunk.View));
    expect(screen.getByText("Hello Aces")).toBeInTheDocument();
    expect(screen.queryByText("Loading Greeting…")).toBeNull();
  });

  it("loads once however often it is asked for, and a prefetch never fails", async () => {
    const load = vi.fn(() => Promise.reject(new Error("offline")));
    const chunk = viewChunk(load, "Greeting");
    await expect(chunk.prefetch()).resolves.toBeUndefined();
    // A failed load is not kept: the next ask loads again.
    await chunk.prefetch();
    expect(load).toHaveBeenCalledTimes(2);
    const once = vi.fn(() => Promise.resolve(Greeting));
    const other = viewChunk(once, "Greeting");
    await Promise.all([other.prefetch(), other.prefetch()]);
    render(drawn(other.View));
    expect(screen.getByText("Hello Aces")).toBeInTheDocument();
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("tries again afresh after a failed load, rather than repeating the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const attempts = [deferred(), deferred()];
    let attempt = 0;
    const chunk = viewChunk(() => (attempts[attempt++] ?? deferred()).promise, "Greeting");
    render(drawn(chunk.View, chunk.reset));
    await act(async () =>
      attempts[0]?.reject(new Error("Failed to fetch a dynamically imported module"))
    );
    expect(await screen.findByText("Greeting could not be shown")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Loading Greeting…")).toBeInTheDocument();
    await act(async () => attempts[1]?.resolve(Greeting));
    expect(await screen.findByText("Hello Aces")).toBeInTheDocument();
    expect(attempt).toBe(2);
    vi.restoreAllMocks();
  });

  it("fetches ahead only the tab most often opened next", () => {
    expect(LIKELY_NEXT).toEqual({ dashboard: "games", standings: "model" });
  });
});
