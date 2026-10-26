import { createContext } from "react";

/**
 * How the AI panel's Check asks the write-ups' function what is wrong (`AiStoryPanel`): handed down
 * from App, which has the write-ups' client in the first download anyway. Imported by the panel,
 * the client took the browser's sign-in (`gcAuthorization.ts`) into the panel's chunk too, and the
 * build split that out of the first download into a file of its own (`bundleBudget.mjs`). With no
 * App above it, as in a test, the check says nothing.
 */
export const AiHealthCheck = createContext<() => Promise<string>>(async () => "");
