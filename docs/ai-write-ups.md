# AI write-ups

_Part of the design documents; the map is in the repository's [README](../README.md)._

Two panels are written by Gemini when a key is configured: the **League Story**
on Standings (what just happened) and the **Forecast Write-up** on Forecast
(what the model expects next). Both use the same endpoint, model selection, and
failure handling; the request names which one it wants.

## League Story

The Standings panel writes a "League Story" after every update. It is generated
deterministically from standings facts, and — when a Gemini key is configured —
replaced by a Gemini analysis written in a beat-writer voice. **The
deterministic story is always the fallback**, so the app behaves identically
without a key.

The AI analysis is given everything the manager has entered, not just the
cut-line movement:

| Sent to the model    | Why                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Final scores         | What actually happened in this update.                                                                  |
| Standings movement   | Rank changes, clinches, eliminations, cut-line crossings, ranked by impact.                             |
| Full standings table | Record, Gold odds, status, projected finish, run differential.                                          |
| Power ratings        | Opponent-adjusted rating, recent form, trend, SOS rank — where the model disagrees with the raw record. |
| Stat leaders         | Leader, runner-up, and league average for each metric, with which direction is good.                    |
| Season context       | Games finalized vs scheduled, so the model can flag a thin sample instead of overreaching.              |

Only derived values are sent — ranks, odds, ratings, per-game averages. Raw game
logs never leave the browser.

## Forecast Write-up

The Forecast panel explains the projection rather than restating the table: the
headline projected finish, the Gold Bracket race and how thin the cut line is,
the upcoming games that swing the most, where the projection is least certain,
and how much to trust it given the model's measured accuracy.

| Sent to the model | Why                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Projected finish  | Projected rank and record, Gold odds with margin of error, realistic seed range.                                      |
| Game predictions  | Favorite and win probability for each upcoming game, with its impact tier.                                            |
| Games that matter | The high-leverage games the app flags, and the reason each one matters.                                               |
| Model accuracy    | Backtested hit rate, Brier score, and upset capture, so the write-up can say how much weight the projection deserves. |

The prompt requires the model to treat projections as projections, and to
describe a near-coin-flip as one rather than as a expectation.

It is requested only while the Forecast view is open, and re-requested when the
results actually change — not on every simulation tick, whose odds jitter by a
point or two between runs.

## Configuration

| Environment variable | Required | Effect                                                                        |
| -------------------- | -------- | ----------------------------------------------------------------------------- |
| `GEMINI_API_KEY`     | No       | Enables the AI story. Server-side only — never exposed to the browser.        |
| `GEMINI_MODEL`       | No       | Pins one model id (e.g. `gemini-2.5-flash`). Tried first, then the auto list. |
| `GROQ_API_KEY`       | No       | Groq writes the story when Gemini cannot. Server-side only, like Gemini's.    |
| `GROQ_MODEL`         | No       | Pins one Groq model id (e.g. `llama-3.3-70b-versatile`). Tried first.         |

Set `GEMINI_API_KEY` and `GROQ_API_KEY` as GitHub Actions repository secrets, and
optional `GEMINI_MODEL` and `GROQ_MODEL` as repository variables. The **Firebase functions**
workflow passes them to Firebase on deployment. For a local Firebase deployment, use the
gitignored `functions/.env.<project-id>` file. Do
_not_ prefix them with `VITE_`: any `VITE_*` variable is inlined into the client
bundle and would publish the key to every visitor. The browser posts recap facts
to the Firebase `leagueSummary` function and the function calls Gemini with the key, and Groq with
its key when Gemini cannot write the story.

**Only the accounts on the cloud copy's list may ask** (26 October 2026, the owner's choice).
The function was open to anybody who found its URL, and each call spends the owner's Gemini
and Groq quota. It now stands behind the same door as the GameChanger proxy (`membersOnly`,
`memberCheck.ts`): the browser sends its sign-in with every ask, the function asks Firestore
for the caller's own entry on the list, and anyone else is answered `members-only` before a
provider is asked. The health check and its probe are behind it too, since the probe asks both
providers for their models. A browser not signed in sends nothing and writes its own story, and
its header says `AI off — sign in to the cloud copy`. With the door in front, the per-IP
throttle below no longer has to tell strangers apart: a forged `X-Forwarded-For` gets a member
past only their own limit.

## Model selection

The app is not pinned to a Gemini version. On each cold start it calls
`GET /v1beta/models` with the configured key, keeps the models that support
`generateContent`, and orders them so the newest is attempted first:

1. Highest generation number — `gemini-4` before `gemini-3` before `gemini-2.5`.
   A `*-latest` alias inherits the newest generation in the list.
2. Tier: `flash`, then `pro`, then `flash-lite`. Flash leads because the story is
   a short summarization task with the most generous rate limits.
3. Stable before `preview` before `-exp`, within one generation.
4. Rolling ids before dated snapshots (`gemini-2.5-flash` before
   `gemini-2.5-flash-preview-09-2025`).

The request walks down that list (up to four models) and returns the first
success, so a missing, retired, or rate-limited model degrades to the next best
one. A newly released Gemini is picked up automatically, with no code change.
If listing models fails, a hand-maintained fallback list in
`src/lib/geminiModels.ts` is used instead. The list is cached for 30 minutes per
warm instance.

## Groq, when Gemini cannot

The user added a Groq key on 28 September 2026 for when Gemini's quota runs out, which it
does at the worst time, a day of results entered at once. With `GROQ_API_KEY` set, a story
Gemini could not write is asked of Groq instead, with the same prompt and instructions:
Gemini at its quota on every model, most often, but also a key Gemini rejects or no model to
ask. Either key alone is enough. With both, Gemini is asked first, and 8 of the 25 seconds a
story may take are kept back so a Gemini walk that times out still leaves Groq an attempt.

