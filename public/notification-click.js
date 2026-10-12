/*
 * League Forecast's notifications (2.6, `useDigestNotifications`), pressed: back to the app, the
 * window it was already open in if there is one, a new one if not. Loaded into the service worker
 * the build makes (`importScripts` in `vite.config.ts`), which has no handler of its own for this.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => "focus" in client);
      return open ? open.focus() : self.clients.openWindow("/");
    })
  );
});
