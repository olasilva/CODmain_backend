alter table public.payments
  add column if not exists duration_days integer
  check (duration_days is null or duration_days between 1 and 3650);