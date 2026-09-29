/**
 * Writes the cloud copy's owner into `firestore.rules` before a deploy, from the CLOUD_OWNER_EMAIL
 * secret, so the address never sits in the public repository. Run by `firebase.yml` on the
 * runner's own checkout, which is thrown away after the deploy; see `src/lib/cloud/cloudOwner.ts`.
 *
 *   CLOUD_OWNER_EMAIL=... node --experimental-strip-types --import ./scripts/tsRegister.mjs scripts/pinCloudOwner.ts
 *
 * Says only that it pinned an owner, never whom: the log of a public repository's workflow is
 * public too.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pinCloudOwner } from "../src/lib/cloud/cloudOwner.ts";

declare const process: { env: Record<string, string | undefined> };
declare const console: { log: (...args: unknown[]) => void };

const RULES = "firestore.rules";
const email = process.env.CLOUD_OWNER_EMAIL ?? "";

writeFileSync(RULES, pinCloudOwner(readFileSync(RULES, "utf8"), email));
console.log(`${RULES}: the cloud copy's owner is pinned from CLOUD_OWNER_EMAIL.`);
