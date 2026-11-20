-- ---------- grupos: familia y amigos (cada uno solo ve lo suyo) ----------
-- Quien se hace cuenta no puede pedir ni ver nada hasta que entra con un enlace de invitación
-- o el taller le mete en un grupo. Los de un grupo no ven pedidos, nombres ni comentarios del otro.
-- Las piezas del taller (las tuyas o sin dueño) las ven todos.

create table if not exists public.miembros (
  user_id uuid primary key references auth.users on delete cascade,
  grupo text not null check (grupo in ('familia', 'amigos')),
  desde timestamptz not null default now()
);
alter table public.miembros enable row level security;
drop policy if exists propio on public.miembros;
create policy propio on public.miembros for select using (user_id = auth.uid());
grant select on public.miembros to authenticated;

-- un enlace de invitación por grupo (se puede cambiar si se ha pasado a quien no debía)
create table if not exists public.invitaciones (
  grupo text primary key check (grupo in ('familia', 'amigos')),
  codigo text not null unique,
  creado timestamptz not null default now()
);
alter table public.invitaciones enable row level security;
insert into public.invitaciones (grupo, codigo) values
  ('familia', encode(gen_random_bytes(6), 'hex')), ('amigos', encode(gen_random_bytes(6), 'hex'))
on conflict do nothing;

-- límites contra abusos (0 = sin límite)
alter table public.ajustes add column if not exists limite_mes_g numeric not null default 500;  -- gramos por persona y mes; si se pasa, llega como petición
alter table public.ajustes add column if not exists max_pendientes int not null default 5;      -- pedidos esperando a la vez por persona

