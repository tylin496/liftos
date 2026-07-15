import { supabase } from "@shared/lib/supabase";
import { isViewer } from "@shared/lib/owner";
import type { Database } from "@shared/lib/database.types";
import { DEFAULTS, phaseFromDeficit } from "./logic";

export type NutritionEntry = Database["public"]["Tables"]["nutrition_entries"]["Row"];
export type NutritionConfig = Database["public"]["Tables"]["nutrition_config"]["Row"];

const DEFAULT_PHASE_DEFICITS = [805, 655, 455, 150] as const;

async function currentUserId(): Promise<string> {
  // getSession reads the cached session locally; getUser revalidates over the
  // network on every call — we only need the id, which is already stored.
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw error ?? new Error("Not signed in");
  return data.session.user.id;
}

/** Fetch the config, creating a default row on first use. A shared viewer reads
 *  the owner's config (via RLS) and never creates a row of their own.
 *
 *  Seed-on-miss: the common path (row already exists) is a single select with
 *  no write — the previous version issued a default upsert on *every* call. */
export async function getConfig(): Promise<NutritionConfig> {
  // No user_id filter: RLS returns the caller's own row (owner) or the owner's
  // row (viewer), so this is at most one row either way.
  const { data, error } = await supabase
    .from("nutrition_config")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  // Miss → first use. A viewer never creates a row of their own, so without the
  // owner's row there is simply nothing to show yet.
  if (await isViewer()) throw new Error("No nutrition config for owner yet");

  const userId = await currentUserId();
  // upsert (not insert) so two concurrent first-use calls can't collide on the
  // user_id unique constraint — the loser just re-writes the same defaults.
  const { data: created, error: upErr } = await supabase
    .from("nutrition_config")
    .upsert(
      {
        user_id: userId,
        tdee: DEFAULTS.tdee,
        protein_target: DEFAULTS.proteinTarget,
        phase_deficits: [DEFAULTS.deficitTarget],
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();
  if (upErr) throw upErr;
  return created;
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

/** Derived targets for a given config.
 *  phase_deficits layout:
 *   - [deficit]               legacy single value
 *   - [p0,p1,p2,p3, idx]     old 5-element with activeIndex (idx < 4)
 *   - [p0,p1,p2,p3, intake]  new 5-element with explicit intake goal (intake >= 100)
 */
export function targetsFromConfig(config: NutritionConfig) {
  const raw = config.phase_deficits as number | number[];
  const nums = (Array.isArray(raw) ? raw : [raw]).map(Number).filter((n) => isFinite(n));
  let deficitTarget: number;
  if (nums.length >= 5) {
    const fifth = nums[4];
    if (fifth >= 100) {
      // New format: fifth element is the explicit calorie intake goal
      deficitTarget = Math.max(0, Math.round(config.tdee - fifth));
    } else {
      // Old format: fifth element is activeIndex
      const activeIdx = Math.max(0, Math.min(3, Math.round(fifth)));
      deficitTarget = nums[activeIdx] ?? DEFAULTS.deficitTarget;
    }
  } else {
    deficitTarget = nums[0] ?? DEFAULTS.deficitTarget;
  }
  return {
    tdee: config.tdee,
    proteinTarget: config.protein_target,
    deficitTarget,
    calorieTarget: Math.max(0, Math.round(config.tdee - deficitTarget)),
    cutPhaseName: phaseFromDeficit(deficitTarget),
  };
}

/** Extract all 4 phase deficits and the active phase index from config. */
export function phaseDefsFromConfig(config: NutritionConfig): { defs: number[]; activeIndex: number } {
  const raw = config.phase_deficits as number | number[];
  const nums = (Array.isArray(raw) ? raw : [raw]).map(Number).filter((n) => isFinite(n));

  if (nums.length >= 5) {
    return {
      defs: nums.slice(0, 4),
      activeIndex: Math.max(0, Math.min(3, Math.round(nums[4]))),
    };
  }

  // Legacy: expand to 4 default phases, placing active deficit in the closest slot
  const activeDef = nums[0] ?? DEFAULTS.deficitTarget;
  const defs = [...DEFAULT_PHASE_DEFICITS] as number[];
  const closestIdx = defs.reduce(
    (bestI, d, i) => (Math.abs(d - activeDef) < Math.abs(defs[bestI] - activeDef) ? i : bestI),
    0,
  );
  defs[closestIdx] = activeDef;
  return { defs, activeIndex: closestIdx };
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
