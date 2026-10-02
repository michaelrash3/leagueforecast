/**
 * Where a browser's GameChanger pulls get the sign-in they carry to the proxy, which is for the
 * accounts on the cloud copy's list alone (`memberCheck.ts`).
 *
 * The cloud session holds the sign-in (`cloudSession.ts`) and registers how to get a token; the
 * GameChanger client asks for one with every request (`gameChangerClient.ts`). A module of its own
 * so neither has to import the other: the client also runs in the nightly job and the cloud's
 * pull legs, which call the proxy's handler in their own process, need no sign-in, and must not
 * load the browser's cloud session to find that out. Until something registers, there is none.
 */

let provider: () => Promise<string | null> = async () => null;

/** Sets where the token comes from: the signed-in account's, or null when nobody is signed in. */
export const setGcAuthorization = (next: () => Promise<string | null>): void => {
  provider = next;
};

/** The token to send now, or null. Never throws: a failed lookup sends none, and the proxy says why. */
export const gcAuthorization = async (): Promise<string | null> => {
  try {
    return await provider();
  } catch {
    return null;
  }
};
