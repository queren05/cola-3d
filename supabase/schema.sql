-- Cola 3D · base de datos para Supabase
-- Pégalo entero en Supabase → SQL Editor → Run. Se puede volver a ejecutar sin perder datos.
-- La web solo LEE las tablas; todo lo que escribe pasa por las funciones de abajo,
-- que comprueban la clave del taller y calculan el coste en el servidor.

create extension if not exists pgcrypto;

-- ---------- tablas ----------
create table if not exists public.ajustes (
  id int primary key default 1 check (id = 1),
  precio_defecto numeric not null default 17.99, -- € por rollo cuando el filamento no tiene precio propio
  peso_defecto int not null default 1000,       -- gramos por rollo
  luz_hora numeric not null default 0.10,       -- € de luz y desgaste por hora de impresión
  merma_pct numeric not null default 10,        -- % extra por purga cuando hay varios colores
  bizum text not null default ''                 -- teléfono para pagar por Bizum
);
alter table public.ajustes add column if not exists bizum text not null default '';
insert into public.ajustes (id) values (1) on conflict do nothing;

create table if not exists public.secreto (
  id int primary key default 1 check (id = 1),
  clave_hash text not null
);
-- clave inicial del taller: cámbiala desde la propia web (Taller → Clave del taller)
insert into public.secreto (id, clave_hash) values (1, crypt('cambia-esta-clave', gen_salt('bf'))) on conflict do nothing;

-- para el modo con cuentas: quién es administrador (insert into admins values ('<id del usuario>'))
create table if not exists public.admins (user_id uuid primary key references auth.users on delete cascade);

create table if not exists public.filamentos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  material text not null default 'PLA',
  color text not null default '#cccccc',
  precio numeric,                               -- null = el precio por defecto
  peso int not null default 1000,
  stock_g numeric not null default 1000,
  activo boolean not null default true,
  orden int not null default 0,
  creado timestamptz not null default now()
);

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  nombre text not null,
  user_id uuid references auth.users on delete set null,
  url text not null,
  titulo text not null default '',
  imagen text not null default '',
  lineas jsonb not null default '[]',           -- [{filamento_id, nombre, color, gramos}] gramos por copia
  minutos int not null default 0,
  copias int not null default 1,
  notas text not null default '',
  estado text not null default 'pendiente' check (estado in ('pendiente','imprimiendo','impreso','entregado','cancelado')),
  pagado boolean not null default false,
  coste numeric not null default 0,
  coste_detalle jsonb not null default '{}',
  historial jsonb not null default '[]',        -- [{estado, fecha}]
  descontado boolean not null default false     -- si ya se restó del stock
);

-- quien pide guarda un código para poder cancelar su pedido sin cuenta
create table if not exists public.pedido_tokens (
  pedido_id uuid primary key references public.pedidos on delete cascade,
  token text not null
);

alter table public.ajustes enable row level security;
alter table public.secreto enable row level security;
alter table public.admins enable row level security;
alter table public.filamentos enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedido_tokens enable row level security;

drop policy if exists leer on public.ajustes;
drop policy if exists leer on public.filamentos;
drop policy if exists leer on public.pedidos;
create policy leer on public.ajustes for select using (true);
create policy leer on public.filamentos for select using (true);
create policy leer on public.pedidos for select using (true);
-- secreto, admins y pedido_tokens no tienen políticas: desde la web no se pueden leer.
grant usage on schema public to anon, authenticated;
grant select on public.ajustes, public.filamentos, public.pedidos to anon, authenticated;

-- ---------- utilidades internas ----------
create or replace function public._lineas(p jsonb) returns jsonb
language sql immutable set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'filamento_id', nullif(e->>'filamento_id', ''),
    'nombre', left(coalesce(e->>'nombre', ''), 40),
    'color', left(coalesce(e->>'color', ''), 9),
    'gramos', least(5000, greatest(0, coalesce((e->>'gramos')::numeric, 0)))
  )), '[]'::jsonb)
  from (select e from jsonb_array_elements(coalesce(p, '[]'::jsonb)) as t(e) limit 16) s;
