import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Member } from "../lib/cloud/members";
import { memoryMembers } from "../lib/cloud/__tests__/memoryCloud";
import { CloudMembers, type MembersApi } from "./CloudMembers";
import { CloudPanel, type CloudActions } from "./CloudPanel";

/*
 * Who may use the cloud copy, in its panel. The list behind it is the in-memory one the session
 * tests use, refusing what the rules refuse: anyone but the owner reading it, and the owner's own
 * entry being taken off.
 */
const OWNER = "owner@example.com";
const NOW = "2026-10-02T12:00:00.000Z";

const listOf = (): Member[] => [
  { address: OWNER, role: "owner" },
  { address: "coach@example.com", role: "member", addedAt: NOW },
];

/** The panel's calls, over a list as `me` sees it. */
const over = (list: Member[], me: string) => {
  const store = memoryMembers(list, () => me);
  const api: MembersApi = {
    list: async () => ((await store.role()) === "owner" ? store.list() : null),
    add: vi.fn((address: string) => store.add(address, NOW)),
    remove: vi.fn((address: string) => store.remove(address)),
    message: (error) => (error instanceof Error ? error.message : String(error)),
  };
  return { store, api };
};

const rows = () =>
  within(screen.getByRole("region", { name: "Who can use the cloud copy" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

describe("the cloud copy's list of accounts", () => {
  it("shows the owner the list, the owner first and without a button to take it off", async () => {
    const { api } = over(listOf(), OWNER);
    render(<CloudMembers api={api} />);
    expect(await screen.findByRole("region", { name: "Who can use the cloud copy" })).toBeVisible();
    expect(rows()).toEqual(["owner@example.comOwner", "coach@example.comMemberRemove"]);
    expect(
      screen.queryByRole("button", { name: `Take ${OWNER} off the list` })
    ).not.toBeInTheDocument();
  });

  it("adds an account by its address, in lower case, and takes one off", async () => {
    const user = userEvent.setup();
    const { api, store } = over(listOf(), OWNER);
    render(<CloudMembers api={api} />);
    await user.type(
      await screen.findByRole("textbox", { name: "Google account to add" }),
      "  Scout@Example.com "
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("scout@example.com")).toBeInTheDocument();
    expect(store.entries().map((member) => member.address)).toEqual([
      OWNER,
      "coach@example.com",
      "scout@example.com",
    ]);
    expect(screen.getByRole("textbox", { name: "Google account to add" })).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Take coach@example.com off the list" }));
    await vi.waitFor(() =>
      expect(store.entries().map((member) => member.address)).toEqual([OWNER, "scout@example.com"])
    );
    expect(screen.queryByText("coach@example.com")).not.toBeInTheDocument();
  });

  it("asks again for an address that is not one, or one already on the list", async () => {
    const user = userEvent.setup();
    const { api } = over(listOf(), OWNER);
    render(<CloudMembers api={api} />);
    const input = await screen.findByRole("textbox", { name: "Google account to add" });
    await user.type(input, "coach");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Type the email address the account signs in to Google with."
    );
    await user.clear(input);
    await user.type(input, "COACH@example.com");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "coach@example.com is already on the list."
    );
    expect(api.add).not.toHaveBeenCalled();
  });

  it("says what went wrong when the cloud refuses a change", async () => {
    const user = userEvent.setup();
    const { api } = over(listOf(), OWNER);
    const refused: MembersApi = {
      ...api,
      add: async () => {
        throw new Error("Could not reach the cloud.");
      },
    };
    render(<CloudMembers api={refused} />);
    await user.type(
      await screen.findByRole("textbox", { name: "Google account to add" }),
      "scout@example.com"
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the cloud.");
    expect(screen.getByRole("textbox", { name: "Google account to add" })).toHaveValue(
      "scout@example.com"
    );
  });

  it("shows a member nothing, the list being the owner's alone", async () => {
    const { api } = over(listOf(), "coach@example.com");
    const list = vi.spyOn(api, "list");
    const { container } = render(<CloudMembers api={api} />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("sits in the panel of a signed-in copy", async () => {
    const { api } = over(listOf(), OWNER);
    const actions = Object.fromEntries(
      [
        "signIn",
        "save",
        "signOut",
        "loadNewer",
        "retry",
        "restart",
        "bringBack",
        "dismissNotice",
        "reloadApp",
      ].map((name) => [name, vi.fn()])
    ) as unknown as CloudActions;
    render(
      <CloudPanel
        status={{ kind: "saved", account: { uid: "o", email: OWNER }, owed: false, newer: [] }}
        open
        onClose={vi.fn()}
        actions={actions}
        members={api}
        kept={[]}
        now={new Date(NOW)}
      />
    );
    expect(await screen.findByRole("region", { name: "Who can use the cloud copy" })).toBeVisible();
  });
});
