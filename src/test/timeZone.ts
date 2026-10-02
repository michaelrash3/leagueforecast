/**
 * Runs `check` with the process in another time zone, as a reader east or west of UTC would be,
 * and puts the zone back afterwards. Node reads `TZ` afresh whenever it is set, so dates made
 * inside `check` are that zone's.
 *
 * Reached through `globalThis` because the app's compiler has no Node types, on purpose
 * (`scripts/node.d.ts` says why): one narrow shape here rather than `@types/node` everywhere.
 */
export const inTimeZone = (zone: string, check: () => void): void => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process.env;
  const was = env.TZ;
  env.TZ = zone;
  try {
    check();
  } finally {
    if (was === undefined) delete env.TZ;
    else env.TZ = was;
  }
};
