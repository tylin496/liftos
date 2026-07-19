export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      health_metrics: {
        Row: {
          active_energy_kcal: number | null
          body_fat_pct: number | null
          created_at: string
          exercise_minutes: number | null
          hrv_sdnn_ms: number | null
          id: string
          metric_date: string
          resting_energy_kcal: number | null
          resting_heart_rate: number | null
          sleep_seconds: number | null
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          active_energy_kcal?: number | null
          body_fat_pct?: number | null
          created_at?: string
          exercise_minutes?: number | null
          hrv_sdnn_ms?: number | null
          id?: string
          metric_date: string
          resting_energy_kcal?: number | null
          resting_heart_rate?: number | null
          sleep_seconds?: number | null
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          active_energy_kcal?: number | null
          body_fat_pct?: number | null
          created_at?: string
          exercise_minutes?: number | null
          hrv_sdnn_ms?: number | null
          id?: string
          metric_date?: string
          resting_energy_kcal?: number | null
          resting_heart_rate?: number | null
          sleep_seconds?: number | null
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      exercises: {
        Row: {
          archived: boolean
          assisted_mode: boolean
          compound: boolean
          created_at: string
          id: string
          image_url: string | null
          muscle_group_override: string | null
          name: string
          note: string | null
          slug: string
          sort_order: number
          split: string
          target: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          assisted_mode?: boolean
          compound?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          muscle_group_override?: string | null
          name: string
          note?: string | null
          slug: string
          sort_order?: number
          split: string
          target?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          assisted_mode?: boolean
          compound?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          muscle_group_override?: string | null
          name?: string
          note?: string | null
          slug?: string
          sort_order?: number
          split?: string
          target?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_config: {
        Row: {
          active_phase_index: number | null
          assume_complete_logging: boolean
          bulk_bf_ceiling: number | null
          bulk_start_body_fat_pct: number | null
          bulk_start_date: string | null
          bulk_start_weight: number | null
          cut_start_body_fat_pct: number | null
          cut_start_date: string | null
          cut_start_weight: number | null
          height_cm: number | null
          phase_deficits: Json
          protein_target: number
          sex: string | null
          target_body_fat_pct: number | null
          target_tdee: number | null
          tdee: number
          training_age_months: number | null
          training_start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_phase_index?: number | null
          assume_complete_logging?: boolean
          bulk_bf_ceiling?: number | null
          bulk_start_body_fat_pct?: number | null
          bulk_start_date?: string | null
          bulk_start_weight?: number | null
          cut_start_body_fat_pct?: number | null
          cut_start_date?: string | null
          cut_start_weight?: number | null
          height_cm?: number | null
          phase_deficits?: Json
          protein_target?: number
          sex?: string | null
          target_body_fat_pct?: number | null
          target_tdee?: number | null
          tdee?: number
          training_age_months?: number | null
          training_start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_phase_index?: number | null
          assume_complete_logging?: boolean
          bulk_bf_ceiling?: number | null
          bulk_start_body_fat_pct?: number | null
          bulk_start_date?: string | null
          bulk_start_weight?: number | null
          cut_start_body_fat_pct?: number | null
          cut_start_date?: string | null
          cut_start_weight?: number | null
          height_cm?: number | null
          phase_deficits?: Json
          protein_target?: number
          sex?: string | null
          target_body_fat_pct?: number | null
          target_tdee?: number | null
          tdee?: number
          training_age_months?: number | null
          training_start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_entries: {
        Row: {
          calorie_target: number | null
          calories: number | null
          created_at: string
          deficit_target: number | null
          entry_date: string
          id: string
          protein: number | null
          protein_target: number | null
          tdee: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calorie_target?: number | null
          calories?: number | null
          created_at?: string
          deficit_target?: number | null
          entry_date: string
          id?: string
          protein?: number | null
          protein_target?: number | null
          tdee?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calorie_target?: number | null
          calories?: number | null
          created_at?: string
          deficit_target?: number | null
          entry_date?: string
          id?: string
          protein?: number | null
          protein_target?: number | null
          tdee?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      nutrition_evaluations: {
        Row: {
          accel_direction: string | null
          calorie_target: number | null
          confidence: string
          created_at: string
          cut_mode: string | null
          days_on_target: number | null
          estimated_intake: number | null
          estimated_tdee: number | null
          evaluated_at: string
          intake_difference: number | null
          intake_gap: number | null
          logged_intake: number | null
          longest_gap: number | null
          observed_rate: number
          rec_dismissible: boolean | null
          rec_priority: number | null
          rec_source: string | null
          rec_subtitle: string | null
          rec_title: string | null
          recovery_dismissed_at: string | null
          status: string
          target_max: number
          target_min: number
          updated_at: string
          user_id: string
          weight_data_points: number | null
          window_days: number | null
        }
        Insert: {
          accel_direction?: string | null
          calorie_target?: number | null
          confidence: string
          created_at?: string
          cut_mode?: string | null
          days_on_target?: number | null
          estimated_intake?: number | null
          estimated_tdee?: number | null
          evaluated_at: string
          intake_difference?: number | null
          intake_gap?: number | null
          logged_intake?: number | null
          longest_gap?: number | null
          observed_rate: number
          rec_dismissible?: boolean | null
          rec_priority?: number | null
          rec_source?: string | null
          rec_subtitle?: string | null
          rec_title?: string | null
          recovery_dismissed_at?: string | null
          status: string
          target_max: number
          target_min: number
          updated_at?: string
          user_id: string
          weight_data_points?: number | null
          window_days?: number | null
        }
        Update: {
          accel_direction?: string | null
          calorie_target?: number | null
          confidence?: string
          created_at?: string
          cut_mode?: string | null
          days_on_target?: number | null
          estimated_intake?: number | null
          estimated_tdee?: number | null
          evaluated_at?: string
          intake_difference?: number | null
          intake_gap?: number | null
          logged_intake?: number | null
          longest_gap?: number | null
          observed_rate?: number
          rec_dismissible?: boolean | null
          rec_priority?: number | null
          rec_source?: string | null
          rec_subtitle?: string | null
          rec_title?: string | null
          recovery_dismissed_at?: string | null
          status?: string
          target_max?: number
          target_min?: number
          updated_at?: string
          user_id?: string
          weight_data_points?: number | null
          window_days?: number | null
        }
        Relationships: []
      }
      phase_reports: {
        Row: {
          active_days: number
          adherent_days: number
          assumed_tdee: number | null
          avg_calorie_target: number | null
          avg_calories: number | null
          avg_deficit_target: number | null
          avg_protein: number | null
          created_at: string
          end_body_fat_pct: number | null
          end_date: string
          end_weight_kg: number | null
          id: string
          logged_days: number
          measured_tdee: number | null
          observed_rate_kg_wk: number | null
          phase_kind: string
          planned_rate_kg_wk: number | null
          start_body_fat_pct: number | null
          start_date: string
          start_weight_kg: number | null
          user_id: string
          volume_end_kg_wk: number | null
          volume_start_kg_wk: number | null
        }
        Insert: {
          active_days: number
          adherent_days: number
          assumed_tdee?: number | null
          avg_calorie_target?: number | null
          avg_calories?: number | null
          avg_deficit_target?: number | null
          avg_protein?: number | null
          created_at?: string
          end_body_fat_pct?: number | null
          end_date: string
          end_weight_kg?: number | null
          id?: string
          logged_days: number
          measured_tdee?: number | null
          observed_rate_kg_wk?: number | null
          phase_kind: string
          planned_rate_kg_wk?: number | null
          start_body_fat_pct?: number | null
          start_date: string
          start_weight_kg?: number | null
          user_id: string
          volume_end_kg_wk?: number | null
          volume_start_kg_wk?: number | null
        }
        Update: {
          active_days?: number
          adherent_days?: number
          assumed_tdee?: number | null
          avg_calorie_target?: number | null
          avg_calories?: number | null
          avg_deficit_target?: number | null
          avg_protein?: number | null
          created_at?: string
          end_body_fat_pct?: number | null
          end_date?: string
          end_weight_kg?: number | null
          id?: string
          logged_days?: number
          measured_tdee?: number | null
          observed_rate_kg_wk?: number | null
          phase_kind?: string
          planned_rate_kg_wk?: number | null
          start_body_fat_pct?: number | null
          start_date?: string
          start_weight_kg?: number | null
          user_id?: string
          volume_end_kg_wk?: number | null
          volume_start_kg_wk?: number | null
        }
        Relationships: []
      }
      training_logs: {
        Row: {
          assistance: number | null
          bodyweight: number | null
          created_at: string
          exercise_slug: string
          id: string
          kind: string
          log_date: string
          note: string | null
          raw: string | null
          reps: string | null
          repeated: boolean
          unit: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          assistance?: number | null
          bodyweight?: number | null
          created_at?: string
          exercise_slug: string
          id?: string
          kind?: string
          log_date: string
          note?: string | null
          raw?: string | null
          reps?: string | null
          repeated?: boolean
          unit?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          assistance?: number | null
          bodyweight?: number | null
          created_at?: string
          exercise_slug?: string
          id?: string
          kind?: string
          log_date?: string
          note?: string | null
          raw?: string | null
          reps?: string | null
          repeated?: boolean
          unit?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
