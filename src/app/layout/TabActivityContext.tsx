import { createContext, useContext } from "react";

// Increments each time the user navigates TO a tab.
// Pages use this as a useEffect dependency to trigger background re-fetch.
export const TabActivityContext = createContext<number>(0);
export const useTabActivity = () => useContext(TabActivityContext);
