alter table nutrition_config
  add column if not exists training_start_date date;
