import { createContext, useContext } from "react";
import type { TabId } from "./TabBar";

export interface NavOptions {
  scrollTo?: string; // Element ID to scroll to within the tab
}

export const NavContext = createContext<(tab: TabId, options?: NavOptions) => void>(() => {});
export const useNav = () => useContext(NavContext);
