# Deploy

_Part of the design documents; the map is in the repository's [README](../README.md)._

Vercel deploys the static Vite app. There is no `api/` directory, so this repository
does not create Vercel serverless functions. Firebase deploys both HTTP APIs, `gcTeam`
and `leagueSummary`, and the app uses their URLs by default. `VITE_GC_PROXY_URL` is an
optional override for another proxy, rather than a setting needed to avoid Vercel CPU.
CI runs lint, typecheck, tests, build, and checks that both default endpoints are Firebase.

To stop Vercel function CPU usage, merge and deploy this version of the site. Existing
deployments retain their old functions; remove obsolete preview deployments in Vercel if
they still receive traffic. Usage already incurred remains in the month's total. Optional
AI provider keys belong in GitHub Actions secrets for the Firebase deployment, not Vercel.
Without those keys the app continues to use its local story generator.

## The GameChanger proxy on Firebase

The proxy runs as a Firebase function. Vercel's Hobby plan
bills a function's invocations and CPU, and a nationwide pull spends both: 443,000
calls had used the month's four hours of Active CPU by 28 September 2026. The
function in `functions/` is the shared handler in `server/gc-team.ts`, bundled by
esbuild, with two things a function on another host adds for itself
(`serveGcProxy`): CORS for the app's own pages, including exposing `Retry-After` so
the pull can still hold itself back, and gzip, which Vercel does for a function and
Firebase does not. The app defaults to the project's Firebase function even when
`VITE_GC_PROXY_URL` is absent; there is no fallback to a Vercel API. CI builds the bundle and runs
it on a fake request (`functions/smoke.mjs`) on every change to it, and the
**Firebase functions** workflow deploys it on merge once the project is connected.

**For the list's accounts alone.** Until 2 October 2026 the proxy answered
anyone: GameChanger's endpoints need no login, and nothing it hands back is
secret. Its cost is what changed that. The function is billed by the time it
spends and the bytes it sends, past a free allowance, and the project stops itself
at a dollar (below), so anybody who found the URL could spend the month's dollar
and stop every pull with it. Now a request carries the caller's Firebase sign-in
token (`Authorization: Bearer …`), and the proxy asks Firestore, with that same
token, for the caller's own entry on the list (`memberCheck.ts`). The rules answer
that read for a member and refuse it for anyone else, so the list and the rules
stay the one place that says who is let in, and the proxy holds no key of its own:
Firestore checks the token's signature, hour and project before the rules run. An
answer is kept ten minutes, never past the token's own hour, so a pull of
thousands of teams costs a read or two. A request with no token is turned away
with a 401 without asking anything, one from an account not on the list with a
403, both `reason: "members-only"`; one Firestore could not be asked about is a
503, and kept for no time. `?probe=1` stays open, since it touches nothing
upstream. The app sends the token itself (`gcAuthorization.ts`, set by the cloud
session), and the proxy's CORS lets the header through. A turned-away request
still runs the function, for a few milliseconds and a few hundred bytes, where a
pull's request waits seconds on GameChanger and sends back schedules.

The nightly refresh and the other jobs on GitHub ask GameChanger through the
handler in their own process (`gcTeamHandler`), never through the URL, so the
list does not apply to them. **Verify the GameChanger pull** now asks the
deployed proxy only what a stranger can: that it is up, and that it turns a
request with no sign-in away (**Strangers**, a failure if it answers instead). It
pulls its real teams through the handler in its own process, as the nightly
does, which proves GameChanger answers GitHub's servers and still sends what the
app reads, and no longer proves it answers the Firebase function's: the check has
no account on the list to sign in with. A member's next pull from the app is
that check, and says `blocked` if Google's servers are ever refused.

**What it costs.** It needs the pay-as-you-go Blaze plan, since the free Spark plan
runs no functions; Blaze's free monthly allowances are used first. The daily refresh
of the 26 September pool was 53,254 teams in 5,330 calls, about 160,000 calls a month,
far inside the two million a month Cloud Functions gives free, and each call spends
its time waiting on GameChanger rather than computing. What can pass the free level
is the bytes sent back to the browser, which is why the answer is gzipped. The size
of GameChanger's replies could not be measured from here, so treat the bill as
unknown until the first week's usage is in; a budget alert of a few dollars catches
it either way.

