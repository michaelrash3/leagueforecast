/**
 * The order the app starts in (`main.tsx`): the pool store and the saved board read off the
 * device, then the first draw, with the cloud session started beside it.
 *
 * A device that keeps a cloud copy used to draw nothing until `bootCloud` had signed in and looked
 * at the copy for League Standings another device had saved, up to `STARTUP_WAIT_MS` and then
 * `STARTUP_TAKE_MS` more (4 s and 6 s), behind a bare "Checking your cloud copy…": the take was
 * there so a phone opened on the latest seasons rather than swapping them in under whoever was
 * looking. A device that has met League's own documents (`leagueMetHere`) takes nothing from the
 * copy for League at all, since its seasons arrive live, so for it that wait bought nothing and
 * cost every open up to ten seconds of blank page. It now draws as soon as the device's own store
 * is read, and the session starts beside the page. Since 16 October 2026 no device waits: a device
 * that keeps a cloud copy is a member's (`memberLive`, below), since a record is switched on only
 * with the account it was signed in as, and one that keeps none has no cloud to wait for, so the
 * wait, and its "Checking your cloud copy…" line, which nothing reached any more, were taken out.
 *
 * A member's device (`memberLive`: a cloud record for a member, signed in when last seen) opens on
 * the cloud's board and on League kept live, and neither reads the device's own store, which on a
 * device that held a pool before the board was published is tens of megabytes: with a seeded
 * 34.5 MB pool, at 4x CPU throttling, the first draw came at 1.3 s, and at 0.46 s once the read no
 * longer held it (medians of five, README "Opening on a member's phone"). So it draws at once, and
 * the store is read once the board is drawn (`drawn`), since unpacking it would take the main
 * thread from the board, or sooner where something needs the pool, which waits for it
 * (`poolFill.ts`). The session starts beside the page, so sign-in is under way by the time the
 * board asks for its reader. A device still to meet League's documents takes the copy's League as
 * a boot that timed out does, offered rather than laid under the page; since 1.6f no device writes
 * the copy, so its League is newer than the device's only on one not opened since, and otherwise
 * the meeting goes on as soon as the session has signed in.
 */
export const startApp = async ({
  fill,
  cloud,
  memberLive = () => false,
  drawn = () => Promise.resolve(),
  mount,
}: {
  /**
   * Reads the device's own store, at once or once `after` settles; a failure still draws, as
   * before.
   */
  fill: (after?: Promise<void>) => Promise<unknown>;
  /** Starts the cloud session, beside a page already drawing. */
  cloud: () => Promise<void>;
  /** Whether this is a member's device, which opens on the cloud's board and League kept live. */
  memberLive?: () => boolean;
  /** Settles once the page's first draw is done (`openingHold.ts`). */
  drawn?: () => Promise<void>;
  mount: () => void;
}): Promise<void> => {
  if (memberLive()) {
    void fill(drawn()).catch(() => undefined);
    mount();
    await cloud().catch(() => undefined);
    return;
  }
  await fill().catch(() => undefined);
  mount();
  await cloud().catch(() => undefined);
};
