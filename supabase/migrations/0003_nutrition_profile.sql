-- Profile / goals fields for richer AI export.
-- All nullable: existing rows stay valid, fields are optional in the UI.

alter table public.nutrition_config
  add column if not exists height_cm            real,
  add column if not exists training_age_months  integer,
  add column if not exists target_body_fat_pct  real;