**Connecting it, once.**

1. In the [Firebase console](https://console.firebase.google.com), create a project
   (or pick one) and note its **project ID**. Under **Usage and billing**, switch it
   to **Blaze**, and set a budget alert.
2. Open [Cloud Shell](https://console.cloud.google.com/?cloudshell=true) in that
   project and run this, with your project ID on the first line. It turns on the
   services a deploy needs, makes a deploy account for GitHub with the roles it
   needs, and prints that account's key:

   ```sh
   PROJECT=your-project-id
   gcloud config set project "$PROJECT"
   # Cloud Billing too: every functions deploy runs Firebase's extensions step, which
   # reads the project's plan through it, and the deploy account cannot turn it on.
   gcloud services enable iam.googleapis.com cloudresourcemanager.googleapis.com \
     compute.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com \
     artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com \
     pubsub.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com \
     cloudbilling.googleapis.com
   SA="github-deploy@$PROJECT.iam.gserviceaccount.com"
   gcloud iam service-accounts create github-deploy --display-name "GitHub deploy"
   for ROLE in roles/firebase.admin roles/cloudfunctions.admin roles/run.admin \
     roles/iam.serviceAccountUser roles/artifactregistry.admin \
     roles/serviceusage.serviceUsageConsumer; do
     gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
       --role "$ROLE" --condition=None > /dev/null
   done
   # Builds run as the project's default compute account, which new projects no
   # longer give the role it needs.
   NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member "serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
     --role roles/cloudbuild.builds.builder --condition=None > /dev/null
   gcloud iam service-accounts keys create key.json --iam-account "$SA"
   cat key.json
   ```

3. In GitHub, under the repository's **Settings → Secrets and variables → Actions**,
   add a secret `FIREBASE_SERVICE_ACCOUNT` holding the whole key printed above, and a
   variable `FIREBASE_PROJECT_ID` holding the project ID. Then delete the key from
   Cloud Shell (`rm key.json`). It can deploy to the project, so it belongs in that
   secret and nowhere else.
4. Under **Actions**, run **Firebase functions**. Its log ends with the function's
   URL, `Function URL (gcTeam(us-central1)): https://…`.
5. Under **Actions**, run **Verify the GameChanger pull** with **proxy** set to that
   URL. It checks the function is up and turns a stranger away (**For the list's
   accounts alone**, above). Whether GameChanger's firewall lets a Google server
   through as it does Vercel's is the first pull from the app, signed in, through
   the function. Setting the repository variable `VERIFY_GC_PROXY` to the URL makes
   the weekly check use it too.
6. Deploy the latest site. It defaults to this project's Firebase `gcTeam` URL. Only
   when using another Firebase project, set `VITE_GC_PROXY_URL` to its function URL
   before building the site. The Firebase **Usage** page shows requests arrive.

**A hard stop on the bill.** Google Cloud has no spending cap: a budget only sends
email. The `billingCap` function (`src/lib/billingCap.ts`) makes one, the way
Google's own guide to capping costs does. The budget publishes each of its readings,
several a day, to the Pub/Sub topic `billing-cap`; once a reading says the month's
cost has reached the budget, the function takes the project off its billing account,
and every paid service in it stops, the proxy included, until billing is linked
again. It runs as a service account of its own, the only one allowed to do that,
and the ceiling is the budget's amount rather than a number in the code, so moving
it is an edit to the budget. Google's cost figures arrive hours late, so a stop can
land a little past the amount. Whether the proxy's ordinary use stays under a dollar
is not known until the first week's usage is in, for the reason above.

Set it up once, in Cloud Shell, **before the first deploy** (the deploy creates the
function, and fails for want of its account otherwise):

```sh
PROJECT=your-project-id
gcloud config set project "$PROJECT"
gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com
# The stop's own account: it may unlink billing and be called by its trigger.
gcloud iam service-accounts create billing-cap --display-name "Billing hard stop"
CAP="billing-cap@$PROJECT.iam.gserviceaccount.com"
for ROLE in roles/billing.projectManager roles/run.invoker roles/eventarc.eventReceiver; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$CAP" \
    --role "$ROLE" --condition=None > /dev/null
done
# The deploy account wires the function to its topic.
for ROLE in roles/pubsub.editor roles/eventarc.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:github-deploy@$PROJECT.iam.gserviceaccount.com" \
    --role "$ROLE" --condition=None > /dev/null
done
# What a project's first event-triggered function needs, which the deploy grants
# itself only if it may change the project's roles, and the deploy account may not.
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member "serviceAccount:service-$NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role roles/iam.serviceAccountTokenCreator --condition=None > /dev/null
for ROLE in roles/run.invoker roles/eventarc.eventReceiver; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$NUMBER-compute@developer.gserviceaccount.com" \
    --role "$ROLE" --condition=None > /dev/null
done
# The topic, which budgets may publish to.
gcloud pubsub topics create billing-cap
gcloud pubsub topics add-iam-policy-binding billing-cap \
  --member serviceAccount:billing-budget-alert@system.gserviceaccount.com \
  --role roles/pubsub.publisher > /dev/null
# The budget: a dollar a month on this project, emailing at half and at all of it,
# and publishing every reading to the topic. A budget names its project by number.
BILLING=$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)')
gcloud billing budgets create --billing-account "${BILLING#billingAccounts/}" \
  --display-name "Hard stop" --budget-amount 1.00USD \
  --filter-projects "projects/$NUMBER" \
  --threshold-rule percent=0.5 --threshold-rule percent=1.0 \
  --notifications-rule-pubsub-topic "projects/$PROJECT/topics/billing-cap"
```

A budget made in the console does the same once **Connect a Pub/Sub topic to this
budget**, under its actions, names `billing-cap`. After a deploy, the function's
log (Firebase console, **Functions**, `billingCap`) shows a line for every reading:
"Under the budget (0.12 USD of 1.00 USD); nothing done."

**If it stops the project.** Pulls fail, since the proxy is down. The app does not
switch requests to Vercel. To start it again, raise the budget's amount first, or the next reading
turns billing off again, since the month's cost is still past it; then link the
project to its billing account (**Billing → Account management**, the project's
menu, **Change billing**) and run **Firebase functions** to bring the functions back.

## Cached live data and reconnection

The Import refresh panel keeps a validated status snapshot per account, so opening
it shows saved counts while the cloud reconnects. Cached catch-up actions wait for
fresh status before offering their team lists.

Live rankings, games and scouting views use IndexedDB independently of the browser
pool, which stays closed in cloud mode. Saved views render before a network request
for their replacements, and remain visible during background refreshes or a dropped
connection. Only a first visit without saved data needs a loading screen. Usable
board snapshots are saved together; a new manifest does not strand the cache on
bytes that have not downloaded yet. Cache entries are hash checked and isolated by copy. A membership refusal clears
them, and changing the signed-in account discards its saved snapshot.

Transient status reads and import starts reconnect automatically, with delays capped
at 30 seconds and at most five tries again (`MAX_RECONNECTS`), after which the card says what
went wrong and offers to try again. A question or a warm-up the server gave up on (`aborted`,
or past its time) is not sent again by the call (`GAVE_UP`): each try is a cold load of the whole
pool, and a card that asked one offers to ask again. League Standings' bridge question alone is
asked again on its own, on a timer at most three times a season a New York day, never while the
page is hidden, and never while the server says the edits' month is spent ("What Team Rankings
has, asked of the server"). Sign-in and permission refusals remain actionable. Unkeyed edits are
not blindly repeated after an uncertain save, because doing that could duplicate an
edit. Import starts are safe to retry by their persistent job identity.
