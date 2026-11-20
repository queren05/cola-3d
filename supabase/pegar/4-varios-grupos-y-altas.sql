-- ---------- varios grupos por persona, grupo «Otros» y aviso de cada alta ----------
-- Una persona puede estar en Familia y Amigos a la vez (ve los dos).
-- «Otros» es para gente de fuera: cada uno solo ve lo suyo y lo del taller, no a los demás de Otros.

alter table public.miembros drop constraint if exists miembros_grupo_check;
alter table public.miembros add constraint miembros_grupo_check check (grupo in ('familia', 'amigos', 'otros'));
alter table public.miembros drop constraint if exists miembros_pkey;
alter table public.miembros add constraint miembros_pkey primary key (user_id, grupo);

alter table public.invitaciones drop constraint if exists invitaciones_grupo_check;
alter table public.invitaciones add constraint invitaciones_grupo_check check (grupo in ('familia', 'amigos', 'otros'));
insert into public.invitaciones (grupo, codigo) values ('otros', encode(gen_random_bytes(6), 'hex')) on conflict do nothing;

-- sus grupos separados por comas (null = sin acceso)
create or replace function public._grupo_de(p_uid uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select string_agg(grupo, ',' order by case grupo when 'familia' then 1 when 'amigos' then 2 else 3 end)
  from public.miembros where user_id = p_uid;
$$;

create or replace function public._puede_ver(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_uid is null
      or p_uid = auth.uid()
      or exists (select 1 from public.admins where user_id = auth.uid())
      or exists (select 1 from public.admins where user_id = p_uid)
      or exists (select 1 from public.miembros a join public.miembros b on a.grupo = b.grupo
                 where a.user_id = auth.uid() and b.user_id = p_uid and a.grupo <> 'otros');
$$;

create or replace function public.unirme(p_codigo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_grupo text; v_nombre text;
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  v_grupo := public._grupo_de(auth.uid());
  if v_grupo is not null then return split_part(v_grupo, ',', 1); end if;
  select grupo into v_grupo from public.invitaciones where codigo = lower(trim(coalesce(p_codigo, '')));
  if v_grupo is null then
    perform pg_sleep(1);
    raise exception 'Ese enlace de invitación ya no vale; pide uno nuevo';
  end if;
  insert into public.miembros (user_id, grupo) values (auth.uid(), v_grupo);
  select coalesce(nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1)) into v_nombre from auth.users u where u.id = auth.uid();
  insert into public.avisos (user_id, texto)
    select a.user_id, left(coalesce(v_nombre, 'Alguien') || ' se ha unido a ' || initcap(v_grupo), 200) from public.admins a;
  return v_grupo;
end $$;

-- el taller pone los grupos de una cuenta (lista vacía = sin acceso)
create or replace function public.admin_grupos(p_clave text, p_user uuid, p_grupos text[]) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  delete from public.miembros where user_id = p_user;
  insert into public.miembros (user_id, grupo)
    select distinct p_user, g from unnest(coalesce(p_grupos, '{}')) g where g in ('familia', 'amigos', 'otros');
end $$;

-- (la de antes: un solo grupo)
create or replace function public.admin_grupo(p_clave text, p_user uuid, p_grupo text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.admin_grupos(p_clave, p_user, case when coalesce(p_grupo, '') = '' then '{}'::text[] else array[p_grupo] end);
end $$;

create or replace function public.admin_nueva_invitacion(p_clave text, p_grupo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text := encode(gen_random_bytes(6), 'hex');
begin
  perform public._exigir_admin(p_clave);
  if p_grupo not in ('familia', 'amigos', 'otros') then raise exception 'Ese grupo no existe'; end if;
  insert into public.invitaciones (grupo, codigo) values (p_grupo, v)
  on conflict (grupo) do update set codigo = excluded.codigo, creado = now();
  return v;
end $$;

create or replace function public.admin_invitaciones(p_clave text) returns table (grupo text, codigo text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  return query select i.grupo, i.codigo from public.invitaciones i
    order by case i.grupo when 'familia' then 1 when 'amigos' then 2 else 3 end;
end $$;

grant execute on function public.admin_grupos(text, uuid, text[]) to anon, authenticated;

-- cada alta nueva te avisa (campana de la web, app Cola 3D y Caudal)
create or replace function public._aviso_alta() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  begin
    insert into public.avisos (user_id, texto)
      select a.user_id, left('Nueva cuenta: ' || coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1))
        || ' (' || coalesce(new.email, '') || '). Dale acceso en Taller → Cuentas', 300)
      from public.admins a;
  exception when others then null;  -- el alta nunca falla por esto
  end;
  return new;
end $$;
drop trigger if exists aviso_alta on auth.users;
create trigger aviso_alta after insert on auth.users for each row execute function public._aviso_alta();

-- las cuentas: grupo = sus grupos separados por comas
create or replace function public.admin_cuentas(p_clave text)
returns table (id uuid, nombre text, email text, alta timestamptz, ultima timestamptz, veces int, confirmada boolean, pedidos int, grupo text, taller boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  return query
    select u.id, coalesce(nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1))::text, u.email::text, u.created_at,
      greatest(a.ultima, u.last_sign_in_at), coalesce(a.veces, case when u.last_sign_in_at is null then 0 else 1 end),
      u.email_confirmed_at is not null, (select count(*)::int from public.pedidos p where p.user_id = u.id),
      public._grupo_de(u.id), exists (select 1 from public.admins ad where ad.user_id = u.id)
    from auth.users u left join public.accesos a on a.user_id = u.id
    order by greatest(a.ultima, u.last_sign_in_at) desc nulls last, u.created_at desc;
end $$;
