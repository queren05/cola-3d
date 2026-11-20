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
alter table public.ajustes add column if not exists gratis_g numeric not null default 50;
alter table public.ajustes add column if not exists pago_minimo numeric not null default 0.5; -- por debajo no se pide pagar: se acumula -- gramos gratis para cada persona (se gastan entre sus pedidos)
insert into public.ajustes (id) values (1) on conflict do nothing;

create table if not exists public.secreto (
  id int primary key default 1 check (id = 1),
  clave_hash text not null
);
-- clave inicial del taller: cámbiala desde la propia web (Taller → Clave del taller)
insert into public.secreto (id, clave_hash) values (1, crypt('cambia-esta-clave', gen_salt('bf'))) on conflict do nothing;
-- claves de ayudantes (p. ej. Claude); bórralas con: delete from public.secreto_extra;
create table if not exists public.secreto_extra (
  quien text primary key,
  clave_hash text not null
);
alter table public.secreto_extra enable row level security;

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
  descontado boolean not null default false,    -- si ya se restó del stock
  prioridad int not null default 0,             -- más alto = antes en la cola
  fotos jsonb not null default '[]'             -- fotos de cómo ha quedado
);
alter table public.pedidos add column if not exists prioridad int not null default 0;
alter table public.pedidos add column if not exists fotos jsonb not null default '[]';
-- más de 4 colores no caben a la vez en la impresora: llega como petición y el taller decide
alter table public.pedidos add column if not exists peticion boolean not null default false;
-- el taller deja que se imprima sin pagar todavía: se suma a lo que debe esa persona
alter table public.pedidos add column if not exists acumulado boolean not null default false;

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
  -- las líneas que van al mismo rollo (o, sin rollo, al mismo color) se juntan: cuentan como un solo color
  select coalesce(jsonb_agg(jsonb_build_object('filamento_id', fid, 'nombre', nombre, 'color', color, 'gramos', least(5000, gramos)) order by orden), '[]'::jsonb)
  from (
    select min(nullif(e->>'filamento_id', '')) fid, min(left(coalesce(e->>'nombre', ''), 40)) nombre, min(left(coalesce(e->>'color', ''), 9)) color,
      sum(greatest(0, coalesce((e->>'gramos')::numeric, 0))) gramos, min(n) orden
    from (select e, n from jsonb_array_elements(coalesce(p, '[]'::jsonb)) with ordinality as t(e, n) limit 16) s
    group by coalesce(nullif(e->>'filamento_id', ''), 'c:' || lower(coalesce(e->>'color', '')))
  ) x;
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
  -- cada color de más purga hilo en cada cambio: 2 colores +10 %, 3 colores +20 %… (máximo 50 %)
  if colores > 1 then merma_pct := least(50, a.merma_pct * (colores - 1)); end if;
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
      or exists (select 1 from public.secreto_extra where clave_hash = crypt(coalesce(p_clave, ''), clave_hash))
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
-- gramos gratis que le quedan a una persona (su cuenta o, sin cuenta, su nombre); lo cancelado no cuenta
create or replace function public._gratis_restante(p_uid uuid, p_nombre text, p_excluir uuid) returns numeric
language sql stable security definer set search_path = public, extensions as $$
  select greatest(0, coalesce((select gratis_g from public.ajustes where id = 1), 50) - coalesce(sum((coste_detalle->>'gratis_g')::numeric), 0))
  from public.pedidos
  where estado <> 'cancelado' and id is distinct from p_excluir
    and ((p_uid is not null and user_id = p_uid) or (p_uid is null and user_id is null and lower(trim(nombre)) = lower(trim(p_nombre))));
$$;

-- descuenta el filamento (y su purga) de los gramos gratis; la luz se cobra igual
create or replace function public._aplicar_gratis(p_det jsonb, p_restante numeric) returns jsonb
language plpgsql immutable set search_path = public, extensions as $$
declare
  g numeric := coalesce((p_det->>'gramos')::numeric, 0);
  libre numeric := least(g, greatest(0, coalesce(p_restante, 0)));
  descuento numeric := 0;
