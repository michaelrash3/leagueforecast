import type { CloudStatus } from "./cloudSession";

/**
 * Why this browser cannot pull from GameChanger, or null when it can.
 *
 * The proxy is for the accounts on the cloud copy's list (`memberCheck.ts`), and turns any other
 * caller away. The import panel asks this first, so a visitor is told before a run starts rather
 * than by a run that stops on its first request. Only what the browser knows for certain shuts the
 * door: nobody signed in, or an account the copy has already refused. A copy that is merely out of
 * reach, or a build with no cloud at all, leaves the pull to the proxy's own answer.
 */
export const pullBlockedBy = (status: CloudStatus): string | null => {
  switch (status.kind) {
    case "none":
    case "signed-out":
      return "Pulling from GameChanger is for the accounts on the cloud copy's list. Sign in with one from the cloud button, then pull.";
    case "not-owner":
      return `${status.account.email ?? "This Google account"} is not on the cloud copy's list, so it cannot pull from GameChanger. Ask the list's owner to add it.`;
    default:
      return null;
  }
};
