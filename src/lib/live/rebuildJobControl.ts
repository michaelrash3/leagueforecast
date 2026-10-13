import type { FirestoreRestDocuments } from "../cloud/firestoreRest";
import { coerceRebuildTask, type RebuildTask } from "./rebuildPlan";

export const REBUILD_JOB_CONTROL = "ops/rebuildJob";
export const REBUILD_JOB_LEASE_MS = 90_000;
type Control = {
  format: 1;
  generation: number;
  task: RebuildTask | null;
  owner: string | null;
  until: number;
  state: string;
  deferredUntil?: string;
  heartbeatAt?: string;
  detail?: string;
};
const controlOf = (raw: Record<string, unknown> | undefined): Control => {
  if (!raw) return { format: 1, generation: 0, task: null, owner: null, until: 0, state: "new" };
  if (
    raw.format !== 1 ||
    !Number.isSafeInteger(raw.generation) ||
    Number(raw.generation) < 0 ||
    !(raw.owner === null || typeof raw.owner === "string") ||
    !Number.isFinite(raw.until)
  )
    throw new Error("The rebuild job's control document cannot be read.");
  return { ...raw, task: coerceRebuildTask(raw.task) } as Control;
};

/** One CAS document prevents missed requests while a worker finishes or a launcher starts it. */
export const rebuildJobControl = (
  docs: Pick<FirestoreRestDocuments, "readAt" | "replace">,
  now: () => number = Date.now
) => {
  const change = async <T>(
    step: (current: Control) => { next?: Control; answer: T }
  ): Promise<T> => {
    for (let n = 0; n < 12; n++) {
      const at = await docs.readAt(REBUILD_JOB_CONTROL);
      const { next, answer } = step(controlOf(at?.fields));
      if (!next || (await docs.replace(REBUILD_JOB_CONTROL, next, at?.token ?? null)))
        return answer;
    }
    throw new Error("The rebuild job's control document kept changing.");
  };
  return {
    request: (task: RebuildTask) =>
      change((current) => {
        const active = current.owner !== null && current.until > now();
        const deferred = Date.parse(current.deferredUntil ?? "") > now();
        return {
          next: {
            ...current,
            generation: current.generation + 1,
            task,
            ...(!active && !deferred
              ? {
                  owner: "launching",
                  until: now() + REBUILD_JOB_LEASE_MS,
                  state: "queued",
                }
              : {}),
          },
          answer: !active && !deferred,
        };
      }),
    claim: (owner: string) =>
      change((current) => {
        if (
          !current.task ||
          Date.parse(current.deferredUntil ?? "") > now() ||
          (current.owner !== null && current.owner !== "launching" && current.until > now())
        )
          return { answer: null };
        const next = { ...current, owner, until: now() + REBUILD_JOB_LEASE_MS, state: "starting" };
        return { next, answer: next };
      }),
    read: async () => controlOf((await docs.readAt(REBUILD_JOB_CONTROL))?.fields),
    renew: (owner: string, detail?: string) =>
      change((current) => {
        if (current.owner !== owner || current.until <= now()) return { answer: false };
        return {
          next: {
            ...current,
            until: now() + REBUILD_JOB_LEASE_MS,
            heartbeatAt: new Date(now()).toISOString(),
            ...(detail ? { detail } : {}),
            state: "running",
          },
          answer: true,
        };
      }),
    complete: (owner: string, generation: number) =>
      change((current) => {
        if (current.owner !== owner || current.generation !== generation) return { answer: false };
        return {
          next: { ...current, owner: null, until: 0, state: "done", deferredUntil: "" },
          answer: true,
        };
      }),
    defer: (owner: string, until: Date, detail: string) =>
      change((current) => {
        if (current.owner !== owner) return { answer: false };
        return {
          next: {
            ...current,
            owner: null,
            until: 0,
            state: "deferred",
            deferredUntil: until.toISOString(),
            detail,
          },
          answer: true,
        };
      }),
    release: (owner: string) =>
      change((current) => {
        if (current.owner !== owner) return { answer: false };
        return { next: { ...current, owner: null, until: 0, state: "waiting" }, answer: true };
      }),
  };
};
