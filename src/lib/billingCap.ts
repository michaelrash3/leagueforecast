/**
 * The hard stop on the Firebase project's bill.
 *
 * Google Cloud has no spending cap: a budget only sends email. What it can also do is publish each
 * of its readings to a Pub/Sub topic, and this is what reads them, as the `billingCap` function
 * (`functions/src/index.ts`): once a reading says the month's cost has reached the budget, it takes
 * the project off its billing account, and every paid service in the project stops. That is
 * Google's own recipe ("Disable billing usage with notifications"), and it is how a pay-as-you-go
 * project gets a ceiling.
 *
 * The amount lives in the budget, not here: the function compares the two numbers each reading
 * carries, so raising the ceiling is an edit to the budget and not a deploy.
 *
 * Written with web APIs only, like `firebaseProxy.ts`, so it type-checks and tests beside the rest
 * of `src/lib` and runs unchanged on Node.
 */

/** One reading from a budget, as Cloud Billing publishes it to the topic. */
export type BudgetReading = {
  budgetName: string;
  /** What the project has cost so far this month, and what the budget allows. */
  costAmount: number;
  budgetAmount: number;
  currencyCode: string;
};

/** What the stop did with a reading, for the function's log. */
export type BillingCapOutcome =
  | { kind: "unreadable" }
  | { kind: "under"; reading: BudgetReading }
  | { kind: "stopped"; reading: BudgetReading; project: string }
  | { kind: "failed"; reading: BudgetReading; detail: string };

/**
 * Where a function asks who it is and borrows its own identity's token: the metadata server every
 * Cloud Run instance has, so no key is kept anywhere.
 */
export const METADATA_BASE = "http://metadata.google.internal/computeMetadata/v1";
export const CLOUD_BILLING_BASE = "https://cloudbilling.googleapis.com/v1";

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A Pub/Sub message's data, base64 as it arrives, read back as the JSON it carries. */
export const readBudgetReading = (base64: string): BudgetReading | undefined => {
  let raw: unknown;
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const { budgetDisplayName, costAmount, budgetAmount, currencyCode } = raw as Record<
    string,
    unknown
  >;
  if (!isAmount(costAmount) || !isAmount(budgetAmount)) return undefined;
  return {
    budgetName: typeof budgetDisplayName === "string" ? budgetDisplayName : "",
    costAmount,
    budgetAmount,
    currencyCode: typeof currencyCode === "string" ? currencyCode : "",
  };
};

/**
 * Whether the month's cost has reached the budget. A budget of nothing is read as no budget at all,
 * since stopping a project for spending nothing would stop it for good.
 */
export const reachedBudget = (reading: BudgetReading): boolean =>
  reading.budgetAmount > 0 && reading.costAmount >= reading.budgetAmount;

const fromMetadata = async (fetcher: typeof fetch, path: string): Promise<Response> =>
  fetcher(`${METADATA_BASE}/${path}`, { headers: { "Metadata-Flavor": "Google" } });

/**
 * Reads one message and, if the budget has been reached, takes the project off its billing account.
 *
 * Unlinking is what `projects.updateBillingInfo` does with an empty account name, and it needs
 * `resourcemanager.projects.deleteBillingAssignment` on the project: the Project Billing Manager
 * role, given to the function's own service account and to nothing else.
 */
export const capBilling = async (
  base64: string,
  fetcher: typeof fetch = fetch
): Promise<BillingCapOutcome> => {
  const reading = readBudgetReading(base64);
  if (!reading) return { kind: "unreadable" };
  if (!reachedBudget(reading)) return { kind: "under", reading };
  try {
    const project = (await (await fromMetadata(fetcher, "project/project-id")).text()).trim();
    const token = (await (
      await fromMetadata(fetcher, "instance/service-accounts/default/token")
    ).json()) as { access_token?: unknown };
    if (!project || typeof token.access_token !== "string") {
      return { kind: "failed", reading, detail: "no project or token from the metadata server" };
    }
    const answer = await fetcher(
      `${CLOUD_BILLING_BASE}/projects/${encodeURIComponent(project)}/billingInfo`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ billingAccountName: "" }),
      }
    );
    if (!answer.ok) {
      const detail = (await answer.text()).slice(0, 500);
      return {
        kind: "failed",
        reading,
        detail: `Cloud Billing answered ${answer.status}: ${detail}`,
      };
    }
    return { kind: "stopped", reading, project };
  } catch (error) {
    return { kind: "failed", reading, detail: String(error) };
  }
};

const money = (amount: number, currency: string) =>
  `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`;

/** One line for the function's log. */
export const describeCap = (outcome: BillingCapOutcome): string => {
  if (outcome.kind === "unreadable") return "Not a budget reading; nothing done.";
  const { reading } = outcome;
  const spent = `${money(reading.costAmount, reading.currencyCode)} of ${money(
    reading.budgetAmount,
    reading.currencyCode
  )}`;
  if (outcome.kind === "under") return `Under the budget (${spent}); nothing done.`;
  if (outcome.kind === "stopped") {
    return `Budget reached (${spent}): billing is off for ${outcome.project}. Link a billing account to it again to start it back up.`;
  }
  return `Budget reached (${spent}) and billing could NOT be turned off: ${outcome.detail}`;
};
