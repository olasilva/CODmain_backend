alter table public.admissions
  drop constraint if exists admissions_status_check;

alter table public.admissions
  add constraint admissions_status_check
  check (status in ('pending', 'reviewing', 'payment_submitted', 'approved', 'rejected'));