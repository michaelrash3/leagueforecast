/**
 * The order the app starts in (`main.tsx`): the pool store and the saved board read off the
 * device, then the cloud session, then the first draw.
 *
 * A device that keeps a cloud copy used to draw nothing until `bootCloud` had signed in and looked
 * at the copy for League Standings another device had saved, up to `STARTUP_WAIT_MS` and then
 * `STARTUP_TAKE_MS` more (4 s and 6 s), behind a bare "Checking your cloud copy…": the take was
 * there so a phone opened on the latest seasons rather than swapping them in under whoever was
 * looking. A device that has met League's own documents (`leagueMetHere`) takes nothing from the
 * copy for League at all, since its seasons arrive live, so for it that wait bought nothing and
 * cost every open up to ten seconds of blank page. It now draws as soon as the device's own store
 * is read, and the session starts beside the page; any other device still waits as before.
 */
export const startApp = async ({
  fill,
  cloud,
  leagueLive,
  mount,
}: {
  /** Reads the device's own store; a failure still draws, as before. */
  fill: () => Promise<unknown>;
  /** Starts the cloud session; told whether the page is waiting on it, to say so while it does. */
  cloud: (waitedOn: boolean) => Promise<void>;
  leagueLive: () => boolean;
  mount: () => void;
}): Promise<void> => {
  await fill().catch(() => undefined);
  if (leagueLive()) {
    mount();
    await cloud(false).catch(() => undefined);
    return;
  }
  await cloud(true).catch(() => undefined);
  mount();
};