$$;

-- mismo cálculo que src/lib/coste.ts
create or replace function public._coste(p_lineas jsonb, p_minutos int, p_copias int) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  a public.ajustes;
  l jsonb;
  cop int := greatest(1, coalesce(p_copias, 1));
  f_precio numeric; f_peso numeric; f_nombre text; f_color text;
  precio numeric; peso numeric; g numeric; c numeric;
  fil numeric := 0; gtot numeric := 0; colores int := 0;
  merma_pct numeric := 0; merma numeric := 0; luz numeric;
  salida jsonb := '[]'::jsonb;
begin
  select * into a from public.ajustes where id = 1;
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    f_precio := null; f_peso := null; f_nombre := null; f_color := null;
    if nullif(l->>'filamento_id', '') is not null then
      select fi.precio, fi.peso, fi.nombre, fi.color into f_precio, f_peso, f_nombre, f_color
      from public.filamentos fi where fi.id::text = l->>'filamento_id';
    end if;
    precio := coalesce(f_precio, a.precio_defecto);
    peso := coalesce(nullif(f_peso, 0), a.peso_defecto);
    g := greatest(0, coalesce((l->>'gramos')::numeric, 0)) * cop;
    c := g * precio / peso;
    fil := fil + c; gtot := gtot + g;
    if g > 0 then colores := colores + 1; end if;
    salida := salida || jsonb_build_object('nombre', coalesce(f_nombre, l->>'nombre'), 'color', coalesce(f_color, l->>'color'),
      'gramos', g, 'precio', precio, 'peso', peso, 'coste', round(c, 2));
  end loop;
  if colores > 1 then merma_pct := a.merma_pct; end if;
  merma := fil * merma_pct / 100;
  luz := coalesce(p_minutos, 0) / 60.0 * cop * a.luz_hora;
  return jsonb_build_object('filamento', round(fil, 2), 'merma', round(merma, 2), 'merma_pct', merma_pct, 'luz', round(luz, 2),
    'gramos', gtot, 'total', round(fil + merma + luz, 2), 'lineas', salida);
end $$;

