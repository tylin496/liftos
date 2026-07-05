import { createContext, useContext } from "react";
import type { TabId } from "./TabBar";

export interface NavOptions {
  scrollTo?: string; // Element ID to scroll to within the tab
  expand?: boolean; // ask the scrollTo target to open its detail on arrival
}

export const NavContext = createContext<(tab: TabId, options?: NavOptions) => void>(() => {});
export const useNav = () => useContext(NavContext);

// Carries the scrollTo id whose detail should auto-expand on this tab entry
// (set when a nav passes `expand: true`), so a deep-linked card can open its
// collapsed section — coming from Overview means you want the detail, not the
// summary. Null when the tab was entered without an expand request.
export const NavExpandContext = createContext<string | null>(null);
export const useNavExpand = () => useContext(NavExpandContext);
