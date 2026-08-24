alter table automation_runs
  add column if not exists execution_options jsonb;
