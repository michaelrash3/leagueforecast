# Verifying the GameChanger pull

Everything about the import is tested against recorded fixtures — a thousand-odd tests, and none of
them has ever made a request to GameChanger. Fixtures prove the code. They cannot prove:

- whether GameChanger's AWS WAF lets a server through at all, or demands a token only a browser can
  get;
- whether today's payload is still the shape the normalizer expects;
- whether the schedules that come back actually carry scores.

Those need one real request. This is how to make it.

## Run it

```sh
npm run verify:gc -- --base https://your-deployment.vercel.app --id FtEExZwB4b8E
```

`--base` defaults to `http://localhost:3000`, where `vercel dev` serves the function. Pass `--id`
more than once to check several teams; the batch endpoint is exercised with all of them together,
because that is the path a real pull uses and a single id never touches it.

It exits non-zero if anything essential failed, so it can be wired into a shell script or a check.

## What it checks, and why each one matters

| Check          | What a failure means                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Proxy          | The function is not answering at all. Deployment or `--base`, not GameChanger.                        |
| Pull           | GameChanger refused, or answered something unreadable. The reason says which.                         |
| Team profile   | The payload parsed but carries no name — the normalizer is reading the wrong field.                   |
| Age level      | No age level anywhere, so every game from this team lands on a page chosen by hand.                   |
| Season         | No season, so the squad year has to be guessed from the dates.                                        |
| Schedule       | The schedule endpoint answered with nothing. One team with no games is fine; every team empty is not. |
| Scores         | Nothing carries a final score. Either nothing has been played, or the score fields have moved.        |
| Opponents      | A game names nobody, so its opponent becomes a placeholder rather than a club.                        |
| Dates          | A game with no date cannot be placed in a squad year, so it is dropped from every rating.             |
| Batch endpoint | A real pull asks ten at a time. If this path is broken, every pull is.                                |

A **warn** is a pull that worked and told you something about the data. A **fail** is a pull that
did not work.

## The WAF, which is the question

`blocked` is the answer nobody can predict from a fixture. GameChanger's AWS WAF challenges the
schedule page in a browser, and a browser answers with an `x-aws-waf-token` header. A serverless
function has no way to run that challenge.

If the verify script reports `blocked`:

1. Open `https://web.gc.com/teams/<id>/schedule` in a browser.
2. In the network panel, find a request to `api.team-manager.gc.com` and copy its
   `x-aws-waf-token` header.
3. Set `GC_EXTRA_HEADERS` in the deployment to `{"x-aws-waf-token": "..."}` and redeploy.
4. Run the script again.

A token expires, so this is a diagnosis rather than a deployment strategy. If it turns out to be
needed every time, the pull needs a different route to GameChanger — that is a real finding and
worth knowing before a nationwide pull is attempted, not during one.

## What the script does not prove

It pulls a handful of teams. It says nothing about what happens at twenty thousand: how often
GameChanger throttles, whether the WAF gets stricter under load, how long a full rotation takes.
Those need the real pull, which is why the importer is resumable and why the weekly rota exists.

Start with one team. Then one age level. Then the rota.
