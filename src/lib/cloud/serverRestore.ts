import type { CallDeps } from "../live/editClient";

/**
 * An earlier version of the cloud copy brought back by the server (1.6), as the Cloud panel asks
 * for it: the edit function's `copy.restore`, the copy's owner's alone. The device asks and the
 * server writes, so a device never writes the copy to bring a version back, which it will not be
 * let do once the copy is the server's alone. Loaded only when asked, so the panel carries none of
 * the edit client's code until a version is brought back.
 */

/** What came of asking: brought back, or why not, in words a person can act on. */
export type RestoreAnswer = { ok: true } | { ok: false; message: string };

/** Said of a version the copy no longer keeps. */
export const NO_LONGER_KEPT = "That version is no longer kept.";

/** Asks the server to make kept version `group` the current one of copy `copy`. */
export const restoreOnServer = async (
  group: string,
  copy: string,
  deps: CallDeps
): Promise<RestoreAnswer> => {
  const [client, said] = await Promise.all([
    import("../live/editClient"),
    import("../live/liveEdits"),
  ]);
  const called = await client.callEdit({ command: { kind: "copy.restore", group }, copy }, deps);
  if (!called.ok) return { ok: false, message: called.message };
  const reply = called.value;
  if (reply.ok) return { ok: true };
  return {
    ok: false,
    message: reply.why === "missing" ? NO_LONGER_KEPT : said.EDIT_REFUSED[reply.why],
  };
};

/** Said of a staged backup the server no longer finds whole. */
export const UPLOAD_GONE =
  "The backup's upload was not all there, so nothing was changed. Restore the file again.";
/** Said of a staged backup the server could not read as one. */
export const UPLOAD_UNREADABLE =
  "The cloud could not read that file as a Team Rankings backup, so nothing was changed.";

/** Asks the server to restore Team Rankings in copy `copy` from staged upload `upload`. */
export const restoreBackupOnServer = async (
  upload: string,
  copy: string,
  deps: CallDeps
): Promise<RestoreAnswer> => {
  const [client, said] = await Promise.all([
    import("../live/editClient"),
    import("../live/liveEdits"),
  ]);
  const called = await client.callEdit({ command: { kind: "backup.restore", upload }, copy }, deps);
  if (!called.ok) return { ok: false, message: called.message };
  const reply = called.value;
  if (reply.ok) return { ok: true };
  return {
    ok: false,
    message:
      reply.why === "missing"
        ? UPLOAD_GONE
        : reply.why === "refused"
          ? UPLOAD_UNREADABLE
          : said.EDIT_REFUSED[reply.why],
  };
};
