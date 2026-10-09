alter table public.students
  alter column student_id drop not null;

alter table public.admissions
  add column if not exists amount_paid numeric(12, 2);

create table if not exists public.student_id_counters (
  id_type text not null check (id_type in ('regular', 'music')),
  id_period text not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (id_type, id_period)
);

create table if not exists public.id_card_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists id_card_requests_one_pending_per_student
  on public.id_card_requests (student_id)
  where status = 'pending';

create index if not exists id_card_requests_status_submitted_idx
  on public.id_card_requests (status, submitted_at desc);

alter table public.student_id_counters enable row level security;
alter table public.id_card_requests enable row level security;
revoke all on table public.student_id_counters from public, anon, authenticated;
revoke all on table public.id_card_requests from public, anon, authenticated;
grant all on table public.student_id_counters to service_role;
grant all on table public.id_card_requests to service_role;