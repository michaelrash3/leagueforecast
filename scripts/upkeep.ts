/**
 * What the nightly reads beside its refresh for two of its alarms (`runAlarms.ts`, README "When a
 * run fails"), as the step before the alarm step:
 *
 *   FIREBASE_SERVICE_ACCOUNT=… PULL_DISPATCH_TOKEN=… npm run upkeep
 *
 * The project's billing, from Cloud Billing's answer for the project with the Firebase key GitHub
 * keeps for deploys (`projects.getBillingInfo`, which costs nothing and reads nothing of the
 * copy): off is what the cost cap does once the month's budget is spent (`billingCap.ts`). And the
 * end of the token the pulls on GitHub are started with, from the header GitHub sends with any
 * answer to a request made with it, asked of `rate_limit`, which spends none of the token's
 * allowance. Each is handed to the alarm step as a word (`billing`, `dispatch`); one that could
 * not be read is handed as nothing, which leaves its alarm as it is. It prints one line for each,
 * never the key or the token, and it never fails the run: the refresh's step says how the night
 * went.
 */
import { appendFileSync } from "node:fs";
import { CLOUD_BILLING_BASE } from "../src/lib/billingCap.ts";
import { failureWords } from "../src/lib/cloud/firestoreRest.ts";
import { billingWord, dispatchWord } from "../src/lib/runAlarms.ts";
import { googleAccess } from "./cloudPool.ts";

declare const process: { env: Record<string, string | undefined> };

const output = (name: string, value: string): void => {
  const file = process.env.GITHUB_OUTPUT;
  if (file && value) appendFileSync(file, `${name}=${value}\n`);
};

const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

const readBilling = async (): Promise<string> => {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) {
    console.log("Billing: no FIREBASE_SERVICE_ACCOUNT here, so it was not read.");
    return "";
  }
  try {
    const access = googleAccess(key, CLOUD_PLATFORM);
    const response = await fetch(
      `${CLOUD_BILLING_BASE}/projects/${encodeURIComponent(access.projectId)}/billingInfo`,
      { headers: { authorization: `Bearer ${await access.token()}` } }
    );
    const word = response.ok ? billingWord(await response.json()) : "";
    console.log(
      word
        ? `Billing: ${word}.`
        : `Billing: not read (Cloud Billing answered HTTP ${response.status}).`
    );
    return word;
  } catch (error) {
    console.log(`Billing: not read (${failureWords(error)}).`);
    return "";
  }
};

const readDispatchToken = async (): Promise<string> => {
  const token = process.env.PULL_DISPATCH_TOKEN?.trim();
  if (!token) {
    console.log("Pull dispatch token: none set, so the pulls start on Google's machines.");
    return "";
  }
  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    const word = dispatchWord(
      {
        status: response.status,
        expires: response.headers.get("github-authentication-token-expiration"),
      },
      Date.now()
    );
    console.log(
      word
        ? `Pull dispatch token: ${word}.`
        : `Pull dispatch token: not read (GitHub answered HTTP ${response.status}).`
    );
    return word;
  } catch (error) {
    console.log(`Pull dispatch token: not read (${failureWords(error)}).`);
    return "";
  }
};

output("billing", await readBilling());
output("dispatch", await readDispatchToken());
