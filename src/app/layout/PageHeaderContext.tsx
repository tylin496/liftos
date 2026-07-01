import { createContext, useContext, useLayoutEffect } from "react";

export interface PageHeader {
  eyebrow: string;
  title: string;
  onCopy?: () => string | Promise<string>;
}

// Shell renders one persistent PageTopBar; pages push their header content up
// through this context instead of rendering PageTopBar themselves, so the
// avatar/copy button never move during a tab swipe — only the header content
// (eyebrow/title) changes, and Shell owns the fade transition for that.
export const PageHeaderContext = createContext<(header: PageHeader) => void>(() => {});

// Whether the page reading this is the tab currently highlighted in the tab
// bar. Gates usePageHeader so a page that's mounted-but-hidden (Shell keeps
// visited tabs mounted) never clobbers the header of whichever tab is
// actually on screen.
export const IsActiveTabContext = createContext<boolean>(false);

// Re-fires whenever the page's own header content changes while it stays
// active (e.g. Training's split-dependent title fades in place).
export function usePageHeader(header: PageHeader) {
  const setHeader = useContext(PageHeaderContext);
  const active = useContext(IsActiveTabContext);
  useLayoutEffect(() => {
    if (!active) return;
    setHeader(header);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, header.eyebrow, header.title, header.onCopy]);
}
