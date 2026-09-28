import { describe, expect, it, vi } from "vitest";
import {
  capBilling,
  CLOUD_BILLING_BASE,
  describeCap,
  METADATA_BASE,
  reachedBudget,
  readBudgetReading,
} from "../billingCap";

/*
 * The hard stop on the Firebase project's bill: a budget's reading, published to Pub/Sub, and the
 * project taken off its billing account once the month's cost reaches the budget.
 */
const encode = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes));
};

const reading = (costAmount: number, budgetAmount = 1) =>
  encode({
    budgetDisplayName: "Hard stop",
    alertThresholdExceeded: 1.0,
    costAmount,
    costIntervalStart: "2026-09-01T07:00:00Z",
    budgetAmount,
    budgetAmountType: "SPECIFIED_AMOUNT",
    currencyCode: "USD",
  });

type Call = { url: string; init: RequestInit | undefined };

/** The metadata server and Cloud Billing as a function sees them, and every request made of them. */
const google = (billing: Response = new Response("{}", { status: 200 })) => {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${METADATA_BASE}/project/project-id`) return new Response("league-proxy\n");
    if (url === `${METADATA_BASE}/instance/service-accounts/default/token`) {
      return Response.json({ access_token: "token-1", expires_in: 3599, token_type: "Bearer" });
    }
    return billing;
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
};

describe("a budget's reading", () => {
  it("is read out of the message as Cloud Billing publishes it", () => {
    expect(readBudgetReading(reading(0.37))).toEqual({
      budgetName: "Hard stop",
      costAmount: 0.37,
      budgetAmount: 1,
      currencyCode: "USD",
    });
  });

  it("keeps a budget's name whatever it is written in", () => {
    const named = encode({ budgetDisplayName: "Plafond · 1 €", costAmount: 0, budgetAmount: 1 });
    expect(readBudgetReading(named)?.budgetName).toBe("Plafond · 1 €");
  });

  it("is nothing when the message is not one", () => {
    for (const data of [
      "",
      "not base64 at all!",
      btoa("not json"),
      encode(null),
      encode({ costAmount: "0.5", budgetAmount: 1 }),
      encode({ costAmount: 0.5 }),
      encode({ costAmount: -1, budgetAmount: 1 }),
    ]) {
      expect(readBudgetReading(data)).toBeUndefined();
    }
  });

  it("reaches the budget at the budget, not a cent before", () => {
    const at = (cost: number, budget = 1) =>
      reachedBudget(readBudgetReading(reading(cost, budget))!);
    expect(at(0.99)).toBe(false);
    expect(at(1)).toBe(true);
    expect(at(4.2)).toBe(true);
    // A budget of nothing is no budget: stopping for spending nothing would stop for good.
    expect(at(0, 0)).toBe(false);
  });
});

describe("the stop", () => {
  it("asks nobody anything while the month is under the budget", async () => {
    const { calls, fetcher } = google();
    const outcome = await capBilling(reading(0.99), fetcher);
    expect(outcome.kind).toBe("under");
    expect(calls).toEqual([]);
    expect(describeCap(outcome)).toBe("Under the budget (0.99 USD of 1.00 USD); nothing done.");
  });

  it("does nothing with a message that is not a reading", async () => {
    const { calls, fetcher } = google();
    expect((await capBilling(btoa("{}"), fetcher)).kind).toBe("unreadable");
    expect(calls).toEqual([]);
  });

  it("takes the project off its billing account once the budget is reached", async () => {
    const { calls, fetcher } = google();
    const outcome = await capBilling(reading(1.02), fetcher);
    expect(outcome).toMatchObject({ kind: "stopped", project: "league-proxy" });
    // Who it is and its own token, from the metadata server: no key is kept anywhere.
    expect(calls.slice(0, 2).map((call) => call.url)).toEqual([
      `${METADATA_BASE}/project/project-id`,
      `${METADATA_BASE}/instance/service-accounts/default/token`,
    ]);
    calls.slice(0, 2).forEach((call) => {
      expect(new Headers(call.init?.headers).get("metadata-flavor")).toBe("Google");
    });
    const unlink = calls[2];
    expect(unlink?.url).toBe(`${CLOUD_BILLING_BASE}/projects/league-proxy/billingInfo`);
    expect(unlink?.init?.method).toBe("PUT");
    expect(new Headers(unlink?.init?.headers).get("authorization")).toBe("Bearer token-1");
    expect(JSON.parse(String(unlink?.init?.body))).toEqual({ billingAccountName: "" });
    expect(calls).toHaveLength(3);
    expect(describeCap(outcome)).toMatch(
      /^Budget reached \(1\.02 USD of 1\.00 USD\): billing is off/
    );
  });

  it("says so, loudly, when Cloud Billing will not do it", async () => {
    const { fetcher } = google(
      new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })
    );
    const outcome = await capBilling(reading(3), fetcher);
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(describeCap(outcome)).toContain("could NOT be turned off");
    expect(describeCap(outcome)).toContain("403");
    expect(describeCap(outcome)).toContain("PERMISSION_DENIED");
  });

  it("says so when the metadata server is not there to ask", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const outcome = await capBilling(reading(3), fetcher);
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(describeCap(outcome)).toContain("fetch failed");
  });
});