begin
  if g > 0 and libre > 0 then
    descuento := round(((p_det->>'filamento')::numeric + (p_det->>'merma')::numeric) * libre / g, 2);
  end if;
  return p_det || jsonb_build_object('gratis_g', round(libre, 1), 'descuento', descuento,
    'total', greatest(0, round((p_det->>'total')::numeric - descuento, 2)));
end $$;

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
  v_colores int;
  v_det jsonb; v_id uuid; v_tok text := encode(gen_random_bytes(18), 'hex');
begin
  if v_uid is not null then
    select coalesce(nullif(left(trim(raw_user_meta_data->>'nombre'), 40), ''), v_nombre) into v_nombre from auth.users where id = v_uid;
  end if;
  if v_nombre = '' then raise exception 'Falta tu nombre'; end if;
  -- «pedir igual»: se copia una pieza de la vitrina tal cual (modelo, perfil, colores y tiempo)
  if nullif(p->>'copia_de', '') is not null then
    select * into v_src from public.pedidos where id::text = p->>'copia_de' and estado in ('impreso', 'entregado');
    if not found then raise exception 'Esa pieza ya no está en la vitrina'; end if;
    v_url := v_src.url; v_lineas := v_src.lineas; v_min := v_src.minutos; v_titulo := v_src.titulo; v_imagen := v_src.imagen;
    if v_imagen = '' and jsonb_array_length(v_src.fotos) > 0 then v_imagen := v_src.fotos->>0; end if;
  elsif v_url !~* '^https?://([a-z0-9-]+\.)*makerworld\.com(\.cn)?/' then
    raise exception 'Solo modelos de MakerWorld con perfil de impresión';
  end if;
  v_det := public._coste(v_lineas, v_min, v_cop);
  if (v_det->>'gramos')::numeric <= 0 and v_src.id is null then raise exception 'Faltan los gramos'; end if;
  v_det := public._aplicar_gratis(v_det, public._gratis_restante(v_uid, v_nombre, null));
  select count(*) into v_colores from jsonb_array_elements(v_lineas) e where coalesce((e->>'gramos')::numeric, 0) > 0;
  insert into public.pedidos (nombre, user_id, url, titulo, imagen, lineas, minutos, copias, notas, coste, coste_detalle, historial, peticion)
  values (v_nombre, v_uid, v_url, v_titulo, v_imagen, v_lineas, v_min, v_cop,
    left(coalesce(p->>'notas', ''), 600), (v_det->>'total')::numeric, v_det, jsonb_build_array(jsonb_build_object('estado', 'pendiente', 'fecha', now())), v_colores > 4)
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
  hecho boolean; v_estado text; v_det jsonb; v_g numeric;
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
  if p ? 'fotos' and jsonb_typeof(p->'fotos') = 'array' then
    r.fotos := coalesce((select jsonb_agg(left(x, 600)) from (select jsonb_array_elements_text(p->'fotos') x limit 12) t where x like 'https://%'), '[]'::jsonb);
  end if;
  if p ? 'acumulado' then r.acumulado := (p->>'acumulado')::boolean; end if;
  if p ? 'peticion' then r.peticion := (p->>'peticion')::boolean; end if;
  if p ? 'prioridad' then r.prioridad := greatest(0, (p->>'prioridad')::int); end if;
  if cambia then
    if coalesce((r.coste_detalle->>'taller')::boolean, false) then
      -- pieza del taller: no se cobra, solo cambian los gramos
      select coalesce(sum((e->>'gramos')::numeric), 0) * r.copias into v_g from jsonb_array_elements(r.lineas) e;
      v_det := r.coste_detalle || jsonb_build_object('gramos', v_g, 'merma_pct', 0);
    else
      v_det := public._aplicar_gratis(public._coste(r.lineas, r.minutos, r.copias), public._gratis_restante(r.user_id, r.nombre, r.id));
    end if;
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
    historial = r.historial, descontado = r.descontado, prioridad = r.prioridad, fotos = r.fotos, peticion = r.peticion, acumulado = r.acumulado, actualizado = now()
  where id = p_id;
