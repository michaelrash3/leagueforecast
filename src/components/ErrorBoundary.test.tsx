import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * React logs every caught error to the console itself, on top of what the boundary logs. Both are
 * wanted in a browser and neither is wanted in the test output, where they read as failures.
 */
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const Boom = ({ throws }: { throws: boolean }) => {
  if (throws) throw new Error("the rating went sideways");
  return <p>Everything is fine</p>;
};

describe("when a child throws", () => {
  it("says which part broke rather than going blank", () => {
    render(
      <ErrorBoundary area="The rankings">
        <Boom throws />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The rankings could not be shown");
  });

  it("says the data is still there, because that is the first fear", () => {
    render(
      <ErrorBoundary area="The rankings">
        <Boom throws />
      </ErrorBoundary>
    );

    expect(screen.getByText(/nothing has been deleted/i)).toBeInTheDocument();
  });

  it("keeps the message where a bug report can reach it", async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary area="The rankings">
        <Boom throws />
      </ErrorBoundary>
    );

    await user.click(screen.getByText(/what went wrong/i));
    expect(screen.getByText("the rating went sideways")).toBeInTheDocument();
  });

  it("logs it, since the console is the only record there is", () => {
    render(
      <ErrorBoundary area="The rankings">
        <Boom throws />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalled();
  });
});

describe("getting back", () => {
  it("renders the children again once the cause is gone", async () => {
    const user = userEvent.setup();

    const Harness = () => {
      const [throws, setThrows] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setThrows(false)}>
            Fix it
          </button>
          <ErrorBoundary area="The rankings">
            <Boom throws={throws} />
          </ErrorBoundary>
        </>
      );
    };

    render(<Harness />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fix it" }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });

  it("tells the owner to put things back before it retries", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <ErrorBoundary area="The rankings" onReset={onReset}>
        <Boom throws />
      </ErrorBoundary>
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    // Remounting alone is useless while the state that threw is still there to be read again.
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("an overlay that fails", () => {
  it("is said over the page as a dialog, and offers no Close for an area that is not one", () => {
    const { unmount } = render(
      <ErrorBoundary area="The team panel" onClose={() => undefined}>
        <Boom throws />
      </ErrorBoundary>
    );
    const dialog = screen.getByRole("dialog", { name: "The team panel could not be shown" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
    unmount();

    render(
      <ErrorBoundary area="The rankings">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("closes from its button, its backdrop or Escape, putting things back first each time", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onReset = vi.fn(() => order.push("reset"));
    const onClose = vi.fn(() => order.push("close"));
    render(
      <ErrorBoundary area="The team panel" onReset={onReset} onClose={onClose}>
        <Boom throws />
      </ErrorBoundary>
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    // Opening it again is the next try, so what Try again puts back is put back here too.
    expect(order).toEqual(["reset", "close"]);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    const dialog = screen.getByRole("dialog");
    if (!dialog.parentElement) throw new Error("The dialog has no backdrop");
    await user.click(dialog.parentElement);
    expect(onClose).toHaveBeenCalledTimes(3);
    // A press inside the panel is not one on the backdrop.
    await user.click(within(dialog).getByText(/nothing has been deleted/i));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onReset).toHaveBeenCalledTimes(3);
  });
});

describe("when nothing throws", () => {
  it("stays out of the way entirely", () => {
    render(
      <ErrorBoundary area="The rankings">
        <Boom throws={false} />
      </ErrorBoundary>
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });
});