create or replace function public._soy_taller() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._grupo_de(p_uid uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select grupo from public.miembros where user_id = p_uid;
$$;

-- ¿puedo ver lo de esta cuenta? el taller todo; los demás lo suyo, lo de su grupo y lo del taller
create or replace function public._puede_ver(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_uid is null
      or p_uid = auth.uid()
      or exists (select 1 from public.admins where user_id = auth.uid())
      or exists (select 1 from public.admins where user_id = p_uid)
      or exists (select 1 from public.miembros a join public.miembros b on a.grupo = b.grupo
                 where a.user_id = auth.uid() and b.user_id = p_uid);
$$;

drop policy if exists leer on public.pedidos;
create policy leer on public.pedidos for select using (public._puede_ver(user_id));
drop policy if exists leer on public.perfiles;
create policy leer on public.perfiles for select using (public._puede_ver(user_id));
drop policy if exists leer on public.votos;
create policy leer on public.votos for select using (public._puede_ver(user_id) and exists (select 1 from public.pedidos p where p.id = pedido_id));
drop policy if exists leer on public.comentarios;
create policy leer on public.comentarios for select using (public._puede_ver(user_id) and exists (select 1 from public.pedidos p where p.id = pedido_id));

-- lo que necesita saber la web de ti: tu grupo y cuánto llevas este mes
create or replace function public.mi_acceso() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'taller', public._soy_taller(),
    'grupo', public._grupo_de(auth.uid()),
    'limite_mes_g', (select limite_mes_g from public.ajustes where id = 1),
    'max_pendientes', (select max_pendientes from public.ajustes where id = 1),
    'usado_mes_g', coalesce((select sum((coste_detalle->>'gramos')::numeric) from public.pedidos
      where user_id = auth.uid() and estado <> 'cancelado' and not peticion and creado >= date_trunc('month', now())), 0));
$$;
grant execute on function public.mi_acceso() to anon, authenticated;

-- entrar en un grupo con el código del enlace (si ya estás en uno, no te cambia: eso solo lo hace el taller)
create or replace function public.unirme(p_codigo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_grupo text; v_nombre text;
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  v_grupo := public._grupo_de(auth.uid());
  if v_grupo is not null then return v_grupo; end if;
  select grupo into v_grupo from public.invitaciones where codigo = lower(trim(coalesce(p_codigo, '')));
  if v_grupo is null then
    perform pg_sleep(1);
    raise exception 'Ese enlace de invitación ya no vale; pide uno nuevo';
  end if;
  insert into public.miembros (user_id, grupo) values (auth.uid(), v_grupo);
  select coalesce(nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1)) into v_nombre from auth.users u where u.id = auth.uid();
  insert into public.avisos (user_id, texto)
    select a.user_id, left(coalesce(v_nombre, 'Alguien') || ' se ha unido a ' || case v_grupo when 'familia' then 'Familia' else 'Amigos' end, 200)
    from public.admins a;
  return v_grupo;
end $$;
grant execute on function public.unirme(text) to authenticated;

-- el taller mete a alguien en un grupo, le cambia o le quita el acceso ('' = sin acceso)
create or replace function public.admin_grupo(p_clave text, p_user uuid, p_grupo text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  if coalesce(p_grupo, '') = '' then
    delete from public.miembros where user_id = p_user;
  elsif p_grupo in ('familia', 'amigos') then
    insert into public.miembros (user_id, grupo) values (p_user, p_grupo)
    on conflict (user_id) do update set grupo = excluded.grupo;
  else
    raise exception 'Ese grupo no existe';
  end if;
end $$;

create or replace function public.admin_invitaciones(p_clave text) returns table (grupo text, codigo text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  return query select i.grupo, i.codigo from public.invitaciones i order by i.grupo desc;
end $$;

-- enlace nuevo para un grupo: el de antes deja de valer (los que ya entraron siguen dentro)
create or replace function public.admin_nueva_invitacion(p_clave text, p_grupo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text := encode(gen_random_bytes(6), 'hex');
begin
  perform public._exigir_admin(p_clave);
  if p_grupo not in ('familia', 'amigos') then raise exception 'Ese grupo no existe'; end if;
  insert into public.invitaciones (grupo, codigo) values (p_grupo, v)
  on conflict (grupo) do update set codigo = excluded.codigo, creado = now();
  return v;
end $$;

-- todos los pedidos, para Caudal (que entra con la clave del taller, sin cuenta)
create or replace function public.admin_pedidos(p_clave text) returns setof public.pedidos
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  return query select * from public.pedidos order by creado desc;
end $$;

grant execute on function public.admin_grupo(text, uuid, text), public.admin_invitaciones(text),
  public.admin_nueva_invitacion(text, text), public.admin_pedidos(text) to anon, authenticated;

-- las cuentas, ahora con su grupo
drop function if exists public.admin_cuentas(text);
create or replace function public.admin_cuentas(p_clave text)
returns table (id uuid, nombre text, email text, alta timestamptz, ultima timestamptz, veces int, confirmada boolean, pedidos int, grupo text, taller boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  return query
    select u.id, coalesce(nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1))::text, u.email::text, u.created_at,
      greatest(a.ultima, u.last_sign_in_at), coalesce(a.veces, case when u.last_sign_in_at is null then 0 else 1 end),
      u.email_confirmed_at is not null, (select count(*)::int from public.pedidos p where p.user_id = u.id),
      m.grupo, exists (select 1 from public.admins ad where ad.user_id = u.id)
    from auth.users u left join public.accesos a on a.user_id = u.id left join public.miembros m on m.user_id = u.id
    order by greatest(a.ultima, u.last_sign_in_at) desc nulls last, u.created_at desc;
end $$;
grant execute on function public.admin_cuentas(text) to anon, authenticated;

create or replace function public.admin_ajustes(p_clave text, a jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  update public.ajustes set
    precio_defecto = greatest(0, coalesce((a->>'precio_defecto')::numeric, precio_defecto)),
    peso_defecto = greatest(1, coalesce((a->>'peso_defecto')::int, peso_defecto)),
    luz_hora = greatest(0, coalesce((a->>'luz_hora')::numeric, luz_hora)),
    merma_pct = greatest(0, coalesce((a->>'merma_pct')::numeric, merma_pct)),
    bizum = left(trim(coalesce(a->>'bizum', bizum)), 30),
    gratis_g = greatest(0, coalesce((a->>'gratis_g')::numeric, gratis_g)),
    pago_minimo = greatest(0, coalesce((a->>'pago_minimo')::numeric, pago_minimo)),
    coste_real_kg = greatest(0, coalesce((a->>'coste_real_kg')::numeric, coste_real_kg)),
    limite_mes_g = greatest(0, coalesce((a->>'limite_mes_g')::numeric, limite_mes_g)),
    max_pendientes = least(50, greatest(0, coalesce((a->>'max_pendientes')::int, max_pendientes)))
  where id = 1;
end $$;

-- pedir: hace falta estar en un grupo; con muchos pedidos esperando no deja, y si te pasas
-- de los gramos del mes llega como petición (el taller decide)
create or replace function public.crear_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text := left(trim(coalesce(p->>'nombre', '')), 40);
  v_url text := left(trim(coalesce(p->>'url', '')), 500);
  v_lineas jsonb := public._lineas(p->'lineas');
  v_cop int := least(50, greatest(1, coalesce((p->>'copias')::int, 1)));
  v_min int := least(10000, greatest(0, coalesce((p->>'minutos')::int, 0)));
  v_titulo text := left(coalesce(p->>'titulo', ''), 120);
  v_imagen text := left(coalesce(p->>'imagen', ''), 600);
  v_src public.pedidos;
  v_aj public.ajustes;
  v_taller boolean;
  v_colores int; v_usado numeric; v_motivo text;
  v_det jsonb; v_id uuid; v_tok text := encode(gen_random_bytes(18), 'hex');
begin
  if v_uid is null then raise exception 'Entra con tu cuenta para pedir'; end if;
  v_taller := exists (select 1 from public.admins where user_id = v_uid);
  if not v_taller and public._grupo_de(v_uid) is null then
    raise exception 'Aún no tienes acceso: pide el enlace de invitación';
  end if;
  select * into v_aj from public.ajustes where id = 1;
  if not v_taller and coalesce(v_aj.max_pendientes, 0) > 0
     and (select count(*) from public.pedidos where user_id = v_uid and estado = 'pendiente') >= v_aj.max_pendientes then
    raise exception 'Ya tienes % pedidos esperando; espera a que salgan algunos', v_aj.max_pendientes;
  end if;
  select coalesce(nullif(left(trim(raw_user_meta_data->>'nombre'), 40), ''), v_nombre) into v_nombre from auth.users where id = v_uid;
  if v_nombre = '' then raise exception 'Falta tu nombre'; end if;
  -- «pedir igual»: se copia una pieza de la vitrina tal cual (solo las que puedes ver)
  if nullif(p->>'copia_de', '') is not null then
    select * into v_src from public.pedidos where id::text = p->>'copia_de' and estado in ('impreso', 'entregado');
    if not found or not public._puede_ver(v_src.user_id) then raise exception 'Esa pieza ya no está en la vitrina'; end if;
    v_url := v_src.url; v_lineas := v_src.lineas; v_min := v_src.minutos; v_titulo := v_src.titulo; v_imagen := v_src.imagen;
    if v_imagen = '' and jsonb_array_length(v_src.fotos) > 0 then v_imagen := v_src.fotos->>0; end if;
  elsif v_url !~* '^https?://([a-z0-9-]+\.)*makerworld\.com(\.cn)?/' then
    raise exception 'Solo modelos de MakerWorld con perfil de impresión';
  end if;
  v_det := public._coste(v_lineas, v_min, v_cop);
  if (v_det->>'gramos')::numeric <= 0 and v_src.id is null then raise exception 'Faltan los gramos'; end if;
  v_det := public._aplicar_gratis(v_det, public._gratis_restante(v_uid, v_nombre, null));
  select count(*) into v_colores from jsonb_array_elements(v_lineas) e where coalesce((e->>'gramos')::numeric, 0) > 0;
  if v_colores > 4 then v_motivo := 'colores'; end if;
  if v_motivo is null and not v_taller and coalesce(v_aj.limite_mes_g, 0) > 0 then
    select coalesce(sum((coste_detalle->>'gramos')::numeric), 0) into v_usado from public.pedidos
    where user_id = v_uid and estado <> 'cancelado' and not peticion and creado >= date_trunc('month', now());
    if v_usado + (v_det->>'gramos')::numeric > v_aj.limite_mes_g then v_motivo := 'limite'; end if;
  end if;
  if v_motivo is not null then v_det := v_det || jsonb_build_object('motivo', v_motivo); end if;
  insert into public.pedidos (nombre, user_id, url, titulo, imagen, lineas, minutos, copias, notas, coste, coste_detalle, historial, peticion)
  values (v_nombre, v_uid, v_url, v_titulo, v_imagen, v_lineas, v_min, v_cop,
    left(coalesce(p->>'notas', ''), 600), (v_det->>'total')::numeric, v_det, jsonb_build_array(jsonb_build_object('estado', 'pendiente', 'fecha', now())), v_motivo is not null)
  returning id into v_id;
  insert into public.pedido_tokens values (v_id, v_tok);
  return jsonb_build_object('id', v_id, 'token', v_tok, 'peticion', v_motivo);
end $$;

-- votar, guardar y comentar solo en lo que puedes ver
create or replace function public.votar(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta para votar'; end if;
  if not exists (select 1 from public.pedidos where id = p_id and public._puede_ver(user_id)) then raise exception 'Esa pieza ya no está'; end if;
  delete from public.votos where pedido_id = p_id and user_id = auth.uid();
  if found then return false; end if;
  insert into public.votos (pedido_id, user_id) values (p_id, auth.uid());
  return true;
end $$;

create or replace function public.guardar_en(p_id uuid, p_lista text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_lista text := left(trim(coalesce(nullif(p_lista, ''), 'Guardados')), 40);
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta para guardar'; end if;
  delete from public.guardados where pedido_id = p_id and user_id = auth.uid() and lista = v_lista;
  if found then return false; end if;
  if not exists (select 1 from public.pedidos where id = p_id and public._puede_ver(user_id)) then raise exception 'Esa pieza ya no está'; end if;
  insert into public.guardados (pedido_id, user_id, lista) values (p_id, auth.uid(), v_lista);
  return true;
end $$;

create or replace function public.comentar(p_id uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v text := left(trim(coalesce(p_texto, '')), 500); v_nombre text; v_dueno uuid; v_titulo text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta para comentar'; end if;
  if v = '' then raise exception 'Escribe algo'; end if;
  if (select count(*) from public.comentarios where user_id = auth.uid() and creado > now() - interval '1 hour') >= 30 then
    raise exception 'Muchos comentarios seguidos, espera un poco';
  end if;
  select user_id, titulo into v_dueno, v_titulo from public.pedidos where id = p_id;
  if not found or not public._puede_ver(v_dueno) then raise exception 'Esa pieza ya no está'; end if;
  select coalesce(nullif(p.nombre, ''), nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1)) into v_nombre
  from auth.users u left join public.perfiles p on p.user_id = u.id where u.id = auth.uid();
  insert into public.comentarios (pedido_id, user_id, nombre, texto) values (p_id, auth.uid(), left(coalesce(v_nombre, ''), 40), v) returning id into v_id;
  if v_dueno is not null and v_dueno <> auth.uid() then
    insert into public.avisos (user_id, pedido_id, texto) values (v_dueno, p_id, left(coalesce(v_nombre, 'Alguien') || ' ha comentado «' || coalesce(nullif(v_titulo, ''), 'tu pieza') || '»: ' || v, 300));
  end if;
  return v_id;
end $$;

do $$
begin
  begin alter publication supabase_realtime add table public.miembros; exception when others then null; end;
end $$;
