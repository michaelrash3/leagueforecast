import type { FirestoreRestDocuments } from "./firestoreRest";

/**
 * Pulls in the cloud on GitHub (README, "Pulls on GitHub"): the functions that start a pull, a leg
 * of one, or the boards' publish after one, ask GitHub to run `cloud-pull.yml` instead of starting
 * a Google machine for it. Google bills a pull's eight or sixteen gibibytes by the second, and in
 * October 2026 those machines were what spent the project's free allowance; a GitHub runner for a
 * public repository costs nothing, and has the sixteen gigabytes the nightly already pulls the
 * whole pool in.
 *
 * Only where a token is set (`PULLS_ON_GITHUB_TOKEN`): the deploy writes one into the functions'
 * environment from the repository's `PULL_DISPATCH_TOKEN` secret, and GitHub's run is handed its
 * own, so a leg it runs can ask for the next. Without one every launch goes to Google as before.
 */

/** The repository whose workflow runs the pulls, and the workflow. */
export const PULL_WORKFLOW = {
  repo: "michaelrash3/leagueforecast",
  workflow: "cloud-pull.yml",
  ref: "main",
} as const;

/**
 * What a run is asked to do: one leg of a pull (`runPullLeg`; a staged list's leg runs its whole
 * import), a staged import carried on (Resume), or the boards published once a pull has ended.
 */
export type PullDispatch =
  | { task: "leg"; jobId: string; leg: number }
  | { task: "import"; jobId: string }
  | { task: "boards" };

/** The workflow's inputs for `ask`, strings all, as GitHub takes them. */
export const dispatchInputs = (ask: PullDispatch): Record<string, string> =>
  ask.task === "boards"
    ? { task: "boards" }
    : ask.task === "import"
      ? { task: "import", job: ask.jobId }
      : { task: "leg", job: ask.jobId, leg: String(ask.leg) };

/**
 * Asks GitHub to run the workflow for `ask`, and resolves once GitHub has taken it: its answer is
 * 204 with no body, and the run starts within a minute or so. Anything else throws, with the status
 * and GitHub's own message, which is what the device then shows for a pull that could not start.
 */
export const dispatchPull = async (
  ask: PullDispatch,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  const { repo, workflow, ref } = PULL_WORKFLOW;
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs: dispatchInputs(ask) }),
      signal: AbortSignal.timeout(25_000),
    }
  );
  if (response.status === 204 || response.ok) return;
  const said = await response
    .json()
    .then((body: unknown) =>
      typeof (body as { message?: unknown } | null)?.message === "string"
        ? (body as { message: string }).message
        : ""
    )
    .catch(() => "");
  throw new Error(
    `GitHub would not start the pull (HTTP ${response.status}${said ? `: ${said}` : ""}).`
  );
};

/**
 * The token the launches use, where `env` (the functions' `process.env`) sets one; `undefined`
 * sends them to Google.
 */
export const pullDispatchToken = (env: Record<string, string | undefined>): string | undefined => {
  const token = env.PULLS_ON_GITHUB_TOKEN?.trim();
  return token ? token : undefined;
};

/** Where a leg's asking is marked, beside its job's execution lease (`importLeasePath`). */
export const legAskedPath = (jobId: string, leg: number): string =>
  `pullJobs/${jobId}/control/leg-${leg}`;

/**
 * How long a leg's asking may stand unfinished before another ask takes it over: past the 25 s
 * GitHub is given to answer (`dispatchPull`), by enough that only an asker that died, or one whose
 * answer could not be written down, leaves a mark that old.
 */
export const LEG_ASKING_STALE_MS = 2 * 60_000;

/**
 * Asks GitHub for `task`'s leg once, as Cloud Tasks queued a leg once under its name: "already"
 * where it was asked for before. A device asks again every minute for a pull still waiting to
 * start (`startPullJob`), and a GitHub run takes about that long to start, so without the mark a
 * pull sent once started two runs, and every leg after the first that found its leg done asked for
 * the next a second time.
 *
 * The mark says "asking" while GitHub is asked and "asked" once it has taken the run, and only
 * "asked" is the leg queued for good. An asking GitHub refused is marked "refused", and the next
 * ask tries again, as a task Cloud Tasks refused had never been made. One still "asking" after
 * `LEG_ASKING_STALE_MS` is taken over too: its asker died before it could say, or could not write
 * down what GitHub said (Codex, on #440), and a leg asked for in fact meanwhile only runs again
 * under the job's lease, to find itself done (`legJob.ts`), where one never asked would stall the
 * pull until it was ended as silent.
 */
export const dispatchLegOnce = async (
  task: { jobId: string; leg: number },
  deps: {
    docs: Pick<FirestoreRestDocuments, "readAt" | "replace">;
    dispatch: (ask: PullDispatch) => Promise<void>;
    now: () => Date;
  }
): Promise<void | "already"> => {
  const path = legAskedPath(task.jobId, task.leg);
  const at = await deps.docs.readAt(path);
  if (at?.fields.state === "asked") return "already";
  if (at?.fields.state === "asking") {
    const since = deps.now().getTime() - Date.parse(String(at.fields.at));
    // A date that cannot be read is no proof of a live asker.
    if (since < LEG_ASKING_STALE_MS) return "already";
  }
  const marked = await deps.docs.replace(
    path,
    { state: "asking", at: deps.now().toISOString() },
    at?.token ?? null
  );
  // Another ask marked it first, and is asking.
  if (!marked) return "already";
  /** Writes `state` over the mark this ask made, where it is still this ask's; never throws. */
  const settle = async (state: "asked" | "refused"): Promise<void> => {
    const mine = await deps.docs.readAt(path).catch(() => null);
    if (mine?.fields.state !== "asking") return;
    await deps.docs
      .replace(path, { state, at: deps.now().toISOString() }, mine.token)
      .catch(() => false);
  };
  try {
    await deps.dispatch({ task: "leg", jobId: task.jobId, leg: task.leg });
  } catch (error) {
    await settle("refused");
    throw error;
  }
  await settle("asked");
};

/**
 * Whether the rebuilds after saves run, in a build that has them (`built`, the functions'
 * LIVE_REBUILD): not where the pulls are on GitHub (`env`, as `pullDispatchToken` reads it). There a
 * save the boards read is published by its own check (`boardsCheck.ts`) through the boards' publish,
 * which runs on GitHub too, rather than by the `ranking-rebuild` job, whose 8 GiB Google bills by the
 * second: the rebuilds' 113,966 GiB-s and 49,543 vCPU-s were October 2026's largest metered use. So
 * no save asks for a rebuild, a rebuild's task that still comes publishes as a check does, and no
 * decision counts on a rebuild coming (`afterPullDecision`), which would otherwise leave a pull's
 * boards to one that never runs. The ledger (`ops/rebuild`) still meters the edits.
 */
export const rebuildsRun = (built: boolean, env: Record<string, string | undefined>): boolean =>
  built && pullDispatchToken(env) === undefined;