end $$;

-- el taller sube a la vitrina algo que ha impreso por su cuenta: sin enlace, sin cobro, para quien quiera
create or replace function public.admin_crear_pieza(p_clave text, p jsonb) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_lineas jsonb := public._lineas(p->'lineas');
  v_cop int := least(50, greatest(1, coalesce((p->>'copias')::int, 1)));
  v_min int := least(10000, greatest(0, coalesce((p->>'minutos')::int, 0)));
  v_titulo text := left(trim(coalesce(p->>'titulo', '')), 120);
  v_nombre text := left(trim(coalesce(p->>'nombre', '')), 40);
  v_estado text := case when p->>'estado' = 'entregado' then 'entregado' else 'impreso' end;
  v_url text := left(trim(coalesce(p->>'url', '')), 500);
  v_g numeric;
  v_det jsonb; v_id uuid; v_fotos jsonb; v_uid uuid;
begin
  perform public._exigir_admin(p_clave);
  if v_titulo = '' then raise exception 'Ponle un nombre a la pieza'; end if;
  -- si es para alguien con cuenta, la pieza queda en su cuenta
  if nullif(p->>'user_id', '') is not null then
    select u.id, coalesce(nullif(v_nombre, ''), nullif(left(trim(u.raw_user_meta_data->>'nombre'), 40), ''), split_part(u.email, '@', 1))
      into v_uid, v_nombre from auth.users u where u.id::text = p->>'user_id';
  end if;
  if v_nombre = '' then v_nombre := 'Taller'; end if;
  if v_url !~* '^https?://' then v_url := ''; end if;
  v_fotos := coalesce((select jsonb_agg(left(x, 600)) from (select jsonb_array_elements_text(coalesce(p->'fotos', '[]'::jsonb)) x limit 12) t where x like 'https://%'), '[]'::jsonb);
  select coalesce(sum((e->>'gramos')::numeric), 0) * v_cop into v_g from jsonb_array_elements(v_lineas) e;
  v_det := jsonb_build_object('filamento', 0, 'merma', 0, 'merma_pct', 0, 'luz', 0, 'gramos', v_g, 'total', 0, 'lineas', '[]'::jsonb, 'taller', true);
  insert into public.pedidos (nombre, user_id, url, titulo, imagen, lineas, minutos, copias, notas, estado, pagado, coste, coste_detalle, historial, descontado, fotos)
  values (v_nombre, v_uid, v_url, v_titulo, '', v_lineas, v_min, v_cop, left(coalesce(p->>'notas', ''), 600), v_estado, true, 0, v_det,
    jsonb_build_array(jsonb_build_object('estado', v_estado, 'fecha', now())), true, v_fotos)
  returning id into v_id;
  -- lo gastado sale de los rollos
  perform public._stock(v_lineas, v_cop, 0, -1);
  return v_id;
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
    bizum = left(trim(coalesce(a->>'bizum', bizum)), 30),
    gratis_g = greatest(0, coalesce((a->>'gratis_g')::numeric, gratis_g)),
    pago_minimo = greatest(0, coalesce((a->>'pago_minimo')::numeric, pago_minimo))
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
  public._es_admin(text), public._exigir_admin(text), public._gratis_restante(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.crear_pedido(jsonb), public.cancelar_pedido(uuid, text), public.comprobar_clave(text), public.soy_admin(),
  public.admin_pedido(text, uuid, jsonb), public.admin_borrar_pedido(text, uuid), public.admin_filamento(text, jsonb),
  public.admin_borrar_filamento(text, uuid), public.admin_ajustes(text, jsonb), public.admin_cambiar_clave(text, text),
  public.admin_crear_pieza(text, jsonb) to anon, authenticated;

-- ---------- tiempo real (la cola se actualiza sola en todos los móviles) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.pedidos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.filamentos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.ajustes; exception when others then null; end;
end $$;

-- ---------- fotos de cómo han quedado (Storage) ----------
-- todos las ven; solo la cuenta del taller (tabla admins) las sube o las borra
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true) on conflict (id) do nothing;
drop policy if exists "fotos taller sube" on storage.objects;
drop policy if exists "fotos taller borra" on storage.objects;
create policy "fotos taller sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and exists (select 1 from public.admins where user_id = auth.uid()));
create policy "fotos taller borra" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and exists (select 1 from public.admins where user_id = auth.uid()));

