import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { DEFAULTS, phaseFromDeficit } from "./logic";

export type NutritionEntry = Database["public"]["Tables"]["nutrition_entries"]["Row"];
export type NutritionConfig = Database["public"]["Tables"]["nutrition_config"]["Row"];

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Not signed in");
  return data.user.id;
}

/** Fetch the user's config, creating a default row on first use. */
export async function getConfig(): Promise<NutritionConfig> {
  const userId = await currentUserId();
  // Ensure a row exists. ignoreDuplicates makes this a no-op when one already
  // does — safe against concurrent calls (e.g. React StrictMode double-mount).
  const { error: upErr } = await supabase
    .from("nutrition_config")
    .upsert(
      {
        user_id: userId,
        tdee: DEFAULTS.tdee,
        protein_target: DEFAULTS.proteinTarget,
        phase_deficits: [DEFAULTS.deficitTarget],
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("nutrition_config")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function saveConfig(
  patch: Database["public"]["Tables"]["nutrition_config"]["Update"],
): Promise<NutritionConfig> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("nutrition_config")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Derived targets for a given config. Phase is inferred from the deficit. */
export function targetsFromConfig(config: NutritionConfig) {
  const raw = config.phase_deficits as number | number[];
  const deficitTarget = Number((Array.isArray(raw) ? raw[0] : raw) ?? DEFAULTS.deficitTarget);
  return {
    tdee: config.tdee,
    proteinTarget: config.protein_target,
    deficitTarget,
    calorieTarget: Math.max(0, Math.round(config.tdee - deficitTarget)),
    cutPhaseName: phaseFromDeficit(deficitTarget),
  };
}

export async function getEntry(date: string): Promise<NutritionEntry | null> {
  const { data, error } = await supabase
    .from("nutrition_entries")
    .select("*")
    .eq("entry_date", date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getEntries(from: string, to: string): Promise<NutritionEntry[]> {
  const { data, error } = await supabase
    .from("nutrition_entries")
    .select("*")
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Upsert a day's calories + protein, snapshotting the active plan. */
export async function saveEntry(
  date: string,
  values: { calories: number; protein: number },
  config: NutritionConfig,
): Promise<NutritionEntry> {
  const userId = await currentUserId();
  const t = targetsFromConfig(config);
  const row = {
    user_id: userId,
    entry_date: date,
    calories: values.calories,
    protein: values.protein,
    tdee: t.tdee,
    calorie_target: t.calorieTarget,
    protein_target: t.proteinTarget,
    deficit_target: t.deficitTarget,
  };
  const { data, error } = await supabase
    .from("nutrition_entries")
    .upsert(row, { onConflict: "user_id,entry_date" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEntry(date: string): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("nutrition_entries")
    .delete()
    .eq("user_id", userId)
    .eq("entry_date", date);
  if (error) throw error;
}
