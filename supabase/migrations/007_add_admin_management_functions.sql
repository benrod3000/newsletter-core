create or replace function public.create_client_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Workspace name is required';
  end if;

  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'Workspace slug is required';
  end if;

  insert into public.clients (name, slug)
  values (btrim(p_name), lower(btrim(p_slug)))
  returning id into new_id;

  return new_id;
end;
$$;

comment on function public.create_client_workspace(text, text)
is 'Create a client workspace row.';

create or replace function public.create_admin_user(
  p_username text,
  p_password text,
  p_role text,
  p_client_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_username is null or btrim(p_username) = '' then
    raise exception 'Username is required';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  if p_role not in ('owner', 'editor', 'viewer') then
    raise exception 'Invalid role';
  end if;

  if p_role <> 'owner' and p_client_id is null then
    raise exception 'client_id is required for editor/viewer';
  end if;

  insert into public.admin_users (username, password_hash, role, client_id)
  values (
    lower(btrim(p_username)),
    crypt(p_password, gen_salt('bf')),
    p_role,
    p_client_id
  )
  returning id into new_id;

  return new_id;
end;
$$;

comment on function public.create_admin_user(text, text, text, uuid)
is 'Create an admin user with hashed password.';