-- ---------- quién entra (solo lo ve el taller) ----------
create table if not exists public.accesos (
  user_id uuid primary key references auth.users on delete cascade,
  ultima timestamptz not null default now(),
  veces int not null default 1
);
alter table public.accesos enable row level security;

-- la web y la app lo llaman al abrir con la sesión iniciada (cuenta una visita cada 30 min como mucho)
create or replace function public.marcar_visita() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.accesos (user_id) values (auth.uid())
  on conflict (user_id) do update set
    veces = public.accesos.veces + case when public.accesos.ultima < now() - interval '30 minutes' then 1 else 0 end,
    ultima = now();
end $$;

create or replace function public.admin_cuentas(p_clave text)
returns table (id uuid, nombre text, email text, alta timestamptz, ultima timestamptz, veces int, confirmada boolean, pedidos int)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public._exigir_admin(p_clave);
  return query
    select u.id, coalesce(nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1))::text, u.email::text, u.created_at,
      greatest(a.ultima, u.last_sign_in_at), coalesce(a.veces, case when u.last_sign_in_at is null then 0 else 1 end),
      u.email_confirmed_at is not null, (select count(*)::int from public.pedidos p where p.user_id = u.id)
    from auth.users u left join public.accesos a on a.user_id = u.id
    order by greatest(a.ultima, u.last_sign_in_at) desc nulls last, u.created_at desc;
end $$;

grant execute on function public.marcar_visita(), public.admin_cuentas(text) to anon, authenticated;

-- ---------- me gusta y guardados (vitrina) ----------
create table if not exists public.votos (
  pedido_id uuid not null references public.pedidos on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  creado timestamptz not null default now(),
  primary key (pedido_id, user_id)
);
create table if not exists public.guardados (
  pedido_id uuid not null references public.pedidos on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  creado timestamptz not null default now(),
  primary key (pedido_id, user_id)
);
alter table public.votos enable row level security;
alter table public.guardados enable row level security;
drop policy if exists leer on public.votos;
create policy leer on public.votos for select using (true);
drop policy if exists propios on public.guardados;
create policy propios on public.guardados for select using (user_id = auth.uid());
grant select on public.votos, public.guardados to anon, authenticated;

