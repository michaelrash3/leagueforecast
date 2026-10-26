import { expect, test } from "@playwright/test";

/**
 * Two tabs of one browser on League Standings (`tabTurn.ts`): the one opened later is read-only and
 * says so, and "Use here" takes the turn, after which the first is the read-only one. The tabs ask
 * each other on a BroadcastChannel, which only a real browser's tabs share.
 */
test("a tab opened after another is read-only until it says Use here", async ({ context }) => {
  const first = await context.newPage();
  await first.goto("/");
  await expect(first.getByRole("tab", { name: "Settings", exact: true })).toBeVisible();

  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByText("Open in another tab", { exact: true })).toBeVisible();
  await expect(first.getByText("Open in another tab", { exact: true })).toHaveCount(0);

  await second.getByRole("button", { name: "Use here" }).click();
  await expect(first.getByText("Open in another tab", { exact: true })).toBeVisible();
  await expect(second.getByRole("tab", { name: "Settings", exact: true })).toBeVisible();
  await expect(second.getByText("Open in another tab", { exact: true })).toHaveCount(0);
});