-- resta (signo -1) o devuelve (signo 1) al stock lo que gasta un pedido, purga incluida
create or replace function public._stock(p_lineas jsonb, p_copias int, p_merma_pct numeric, p_signo int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare l jsonb; factor numeric := p_signo * (1 + coalesce(p_merma_pct, 0) / 100);
begin
  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    if nullif(l->>'filamento_id', '') is not null then
      update public.filamentos set stock_g = greatest(0, round(stock_g + factor * (l->>'gramos')::numeric * greatest(1, p_copias), 1))
      where id::text = l->>'filamento_id';
    end if;
  end loop;
end $$;

create or replace function public._es_admin(p_clave text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.secreto where id = 1 and clave_hash = crypt(coalesce(p_clave, ''), clave_hash))
      or exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._exigir_admin(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._es_admin(p_clave) then
    perform pg_sleep(1);
    raise exception 'Clave incorrecta';
  end if;
end $$;

-- ---------- funciones públicas ----------
create or replace function public.crear_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text := left(trim(coalesce(p->>'nombre', '')), 40);
  v_url text := left(trim(coalesce(p->>'url', '')), 500);
  v_lineas jsonb := public._lineas(p->'lineas');
  v_cop int := least(50, greatest(1, coalesce((p->>'copias')::int, 1)));
  v_min int := least(10000, greatest(0, coalesce((p->>'minutos')::int, 0)));
  v_det jsonb; v_id uuid; v_tok text := encode(gen_random_bytes(18), 'hex');
begin
  if v_uid is not null then
    select coalesce(nullif(left(trim(raw_user_meta_data->>'nombre'), 40), ''), v_nombre) into v_nombre from auth.users where id = v_uid;
  end if;
  if v_nombre = '' then raise exception 'Falta tu nombre'; end if;
  if v_url !~* '^https?://([a-z0-9-]+\.)*makerworld\.com(\.cn)?/' then raise exception 'Solo modelos de MakerWorld con perfil de impresión'; end if;
  v_det := public._coste(v_lineas, v_min, v_cop);
  if (v_det->>'gramos')::numeric <= 0 then raise exception 'Faltan los gramos'; end if;
  insert into public.pedidos (nombre, user_id, url, titulo, imagen, lineas, minutos, copias, notas, coste, coste_detalle, historial)
  values (v_nombre, v_uid, v_url, left(coalesce(p->>'titulo', ''), 120), left(coalesce(p->>'imagen', ''), 600), v_lineas, v_min, v_cop,
    left(coalesce(p->>'notas', ''), 600), (v_det->>'total')::numeric, v_det, jsonb_build_array(jsonb_build_object('estado', 'pendiente', 'fecha', now())))
  returning id into v_id;
  insert into public.pedido_tokens values (v_id, v_tok);
  return jsonb_build_object('id', v_id, 'token', v_tok);
end $$;

create or replace function public.cancelar_pedido(p_id uuid, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.pedidos set estado = 'cancelado', actualizado = now(),
    historial = historial || jsonb_build_object('estado', 'cancelado', 'fecha', now())
  where id = p_id and estado = 'pendiente'
    and (exists (select 1 from public.pedido_tokens t where t.pedido_id = p_id and t.token = p_token)
         or (user_id is not null and user_id = auth.uid()));
  if not found then raise exception 'Ya no se puede cancelar'; end if;
end $$;

create or replace function public.comprobar_clave(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public._es_admin(p_clave) then return true; end if;
  perform pg_sleep(1);
  return false;
end $$;

create or replace function public.soy_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.admin_pedido(p_clave text, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.pedidos;
  cambia boolean := (p ? 'lineas') or (p ? 'copias') or (p ? 'minutos');
  hecho boolean; v_estado text; v_det jsonb;
begin
  perform public._exigir_admin(p_clave);
  select * into r from public.pedidos where id = p_id for update;
  if not found then raise exception 'Ese pedido ya no existe'; end if;
  if cambia and r.descontado then perform public._stock(r.lineas, r.copias, (r.coste_detalle->>'merma_pct')::numeric, 1); end if;
  if p ? 'lineas' then r.lineas := public._lineas(p->'lineas'); end if;
  if p ? 'copias' then r.copias := least(50, greatest(1, (p->>'copias')::int)); end if;
  if p ? 'minutos' then r.minutos := least(10000, greatest(0, (p->>'minutos')::int)); end if;
  if p ? 'titulo' then r.titulo := left(p->>'titulo', 120); end if;
  if p ? 'imagen' then r.imagen := left(p->>'imagen', 600); end if;
  if p ? 'notas' then r.notas := left(p->>'notas', 600); end if;
  if p ? 'pagado' then r.pagado := (p->>'pagado')::boolean; end if;
  if cambia then
    v_det := public._coste(r.lineas, r.minutos, r.copias);
    r.coste_detalle := v_det; r.coste := (v_det->>'total')::numeric;
    if r.descontado then perform public._stock(r.lineas, r.copias, (v_det->>'merma_pct')::numeric, -1); end if;
  end if;
  if p ? 'estado' and p->>'estado' is distinct from r.estado then
    v_estado := p->>'estado';
    hecho := v_estado in ('impreso', 'entregado');
    if hecho and not r.descontado then
      perform public._stock(r.lineas, r.copias, (r.coste_detalle->>'merma_pct')::numeric, -1); r.descontado := true;
    elsif not hecho and r.descontado then
      perform public._stock(r.lineas, r.copias, (r.coste_detalle->>'merma_pct')::numeric, 1); r.descontado := false;
    end if;
    r.estado := v_estado;
    r.historial := r.historial || jsonb_build_object('estado', v_estado, 'fecha', now());
  end if;
  update public.pedidos set lineas = r.lineas, copias = r.copias, minutos = r.minutos, titulo = r.titulo, imagen = r.imagen,
    notas = r.notas, pagado = r.pagado, coste = r.coste, coste_detalle = r.coste_detalle, estado = r.estado,
    historial = r.historial, descontado = r.descontado, actualizado = now()
  where id = p_id;
end $$;

create or replace function public.admin_borrar_pedido(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  delete from public.pedidos where id = p_id;
end $$;

create or replace function public.admin_filamento(p_clave text, f jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := nullif(f->>'id', '')::uuid; a public.ajustes;
begin
  perform public._exigir_admin(p_clave);
  select * into a from public.ajustes where id = 1;
  if v_id is not null and exists (select 1 from public.filamentos where id = v_id) then
    update public.filamentos set
      nombre = coalesce(left(f->>'nombre', 40), nombre),
      material = coalesce(left(f->>'material', 20), material),
      color = coalesce(left(f->>'color', 9), color),
      precio = case when f ? 'precio' then (f->>'precio')::numeric else precio end,
      peso = coalesce((f->>'peso')::int, peso),
      stock_g = coalesce(greatest(0, (f->>'stock_g')::numeric), stock_g),
      activo = coalesce((f->>'activo')::boolean, activo),
      orden = coalesce((f->>'orden')::int, orden)
    where id = v_id;
  else
    insert into public.filamentos (nombre, material, color, precio, peso, stock_g, activo, orden)
    values (left(coalesce(f->>'nombre', 'Filamento'), 40), left(coalesce(f->>'material', 'PLA'), 20), left(coalesce(f->>'color', '#cccccc'), 9),
      (f->>'precio')::numeric, coalesce((f->>'peso')::int, a.peso_defecto), coalesce((f->>'stock_g')::numeric, a.peso_defecto),
      coalesce((f->>'activo')::boolean, true), coalesce((f->>'orden')::int, 0))
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_borrar_filamento(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  delete from public.filamentos where id = p_id;
end $$;

create or replace function public.admin_ajustes(p_clave text, a jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  update public.ajustes set
    precio_defecto = greatest(0, coalesce((a->>'precio_defecto')::numeric, precio_defecto)),
    peso_defecto = greatest(1, coalesce((a->>'peso_defecto')::int, peso_defecto)),
    luz_hora = greatest(0, coalesce((a->>'luz_hora')::numeric, luz_hora)),
    merma_pct = greatest(0, coalesce((a->>'merma_pct')::numeric, merma_pct)),
    bizum = left(trim(coalesce(a->>'bizum', bizum)), 30)
  where id = 1;
end $$;

create or replace function public.admin_cambiar_clave(p_clave text, p_nueva text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  if length(trim(coalesce(p_nueva, ''))) < 4 then raise exception 'La clave necesita al menos 4 caracteres'; end if;
  update public.secreto set clave_hash = crypt(trim(p_nueva), gen_salt('bf')) where id = 1;
end $$;

-- ---------- permisos ----------
revoke all on function public._lineas(jsonb), public._coste(jsonb, int, int), public._stock(jsonb, int, numeric, int),
  public._es_admin(text), public._exigir_admin(text) from public, anon, authenticated;
grant execute on function public.crear_pedido(jsonb), public.cancelar_pedido(uuid, text), public.comprobar_clave(text), public.soy_admin(),
  public.admin_pedido(text, uuid, jsonb), public.admin_borrar_pedido(text, uuid), public.admin_filamento(text, jsonb),
  public.admin_borrar_filamento(text, uuid), public.admin_ajustes(text, jsonb), public.admin_cambiar_clave(text, text) to anon, authenticated;

-- ---------- tiempo real (la cola se actualiza sola en todos los móviles) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.pedidos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.filamentos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.ajustes; exception when others then null; end;
end $$;