-- devuelven cómo queda: true = ahora te gusta / lo tienes guardado
create or replace function public.votar(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta para votar'; end if;
  delete from public.votos where pedido_id = p_id and user_id = auth.uid();
  if found then return false; end if;
  insert into public.votos (pedido_id, user_id) values (p_id, auth.uid());
  return true;
end $$;

create or replace function public.guardar(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta para guardar'; end if;
  delete from public.guardados where pedido_id = p_id and user_id = auth.uid();
  if found then return false; end if;
  insert into public.guardados (pedido_id, user_id) values (p_id, auth.uid());
  return true;
end $$;

grant execute on function public.votar(uuid), public.guardar(uuid) to authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.votos; exception when others then null; end;
end $$;

-- ---------- perfiles: foto y nombre que ven todos ----------
create table if not exists public.perfiles (
  user_id uuid primary key references auth.users on delete cascade,
  nombre text not null default '',
  avatar text not null default '',
  actualizado timestamptz not null default now()
);
alter table public.perfiles enable row level security;
drop policy if exists leer on public.perfiles;
create policy leer on public.perfiles for select using (true);
grant select on public.perfiles to anon, authenticated;

-- cambia tu nombre (también en tus pedidos y en tu cuenta) y tu foto
create or replace function public.guardar_perfil(p_nombre text, p_avatar text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_nombre text := left(trim(coalesce(p_nombre, '')), 40); v_avatar text := left(trim(coalesce(p_avatar, '')), 600);
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  if v_nombre = '' then raise exception 'Pon un nombre'; end if;
  if v_avatar <> '' and v_avatar not like 'https://%' then v_avatar := ''; end if;
  insert into public.perfiles (user_id, nombre, avatar, actualizado) values (auth.uid(), v_nombre, v_avatar, now())
  on conflict (user_id) do update set nombre = excluded.nombre, avatar = excluded.avatar, actualizado = now();
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nombre', v_nombre) where id = auth.uid();
  update public.pedidos set nombre = v_nombre where user_id = auth.uid() and nombre <> v_nombre;
end $$;
grant execute on function public.guardar_perfil(text, text) to authenticated;

-- fotos de perfil: cada uno sube las suyas en su carpeta
insert into storage.buckets (id, name, public) values ('avatares', 'avatares', true) on conflict (id) do nothing;
drop policy if exists "avatar propio sube" on storage.objects;
drop policy if exists "avatar propio borra" on storage.objects;
create policy "avatar propio sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar propio borra" on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- listas de guardados ----------
alter table public.guardados add column if not exists lista text not null default 'Guardados';
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'guardados_pkey'
             and array_length(conkey, 1) = 2) then
    alter table public.guardados drop constraint guardados_pkey;
    alter table public.guardados add constraint guardados_pkey primary key (pedido_id, user_id, lista);
  end if;
end $$;

-- mete o saca una pieza de una lista; devuelve true si ahora está
create or replace function public.guardar_en(p_id uuid, p_lista text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_lista text := left(trim(coalesce(nullif(p_lista, ''), 'Guardados')), 40);
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta para guardar'; end if;
  delete from public.guardados where pedido_id = p_id and user_id = auth.uid() and lista = v_lista;
  if found then return false; end if;
  insert into public.guardados (pedido_id, user_id, lista) values (p_id, auth.uid(), v_lista);
  return true;
end $$;

create or replace function public.renombrar_lista(p_lista text, p_nueva text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_nueva text := left(trim(coalesce(p_nueva, '')), 40);
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  if v_nueva = '' then raise exception 'Pon un nombre a la lista'; end if;
  -- si ya existe la de destino, se juntan
  insert into public.guardados (pedido_id, user_id, lista, creado)
    select pedido_id, user_id, v_nueva, creado from public.guardados where user_id = auth.uid() and lista = p_lista
  on conflict do nothing;
  delete from public.guardados where user_id = auth.uid() and lista = p_lista and p_lista <> v_nueva;
end $$;

create or replace function public.borrar_lista(p_lista text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  delete from public.guardados where user_id = auth.uid() and lista = p_lista;
end $$;

-- guardar(p_id) de antes: la lista «Guardados»
create or replace function public.guardar(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public.guardar_en(p_id, 'Guardados');
end $$;

grant execute on function public.guardar_en(uuid, text), public.renombrar_lista(text, text), public.borrar_lista(text) to authenticated;

-- el taller cambia el nombre de una cuenta (en la cuenta, su perfil y sus pedidos)
create or replace function public.admin_renombrar(p_clave text, p_user uuid, p_nombre text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v text := left(trim(coalesce(p_nombre, '')), 40);
begin
  perform public._exigir_admin(p_clave);
  if v = '' then raise exception 'Pon un nombre'; end if;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nombre', v) where id = p_user;
  if not found then raise exception 'Esa cuenta no existe'; end if;
  insert into public.perfiles (user_id, nombre) values (p_user, v)
  on conflict (user_id) do update set nombre = excluded.nombre, actualizado = now();
  update public.pedidos set nombre = v where user_id = p_user;
end $$;
grant execute on function public.admin_renombrar(text, uuid, text) to anon, authenticated;
