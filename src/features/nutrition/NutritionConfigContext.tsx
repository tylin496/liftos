import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getConfig, saveConfig, type NutritionConfig } from "./api";
import { fetchHealthData } from "@features/health/api";

interface NutritionConfigCtx {
  config: NutritionConfig | null;
  setConfig: (c: NutritionConfig) => void;
  reload: () => void;
}

const Ctx = createContext<NutritionConfigCtx>({
  config: null,
  setConfig: () => {},
  reload: () => {},
});

export function NutritionConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<NutritionConfig | null>(null);

  function load() {
    Promise.all([getConfig(), fetchHealthData(30).catch(() => null)])
      .then(([cfg, health]) => {
        const healthTdee = health?.tdee?.tdee;
        if (healthTdee != null && healthTdee !== cfg.tdee) {
          saveConfig({ tdee: healthTdee })
            .then((updated) => setConfig(updated))
            .catch(() => setConfig({ ...cfg, tdee: healthTdee }));
        } else {
          setConfig(cfg);
        }
      })
      .catch(() => {});
  }

  useEffect(() => { load(); }, []);

  return (
    <Ctx.Provider value={{ config, setConfig, reload: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNutritionConfig() {
  return useContext(Ctx);
}
