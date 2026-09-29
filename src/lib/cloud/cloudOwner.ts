/**
 * Whose the cloud copy is: one Google account, named by its email address in `firestore.rules`.
 *
 * The repository is public, so the rules there name a stand-in no sign-in can ever carry, and the
 * deploy writes the owner's address over it from a secret (`scripts/pinCloudOwner.ts`, run by
 * `firebase.yml`). A deploy without the secret leaves the stand-in, and the copy closed to every
 * account, rather than open to any.
 */

/** The owner the rules name in the repository. `.invalid` is reserved never to be a real domain. */
export const OWNER_STAND_IN = "cloud-owner@example.invalid";

/**
 * An address the rules can carry between quotes as it is: no quote, backslash or space can reach
 * the file, whatever the secret holds.
 */
const ADDRESS = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * The rules with the stand-in owner replaced by `email`, lower-cased as the rules compare it.
 * Throws rather than deploy rules that name somebody unintended: on an address that is not one,
 * and on rules that do not name the stand-in exactly once.
 */
export const pinCloudOwner = (rules: string, email: string): string => {
  const owner = email.trim().toLowerCase();
  if (!ADDRESS.test(owner)) {
    throw new Error("CLOUD_OWNER_EMAIL is not an email address.");
  }
  const quoted = `"${OWNER_STAND_IN}"`;
  const named = rules.split(quoted).length - 1;
  if (named !== 1) {
    throw new Error(`firestore.rules names the stand-in owner ${named} times; it must be once.`);
  }
  return rules.replace(quoted, `"${owner}"`);
};
