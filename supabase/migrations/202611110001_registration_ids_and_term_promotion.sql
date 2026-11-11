create or replace function public.generate_student_id(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  student_row public.students%rowtype;
  admission_year text;
  start_year integer;
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

  if student_row.student_id is not null then
    return student_row.student_id;
  end if;

  select academic_year
    into admission_year
    from public.admissions
   where student_id = p_student_id
   order by created_at desc
   limit 1;

  start_year := substring(coalesce(admission_year, '') from '([0-9]{4})')::integer;
  if start_year is null then
    start_year := case
      when extract(month from current_date) >= 8 then extract(year from current_date)::integer
      else extract(year from current_date)::integer - 1
    end;
  end if;
  counter_period := format('%s/%s', start_year, start_year + 1);

  loop
    insert into public.student_id_counters (id_type, id_period, last_number)
    values ('regular', counter_period, 1)
    on conflict (id_type, id_period)
    do update set last_number = public.student_id_counters.last_number + 1
    returning last_number into next_number;

    generated_id := format(
      'COD-%s-%s',
      counter_period,
      lpad(next_number::text, 4, '0')
    );

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

revoke all on function public.generate_student_id(uuid) from public, anon, authenticated;
grant execute on function public.generate_student_id(uuid) to service_role;

create table if not exists public.student_session_promotions (
  student_id uuid not null references public.students(id) on delete cascade,
  session_name text not null,
  previous_level integer not null,
  promoted_level integer not null,
  promoted_at timestamptz not null default now(),
  primary key (student_id, session_name)
);

alter table public.student_session_promotions enable row level security;
revoke all on table public.student_session_promotions from public, anon, authenticated;
grant all on table public.student_session_promotions to service_role;

create or replace function public.promote_student_if_session_complete(
  p_student_id uuid,
  p_session text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  student_row public.students%rowtype;
  completed_terms integer;
  previous_level integer;
  promoted_level integer;
begin
  select *
    into student_row
    from public.students
   where id = p_student_id
   for update;

  if not found then
    raise exception 'Student not found';
  end if;

  select count(distinct case
      when lower(term::text) like '%first%' then '1'
      when lower(term::text) like '%second%' then '2'
      when lower(term::text) like '%third%' then '3'
      else regexp_replace(lower(term::text), '[^0-9]', '', 'g')
    end)
    into completed_terms
    from public.report_cards
   where student_id = p_student_id
     and session::text = p_session
     and case
       when lower(term::text) like '%first%' then '1'
       when lower(term::text) like '%second%' then '2'
       when lower(term::text) like '%third%' then '3'
       else regexp_replace(lower(term::text), '[^0-9]', '', 'g')
     end in ('1', '2', '3')
     and lower(status) in ('submitted', 'approved', 'published');

  if completed_terms < 3 then
    return jsonb_build_object('promoted', false, 'completedTerms', completed_terms);
  end if;

  if exists (
    select 1
      from public.student_session_promotions
     where student_id = p_student_id
       and session_name = p_session
  ) then
    return jsonb_build_object('promoted', false, 'alreadyPromoted', true);
  end if;

  previous_level := coalesce(student_row.level, 0);
  promoted_level := previous_level + 1;

  insert into public.student_session_promotions (
    student_id, session_name, previous_level, promoted_level
  ) values (
    p_student_id, p_session, previous_level, promoted_level
  );

  update public.students
     set level = promoted_level,
         updated_at = now()
   where id = p_student_id;

  return jsonb_build_object(
    'promoted', true,
    'previousLevel', previous_level,
    'currentLevel', promoted_level
  );
end;
$$;

revoke all on function public.promote_student_if_session_complete(uuid, text) from public, anon, authenticated;
grant execute on function public.promote_student_if_session_complete(uuid, text) to service_role;

create or replace function public.promote_student_after_report_card_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.status, '')) in ('submitted', 'approved', 'published') then
    perform public.promote_student_if_session_complete(
      new.student_id,
      new.session::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists report_cards_promote_completed_student on public.report_cards;
create trigger report_cards_promote_completed_student
after insert or update of status, session, term
on public.report_cards
for each row
execute function public.promote_student_after_report_card_change();

revoke all on function public.promote_student_after_report_card_change() from public, anon, authenticated;
grant execute on function public.promote_student_after_report_card_change() to service_role;

update public.admissions
   set track_name = case
     when lower(track_name) like '%music%' or lower(track_name) like '%instrument%' then 'Music'
     when lower(track_name) like '%mixed media%' or lower(track_name) like '%regular%' then 'Mixed Media'
     when lower(track_name) like '%academic%' or lower(track_name) like '%mixed%' then 'Academic'
     else track_name
   end
 where track_name is not null;

