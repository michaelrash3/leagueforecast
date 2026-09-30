# Cloud security, recovery, AI quota, and performance

## Ownership and migration

Every browser document is under `users/{Firebase uid}/copies/main`. The manifest, chunks, pull
jobs, and job pieces inherit that owner path. Rules require both the matching UID and a Google
provider token; authentication alone and a UID in request data grant nothing. Functions take the
UID from the verified callable context and carry it in private Cloud Tasks rather than trusting a
job field. The legacy `copies/**` tree has no rule and is closed.

Before deployment, export Firestore (`gcloud firestore export gs://BUCKET/PREFIX`), record its
operation name, set `FIREBASE_OWNER_UID`, and run
`node functions/migrateLegacy.mjs`. This is a dry run. Run again with `--apply`, compare the source
and target document counts in the emulator or console, deploy the rules and application, and only
then rerun with `--apply --delete-legacy`. Writes use merge semantics, so interrupted or repeated
runs are idempotent. To roll back, restore the export and deploy the previous application/rules;
do not delete the target during diagnosis. Recovery after an interrupted run is simply another
`--apply` run.

## AI summaries

POSTs carry the signed-in user's Firebase ID token. The server verifies it with Firebase before
validating quota or contacting Gemini/Groq. A Google provider identity is required. Atomic minute
(12) and daily (100) counters live in Upstash Redis, shared by cold starts and concurrent
instances; configure `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and
`FIREBASE_WEB_API_KEY`. The endpoint fails closed when verification or quota storage is down,
returns `Retry-After` on quota exhaustion, rejects non-JSON and oversized parsed or raw bodies,
and marks every response private/no-store. Tokens and request bodies are never logged.

## Local-first synchronization and measured targets

The application continues to render its validated local storage while cloud startup is bounded;
cloud code remains lazy, writes are coalesced for 20 seconds, and manifests identify immutable,
hashed chunks so unchanged values are not downloaded. Bulk age review performs one in-memory
transition, one teams/ages/pins persistence pass, and one games write per affected squad year.

Baseline on 2026-09-30 used the deterministic cloud-store tests (small: 2 values; production
shape: incompressible value spanning 3 chunks). Before owner scoping, 38 cloud/API tests completed
in 3.93 s; the component worker could not start under the container's Node 20/undici combination.
The repeatable CI targets are: unchanged manifest path downloads zero chunks; one small mutation
uploads only its changed part; concurrent chunk reads remain parallel; and a bulk correction does
not issue N full-pool saves. Network latency and transferred bytes require an emulator/browser
trace on deployment because this environment has no production credentials. Do not interpret
local unit duration as a production-latency claim.

## Bulk wrong-age review

“Approve all changes” appears only with actionable evidence and a bulk command. Its confirmation
summarizes clubs, years, and target ages. The command evolves one state across mixed years, moves
associated games, pins named ages, persists consolidated outputs, and installs one undo action.
Successful rows leave the review; failures remain and share one result message. Pulls and duplicate
submissions disable the command. The per-club “It plays up/down” remains an explicit opt-out.

## Deferred extraction

The wrong-age command is now isolated from per-row behavior, but extracting the remaining pool
health sections and the 7,000-line legacy GameChanger importer must proceed fixture boundary by
fixture boundary. Moving those blocks without independently testable interfaces would only rename
the risk; the existing fixture suite remains the compatibility gate.