Groq's models are chosen the way Gemini's are (`src/lib/groqModels.ts`). The key lists them
(`GET /openai/v1/models`), the speech, safety-classifier and agentic ones are dropped, and the
rest are tried in a hand-kept order of preference (`GROQ_PREFERRED_MODEL_IDS`), a general
model first since a recap needs no reasoning, then any others the key lists, newest first, up
to three. When the list cannot be read, the preferred list is tried as it stands, and a model
Groq has retired answers with an error and the next is tried. A reasoning model's `<think>`
text is taken out, and an answer cut off at the token cap is refused for the next model. The
`AI` badge's tooltip says which provider wrote the story, and when both are at their limits the
answer is `rate-limited`, with both providers' messages.

## Failure behavior

Every failure path returns a non-200 with a machine-readable `reason`
(`unconfigured`, `throttled`, `rate-limited`, `upstream-error`, `no-model`,
`invalid-request`, `members-only`), and the UI keeps showing the deterministic story rather than
an error.

`throttled` and `rate-limited` are deliberately separate. `throttled` is this
app's own per-browser limit, refused before any model is contacted — so nothing
was asked of Gemini and walking the model list would not have helped.
`rate-limited` means Gemini itself refused every model that was tried.

The League Story header says which state it is in, so a misconfiguration is
diagnosable at a glance instead of looking like "the AI just isn't running":

| Header shows                         | Meaning                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `AI` badge                           | Gemini or Groq wrote this. The tooltip names which, and the model.                  |
| `AI off — no API key`                | The function ran but neither `GEMINI_API_KEY` nor `GROQ_API_KEY` is readable by it. |
| `AI off — endpoint not deployed`     | The Firebase `leagueSummary` function is unavailable.                               |
| `AI off — sign in to the cloud copy` | Not signed in with an account on the cloud copy's list, which alone may ask.        |
| `Paused — too many retries`          | This app's own per-browser limit. No model was attempted.                           |
| `AI limit reached`                   | Gemini's quota refused every model tried, and Groq's too when its key is set.       |
| `No AI model available`              | The key listed no usable model.                                                     |
| `AI unavailable`                     | Something else upstream. The tooltip carries the message.                           |

A **Retry** button re-requests it, and **Rewrite** asks for a fresh take on an
analysis that already succeeded. The endpoint is throttled per IP (best effort,
in-memory).

## Diagnosing it

When a write-up is unavailable, the panel header shows a **Why?** button. It
asks the endpoint what is actually wrong and prints the answer in place — which
model the key can reach, or that the key is not reaching the function, or that
nothing is serving the endpoint at all. It runs as a `fetch`, so a stale service
worker cannot answer it with the cached app shell.

The same check is available directly at `GET /leagueSummary` on Firebase, for a request
that carries a member's sign-in (opened in a browser's address bar it answers
`members-only`; the panel's **Why?** sends the sign-in):

```
https://us-central1-league-forecast-youth.cloudfunctions.net/leagueSummary
https://us-central1-league-forecast-youth.cloudfunctions.net/leagueSummary?probe=1
```

| Result                              | Meaning                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| **404**                             | The function is not deployed or not routed. The app shows `AI off — endpoint not deployed`.      |
| `keyConfigured: false`              | The function is deployed but `GEMINI_API_KEY` is not reaching it.                                |
| `keyHadSurroundingWhitespace: true` | The stored value has leading/trailing whitespace (a paste artifact).                             |
| `keyLength`                         | Length only, never the value — catches a truncated paste.                                        |
| `revision`                          | The Cloud Run revision serving it. A new deploy makes a new one.                                 |
| **401** / **403** `members-only`    | No sign-in, or an account not on the cloud copy's list.                                          |
| `?probe=1` → `ok: true`             | The key can list models; `candidates` shows the attempt order, newest first.                     |
| `?probe=1` → `ok: false`            | Gemini rejected the key. The response quotes Google's own error and names the fix.               |
| `?probe=1` → `listError`            | Google's verbatim status and message for the model listing.                                      |
| `?probe=1` → `generation`           | Result of one tiny `generateContent` call — a key can be able to generate but not list.          |
| `groq`                              | The Groq key's side: `keyConfigured`, `keyLength`, `keyHadSurroundingWhitespace`, `pinnedModel`. |
| `?probe=1` → `groq.probe`           | Whether Groq lists models for its key, the order they would be tried, and Groq's own error.      |

Credentials previously stored in Vercel do not reach Firebase. Copy the provider keys into
GitHub Actions repository secrets and redeploy **Firebase functions** after changing them.

A key **restricted to HTTP referrers** is the trap worth knowing about: it works
from a browser and fails from a server, because a server sends no referrer. That
reads as "the key is fine, the server is broken" when it is the other way round.
The probe names this case explicitly, along with a disabled Generative Language
API, an IP-restricted key, and an over-quota key.

Even when listing fails, the app still reaches the newest model: the fallback
list leads with the `gemini-flash-latest` and `gemini-pro-latest` aliases, which
always resolve to Google's current release for their tier.

The probe is rate limited under its own smaller budget, kept separate from the
summary endpoint's so a burst of retries cannot starve the diagnostic that
explains them, and it reports no secret material. When the probe is the thing
being throttled it says so, rather than reporting a key Gemini never saw as one
Gemini rejected.

## Local development

`npm run dev` serves the Vite app and uses the deployed Firebase APIs. When the summary
function has no provider keys, the deterministic story is shown. API tests exercise the
shared handlers with recorded provider responses and require no deployed credentials.
