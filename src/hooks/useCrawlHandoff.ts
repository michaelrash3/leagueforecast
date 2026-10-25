import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  ackMessage,
  loadedMessage,
  readHandoffMessage,
  readyMessage,
  type HandoffKind,
} from "../lib/crawlHandoff";
import {
  heldHandoff,
  holdHandoff,
  onHandoffLoaded,
  subscribeHandoff,
  takeHandoff,
  type HeldFile,
} from "../lib/crawlHandoffStore";

/**
 * Listens for the crawl's files on this page (`crawlHandoff.ts`), once, for the whole app.
 *
 * Says it is ready as it mounts and whenever the courier says hello; holds the files each message
 * carries and answers it; tells the courier as each file is applied; and opens Team Rankings'
 * Import (`openImport`) when new files arrive, where whichever Import is drawn takes them
 * (`useHeldHandoff`). Nothing is fetched, stored or pulled here.
 */
export function useCrawlHandoff(openImport: () => void): void {
  const open = useRef(openImport);
  useEffect(() => {
    open.current = openImport;
  }, [openImport]);

  useEffect(() => {
    const post = (message: object) => window.postMessage(message, window.location.origin);
    const onMessage = (event: MessageEvent) => {
      const read = readHandoffMessage(event, { origin: window.location.origin, window });
      if (read.kind === "ignore") return;
      if (read.kind === "hello") {
        post(readyMessage());
        return;
      }
      if (read.kind === "refuse") {
        post(ackMessage(read.id, false, read.reason));
        return;
      }
      const { status, loaded } = holdHandoff(read);
      post(ackMessage(read.id, true));
      // Told again, in case the courier missed it the first time; applied again, never.
      loaded.forEach((kind) => post(loadedMessage(read.id, kind)));
      if (status === "held") open.current();
    };
    const offLoaded = onHandoffLoaded((id, kind) => post(loadedMessage(id, kind)));
    window.addEventListener("message", onMessage);
    post(readyMessage());
    return () => {
      window.removeEventListener("message", onMessage);
      offLoaded();
    };
  }, []);
}

/**
 * Takes a handed-over file of `kind` whenever one is held and `ready` says this Import could apply
 * it the way its own file input would, and hands it to `apply`, which calls `handoffLoaded` once
 * the file has gone in: that is when the miner is told.
 */
export function useHeldHandoff(
  kind: HandoffKind,
  ready: boolean,
  apply: (held: HeldFile) => void
): void {
  const held = useSyncExternalStore(subscribeHandoff, heldHandoff, heldHandoff);
  const applyNow = useRef(apply);
  useEffect(() => {
    applyNow.current = apply;
  }, [apply]);
  const waiting = held[kind] !== null;
  useEffect(() => {
    if (!ready || !waiting) return;
    const taken = takeHandoff(kind);
    if (taken) applyNow.current(taken);
  }, [kind, ready, waiting]);
}
