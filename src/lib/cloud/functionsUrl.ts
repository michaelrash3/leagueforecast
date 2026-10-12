/**
 * Where the app's Firebase functions answer. Without imports, since `vite.config.ts` loads it
 * through `contentPolicy.ts`, whose policy names the functions' host, and the functions themselves
 * deploy to the same region (`functions/src/pullAccess.ts`).
 */

/** The region every function is deployed to. */
export const FUNCTIONS_REGION = "us-central1";

/** The host a project's functions answer on, which a callable is reached at by its name. */
export const functionsOrigin = (projectId: string): string =>
  `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`;

/** One function's address. */
export const functionUrl = (projectId: string, name: string): string =>
  `${functionsOrigin(projectId)}/${name}`;
