create or replace function public.set_admin_user_active(
  p_user_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.admin_users
  set active = p_active,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Admin user not found';
  end if;
end;
$$;

comment on function public.set_admin_user_active(uuid, boolean)
is 'Activate or deactivate an admin user.';

create or replace function public.reset_admin_user_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  update public.admin_users
  set password_hash = crypt(p_password, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Admin user not found';
  end if;
end;
$$;

comment on function public.reset_admin_user_password(uuid, text)
is 'Reset an admin user password (bcrypt hash).';
