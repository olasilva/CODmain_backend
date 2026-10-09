alter table public.admissions
  add column if not exists amount_paid numeric(12, 2);