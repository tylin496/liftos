import { createContext, useContext } from "react";
import type { TabId } from "./TabBar";

export const NavContext = createContext<(tab: TabId) => void>(() => {});
export const useNav = () => useContext(NavContext);
