alter table if exists pg_execution_steps
  add column if not exists last_error_details jsonb;

alter table if exists pg_execution_steps
  add constraint ck_pg_execution_steps_last_error_details_object
  check (last_error_details is null or jsonb_typeof(last_error_details) = 'object');
