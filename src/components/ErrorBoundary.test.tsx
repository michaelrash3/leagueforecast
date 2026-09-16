import { render, screen } from "@testing-library/react";
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
