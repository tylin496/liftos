import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { parse, score } from "./parser";
import { SEED, SPLITS, type SplitId } from "./seed";

export type Exercise = Database["public"]["Tables"]["exercises"]["Row"];
export type TrainingLog = Database["public"]["Tables"]["training_logs"]["Row"];

/** URL/id-safe slug from a display name. Shared by exercise + stretch creation. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Not signed in");
  return data.user.id;
}

/** Insert the default catalog the first time (no-op if the user already has rows). */
export async function ensureSeeded(): Promise<void> {
  const userId = await currentUserId();
  const { count, error } = await supabase
    .from("exercises")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  if (count && count > 0) return;

  const rows = SPLITS.flatMap((s) =>
    SEED[s.id].map((ex, i) => ({
      user_id: userId,
      split: s.id,
      slug: ex.slug,
      name: ex.name,
      target: ex.target,
      note: ex.note ?? null,
      assisted_mode: ex.assisted ?? false,
      sort_order: i,
    })),
  );
  const { error: insErr } = await supabase
    .from("exercises")
    .upsert(rows, { onConflict: "user_id,slug", ignoreDuplicates: true });
  if (insErr) throw insErr;
}

export async function fetchExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from("exercises")
    .select("*")
    .order("split", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** All logs, grouped by exercise_slug, newest first within each group. */
export async function fetchLogsBySlug(): Promise<Record<string, TrainingLog[]>> {
  const { data, error } = await supabase
    .from("training_logs")
    .select("*")
    .order("log_date", { ascending: false });
  if (error) throw error;
  const grouped: Record<string, TrainingLog[]> = {};
  for (const log of data ?? []) {
    (grouped[log.exercise_slug] ??= []).push(log);
  }
  return grouped;
}

export interface NewLog {
  slug: string;
  raw: string;
  date: string;
  note?: string;
}

/** Parse lifting notation and insert a set. */
export async function addLog({ slug, raw, date, note }: NewLog): Promise<TrainingLog> {
  const parsed = parse(raw);
  if (!parsed || !Number.isFinite(parsed.weight)) {
    throw new Error(`Couldn't parse "${raw}" — try e.g. 100*8 or 97-(25)*8`);
  }
  const userId = await currentUserId();
  const row = {
    user_id: userId,
    exercise_slug: slug,
    log_date: date,
    raw,
    reps: parsed.reps,
    weight_kg: Math.round(score(parsed) * 100) / 100,
    unit: parsed.unit ?? "kg",
    note: note?.trim() || parsed.notes || null,
    kind: parsed.assisted ? "assisted" : "normal",
    assistance: parsed.assisted?.assist ?? null,
    bodyweight: parsed.assisted?.bw ?? null,
  };
  const { data, error } = await supabase
    .from("training_logs")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLog(id: string): Promise<void> {
  const { error } = await supabase.from("training_logs").delete().eq("id", id);
  if (error) throw error;
}

// ─── New exports ──────────────────────────────────────────────────────────────

export interface LogPatch {
  raw?: string;
  reps?: string;
  weight_kg?: number;
  note?: string | null;
  log_date?: string;
  kind?: string;
  assistance?: number | null;
  bodyweight?: number | null;
}

export async function updateLog(id: string, patch: LogPatch): Promise<TrainingLog> {
  const { data, error } = await supabase
    .from("training_logs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function addExercise(
  userId: string,
  split: SplitId,
  name: string,
  target?: string,
  note?: string,
  assistedMode?: boolean,
): Promise<Exercise> {
  // Find current max sort_order for this split. A failed read here would
  // silently place the new exercise at sort_order 0 (colliding at the top),
  // so surface the error instead of guessing an order.
  const { data: existing, error: maxErr } = await supabase
    .from("exercises")
    .select("sort_order")
    .eq("split", split)
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (maxErr) throw maxErr;
  const maxOrder = existing?.[0]?.sort_order ?? -1;

  // Ensure unique slug by appending timestamp suffix
  const slug = `${slugify(name)}-${Date.now().toString(36)}`;

  const row = {
    user_id: userId,
    split,
    slug,
    name: name.trim(),
    target: target?.trim() || null,
    note: note?.trim() || null,
    assisted_mode: assistedMode ?? false,
    sort_order: maxOrder + 1,
    archived: false,
  };

  const { data, error } = await supabase
    .from("exercises")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export interface ExercisePatch {
  name?: string;
  target?: string | null;
  note?: string | null;
  assisted_mode?: boolean;
  archived?: boolean;
  sort_order?: number;
  image_url?: string | null;
}

export async function updateExercise(slug: string, patch: ExercisePatch): Promise<Exercise> {
  const { data, error } = await supabase
    .from("exercises")
    .update(patch)
    .eq("slug", slug)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Update sort_order for each slug by its index position in the array. */
export async function reorderExercises(userId: string, slugs: string[]): Promise<void> {
  const results = await Promise.all(
    slugs.map((slug, i) =>
      supabase
        .from("exercises")
        .update({ sort_order: i })
        .eq("slug", slug)
        .eq("user_id", userId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/** Delete exercise and all its training_logs. */
export async function deleteExerciseAndLogs(userId: string, slug: string): Promise<void> {
  await supabase
    .from("training_logs")
    .delete()
    .eq("exercise_slug", slug)
    .eq("user_id", userId);
  const { error } = await supabase
    .from("exercises")
    .delete()
    .eq("slug", slug)
    .eq("user_id", userId);
  if (error) throw error;
}

// ─── Image upload ─────────────────────────────────────────────────────────────

async function compressImageToBlob(file: File, maxDim = 1200): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      if (file.type !== "image/png") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("compress failed"));
        else resolve(blob);
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load failed")); };
    img.src = url;
  });
}

/** Upload a photo for an exercise to Supabase Storage and persist the URL. */
export async function uploadExerciseImage(slug: string, file: File): Promise<string> {
  const userId = await currentUserId();
  const blob = await compressImageToBlob(file);
  const path = `${userId}/${slug}.png`;
  const { error } = await supabase.storage
    .from("exercise-images")
    .upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) throw error;
  const { data } = supabase.storage.from("exercise-images").getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  await updateExercise(slug, { image_url: url });
  return url;
}

// ─── Stretches (localStorage) ─────────────────────────────────────────────────

const STRETCHES_KEY = "liftos/stretches";

export interface StretchItem {
  id: string;
  name: string;
  note?: string;
  image_url?: string;
}

/** Upload a photo for a stretch to Supabase Storage. Returns the public URL. */
export async function uploadStretchImage(id: string, file: File): Promise<string> {
  const userId = await currentUserId();
  const blob = await compressImageToBlob(file);
  const path = `${userId}/stretches/${id}.png`;
  const { error } = await supabase.storage
    .from("exercise-images")
    .upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) throw error;
  const { data } = supabase.storage.from("exercise-images").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

const DEFAULT_STRETCHES: Record<SplitId, StretchItem[]> = {
  push: [
    { id: "doorway-chest-stretch", name: "Doorway Chest Stretch" },
    { id: "cross-body-shoulder-stretch-push", name: "Cross-Body Shoulder Stretch" },
    { id: "overhead-triceps-stretch", name: "Overhead Triceps Stretch", note: "Optional" },
    { id: "anterior-shoulder-stretch", name: "Anterior Shoulder Stretch", note: "Optional" },
  ],
  pull: [
    { id: "lat-stretch", name: "Lat Stretch", note: "前にストレッチを感じるように" },
    { id: "cross-body-shoulder-stretch-pull", name: "Cross-Body Shoulder Stretch" },
    { id: "biceps-stretch", name: "Biceps Stretch", note: "アームカール後のリカバリー" },
  ],
  legs: [
    { id: "hamstring-stretch", name: "Hamstring Stretch", note: "RDL後の張りを緩和" },
    { id: "hip-flexor-stretch", name: "Hip Flexor Stretch" },
    { id: "adductor-stretch", name: "Adductor Stretch", note: "Optional" },
    { id: "glute-stretch", name: "Glute Stretch", note: "臀部と腰の負担を減らす · Optional" },
  ],
};

export function loadStretches(): Record<SplitId, StretchItem[]> {
  try {
    const raw = localStorage.getItem(STRETCHES_KEY);
    if (raw) return JSON.parse(raw) as Record<SplitId, StretchItem[]>;
  } catch {
    // ignore
  }
  return DEFAULT_STRETCHES;
}

export function saveStretches(data: Record<SplitId, StretchItem[]>): void {
  try {
    localStorage.setItem(STRETCHES_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { SplitId };
export type { TimeFilter } from "./logic";
