import { useState } from "react";
import type { Session } from "@shared/lib/auth";
import { OverviewPage } from "@features/overview/page";
import { TrainingPage } from "@features/training/page";
import { NutritionPage } from "@features/nutrition/page";
import { HealthPage } from "@features/health/page";
import { Header } from "./Header";
import { TabBar, type TabId } from "./TabBar";
import { HeaderActionProvider } from "./HeaderActionContext";
import "./layout.css";

const PAGES: Record<TabId, () => JSX.Element> = {
  overview: OverviewPage,
  training: TrainingPage,
  nutrition: NutritionPage,
  health: HealthPage,
};

export function Shell({ session }: { session: Session }) {
  const [tab, setTab] = useState<TabId>("overview");
  const Page = PAGES[tab];

  return (
    <HeaderActionProvider>
      <div className="shell">
        <Header user={session.user} tab={tab} />
        <main className="shell-content">
          <Page />
        </main>
        <TabBar active={tab} onChange={setTab} />
      </div>
    </HeaderActionProvider>
  );
}
