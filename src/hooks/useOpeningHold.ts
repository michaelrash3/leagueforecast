import { useSyncExternalStore } from "react";
import { openingReleased, subscribeOpening } from "../lib/live/openingHold";
import { isPoolFilled, subscribePoolFilled } from "../lib/poolFill";

/** Whether what waits on the live board's first draw may go ahead (`openingHold.ts`). */
export const useOpeningReleased = (): boolean =>
  useSyncExternalStore(subscribeOpening, openingReleased, () => true);

/** Whether this device's own store is in memory, for what reads the pool (`poolFill.ts`). */
export const usePoolFilled = (): boolean =>
  useSyncExternalStore(subscribePoolFilled, isPoolFilled, () => true);
