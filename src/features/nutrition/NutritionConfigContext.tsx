import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getConfig, saveConfig, type NutritionConfig } from "./api";
import { recomputeAndPersist } from "./evaluationApi";
import { fetchHealthData } from "@features/health/api";

interface NutritionConfigCtx {
  config: NutritionConfig | null;
  /** Set when the config load itself failed — without this the tab would sit
      on its skeleton forever (config stays null) with no way to recover. */
  error: string | null;
  setConfig: (c: NutritionConfig) => void;
  reload: () => void;
}

const Ctx = createContext<NutritionConfigCtx>({
  config: null,
  error: null,
  setConfig: () => {},
  reload: () => {},
});

export function NutritionConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<NutritionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    // Health is a supplemental TDEE overlay — tolerate its absence. Config is
    // load-bearing, so a failure there surfaces an error rather than hanging.
    Promise.all([getConfig(), fetchHealthData(30).catch(() => null)])
      .then(([cfg, health]) => {
        setError(null);
        const healthTdee = health?.tdee?.tdee;
        if (healthTdee != null && healthTdee !== cfg.tdee) {
          saveConfig({ tdee: healthTdee })
            .then((updated) => setConfig(updated))
            .catch(() => setConfig({ ...cfg, tdee: healthTdee }));
        } else {
          setConfig(cfg);
        }
        // App open pulls fresh Health data (incl. weight synced out-of-band),
        // so recompute the shared evaluation here — closes the gap where a pure
        // weight sync wouldn't otherwise trigger a recompute. Fire-and-forget.
        void recomputeAndPersist().catch(() => {});
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)));
  }

  useEffect(() => { load(); }, []);

  return (
    <Ctx.Provider
      value={{
        config,
        error,
        setConfig,
        reload: () => { setError(null); load(); },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useNutritionConfig() {
  return useContext(Ctx);
}
