alter table public.students
  alter column student_id drop not null;

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

create or replace function public.generate_student_id(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  student_row public.students%rowtype;
  admission_track text;
  admission_instrument text;
  admission_year text;
  start_year integer;
  counter_type text;
  counter_period text;
  next_number integer;
  generated_id text;
begin
  select *
    into student_row
    from public.students
   where id = p_student_id
   for update;

  if not found then
    raise exception 'Student not found';
  end if;

  select track_name, instrument, academic_year
    into admission_track, admission_instrument, admission_year
    from public.admissions
   where student_id = p_student_id
   order by created_at desc
   limit 1;

  start_year := substring(coalesce(admission_year, '') from '([0-9]{4})')::integer;
  if start_year is null then
    start_year := extract(year from current_date)::integer;
  end if;

  if lower(coalesce(admission_track, '')) ~ '(music|instrument)'
     or nullif(trim(coalesce(admission_instrument, '')), '') is not null then
    counter_type := 'music';
    counter_period := start_year::text;
  else
    counter_type := 'regular';
    counter_period := format('%s/%s', start_year, start_year + 1);
  end if;

  loop
    insert into public.student_id_counters (id_type, id_period, last_number)
    values (counter_type, counter_period, 1)
    on conflict (id_type, id_period)
    do update set last_number = public.student_id_counters.last_number + 1
    returning last_number into next_number;

    if counter_type = 'music' then
      generated_id := format('COD-%s-%s', counter_period, lpad(next_number::text, 3, '0'));
    else
      generated_id := format('COD-%s-%s', counter_period, lpad(next_number::text, 4, '0'));
    end if;

    exit when not exists (
      select 1 from public.students where student_id = generated_id
    );
  end loop;

  update public.students
     set student_id = generated_id,
         updated_at = now()
   where id = p_student_id;

  return generated_id;
end;
$$;

create or replace function public.approve_student_id_card_request(
  p_request_id uuid,
  p_admin_id uuid
)
returns table (
  request_id uuid,
  student_id uuid,
  generated_student_id text,
  request_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.id_card_requests%rowtype;
  current_student_id text;
  track_name text;
  instrument text;
  music_track boolean;
begin
  select *
    into request_row
    from public.id_card_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'ID-card request not found';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'ID-card request is not pending';
  end if;

  select s.student_id, a.track_name, a.instrument
    into current_student_id, track_name, instrument
    from public.students s
    left join lateral (
      select adm.track_name, adm.instrument
        from public.admissions adm
       where adm.student_id = s.id
       order by adm.created_at desc
       limit 1
    ) a on true
   where s.id = request_row.student_id
   for update of s;

  music_track := lower(coalesce(track_name, '')) ~ '(music|instrument)'
    or nullif(trim(coalesce(instrument, '')), '') is not null;

  if music_track then
    if current_student_id is null or current_student_id !~ '^COD-[0-9]{4}-[0-9]{3,}$' then
      current_student_id := public.generate_student_id(request_row.student_id);
    end if;
  elsif current_student_id is null or current_student_id !~ '^COD-[0-9]{4}/[0-9]{4}-[0-9]{4,}$' then
    current_student_id := public.generate_student_id(request_row.student_id);
  end if;

  update public.id_card_requests
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = p_admin_id,
         updated_at = now()
   where id = p_request_id;

  return query
  select request_row.id, request_row.student_id, current_student_id, 'approved'::text;
end;
$$;

revoke all on function public.generate_student_id(uuid) from public, anon, authenticated;
revoke all on function public.approve_student_id_card_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.generate_student_id(uuid) to service_role;
grant execute on function public.approve_student_id_card_request(uuid, uuid) to service_role;

do $$
declare
  student_row record;
  generated_id text;
begin
  for student_row in
    select id, student_id
      from public.students
     order by created_at nulls first, id
  loop
    if student_row.student_id is null
       or student_row.student_id !~ '^COD-[0-9]{4}(/[0-9]{4})?-[0-9]{3,}$'
       or exists (
         select 1
           from public.students duplicate
          where duplicate.student_id = student_row.student_id
            and duplicate.id <> student_row.id
       ) then
      generated_id := public.generate_student_id(student_row.id);
      insert into public.notifications (student_id, title, message, type, link)
      values (
        student_row.id,
        'Student ID updated',
        format('Your student ID is now %s.', generated_id),
        'student_id_updated',
        '/student/profile'
      );
    end if;
  end loop;
end;
$$;

create unique index if not exists students_student_id_unique_idx
  on public.students (student_id)
  where student_id is not null;