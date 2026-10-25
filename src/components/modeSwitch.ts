import { createContext } from "react";
import type { TabNavAction } from "./TabNav";

/**
 * The More list's way to the other half of the app, on a phone (2.4).
 *
 * The switch between League Standings and Team Rankings is the pair of tabs at the top of the
 * page, which a phone has scrolled out of sight by the time anyone reaches for it. League
 * Standings' bar is App's own and takes the action directly; Team Rankings' bar sits four
 * components down, inside a lazily loaded page, so App hands the action down this way rather than
 * through every component between.
 */
export const ModeSwitchContext = createContext<TabNavAction | null>(null);
