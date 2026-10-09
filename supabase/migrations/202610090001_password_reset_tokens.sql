create table if not exists public.password_reset_tokens (
  id bigint generated always as identity primary key,
  user_email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_email_idx
  on public.password_reset_tokens (user_email);

alter table public.password_reset_tokens enable row level security;
revoke all on table public.password_reset_tokens from public, anon, authenticated;
grant all on table public.password_reset_tokens to service_role;

create or replace function public.reset_password_with_token(
  p_token_hash text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reset_row public.password_reset_tokens%rowtype;
begin
  select *
    into reset_row
    from public.password_reset_tokens
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
   for update;

  if not found then
    return false;
  end if;

  update public.users
     set password_hash = p_password_hash,
         updated_at = now()
   where lower(email) = reset_row.user_email;

  if not found then
    update public.password_reset_tokens
       set used_at = now()
     where id = reset_row.id;
    return false;
  end if;

  update public.password_reset_tokens
     set used_at = now()
   where id = reset_row.id;

  return true;
end;
$$;

revoke all on function public.reset_password_with_token(text, text) from public, anon, authenticated;
grant execute on function public.reset_password_with_token(text, text) to service_role;