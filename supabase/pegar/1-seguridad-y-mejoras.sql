-- ===== SEGURIDAD =====

alter table public.ajustes add column if not exists coste_real_kg numeric not null default 12;

-- freno contra probar claves a lo loco: más de 20 fallos en 10 minutos bloquea la clave del taller un rato
create table if not exists public.intentos_clave (ts timestamptz not null default now());
alter table public.intentos_clave enable row level security;

create or replace function public._clave_valida(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- con tu cuenta del taller no hace falta clave
  if exists (select 1 from public.admins where user_id = auth.uid()) then return true; end if;
  if coalesce(p_clave, '') = '' then return false; end if;
  if (select count(*) from public.intentos_clave where ts > now() - interval '10 minutes') > 20 then
    raise exception 'Demasiados intentos con la clave, espera unos minutos';
  end if;
  if public._es_admin(p_clave) then return true; end if;
  insert into public.intentos_clave default values;
  delete from public.intentos_clave where ts < now() - interval '1 day';
  perform pg_sleep(1);
  return false;
end $$;

create or replace function public._exigir_admin(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._clave_valida(p_clave) then
    raise exception 'Clave incorrecta';
  end if;
end $$;

create or replace function public.comprobar_clave(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public._clave_valida(p_clave);
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
  -- solo con cuenta (así nadie puede llenar la cola desde fuera) y sin pasarse de pedidos a la vez
  if v_uid is null then raise exception 'Entra con tu cuenta para pedir'; end if;
  if (select count(*) from public.pedidos where user_id = v_uid and estado = 'pendiente') >= 10 then
    raise exception 'Ya tienes 10 pedidos esperando; espera a que salgan algunos';
  end if;
  select coalesce(nullif(left(trim(raw_user_meta_data->>'nombre'), 40), ''), v_nombre) into v_nombre from auth.users where id = v_uid;
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

create or replace function public.guardar_perfil(p_nombre text, p_avatar text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_nombre text := left(trim(coalesce(p_nombre, '')), 40); v_avatar text := left(trim(coalesce(p_avatar, '')), 600);
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  if v_nombre = '' then raise exception 'Pon un nombre'; end if;
  if lower(v_nombre) in ('taller', 'admin', 'administrador') then raise exception 'Ese nombre no se puede usar'; end if;
  if exists (select 1 from public.perfiles where lower(nombre) = lower(v_nombre) and user_id <> auth.uid())
     or exists (select 1 from auth.users where id <> auth.uid() and lower(raw_user_meta_data->>'nombre') = lower(v_nombre)) then
    raise exception 'Ese nombre ya lo usa otra persona';
  end if;
  -- la foto tiene que ser de la carpeta de fotos de perfil de esta web
  if v_avatar <> '' and v_avatar not like '%/storage/v1/object/public/avatares/' || auth.uid()::text || '/%' then v_avatar := ''; end if;
  insert into public.perfiles (user_id, nombre, avatar, actualizado) values (auth.uid(), v_nombre, v_avatar, now())
  on conflict (user_id) do update set nombre = excluded.nombre, avatar = excluded.avatar, actualizado = now();
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nombre', v_nombre) where id = auth.uid();
  update public.pedidos set nombre = v_nombre where user_id = auth.uid() and nombre <> v_nombre;
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
    pago_minimo = greatest(0, coalesce((a->>'pago_minimo')::numeric, pago_minimo)),
    coste_real_kg = greatest(0, coalesce((a->>'coste_real_kg')::numeric, coste_real_kg))
  where id = 1;
end $$;

revoke all on function public._clave_valida(text) from public, anon, authenticated;

-- ---------- seguridad de las fotos: solo imágenes y de tamaño razonable ----------
update storage.buckets set file_size_limit = 6 * 1024 * 1024, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id in ('fotos', 'avatares');

-- ===== MEJORAS: avisos, comentarios e ideas =====

-- ---------- avisos para cada persona (se crean solos al cambiar sus pedidos) ----------
create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  pedido_id uuid references public.pedidos on delete cascade,
  texto text not null,
  creado timestamptz not null default now(),
  leido boolean not null default false
);
create index if not exists avisos_user on public.avisos (user_id, creado desc);
alter table public.avisos enable row level security;
drop policy if exists propios on public.avisos;
create policy propios on public.avisos for select using (user_id = auth.uid());
grant select on public.avisos to authenticated;

create or replace function public._avisar_pedido() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare t text := coalesce(nullif(new.titulo, ''), 'tu pieza'); m text;
begin
  if new.user_id is null then return new; end if;
  if new.estado is distinct from old.estado then
    m := case new.estado
      when 'imprimiendo' then 'Ya se está imprimiendo «' || t || '»'
      when 'impreso' then '¡«' || t || '» está impreso! Ya puedes recogerlo'
      when 'entregado' then 'Entregado: «' || t || '»'
      when 'cancelado' then 'Se ha cancelado «' || t || '»'
      else null end;
  elsif old.peticion and not new.peticion then
    m := 'El taller ha aceptado tu petición «' || t || '»: ya está en la cola';
  elsif jsonb_array_length(new.fotos) > jsonb_array_length(old.fotos) then
    m := 'Hay fotos nuevas de cómo ha quedado «' || t || '»';
  elsif new.pagado and not old.pagado then
    m := 'Pago recibido de «' || t || '». ¡Gracias!';
  end if;
  if m is not null then insert into public.avisos (user_id, pedido_id, texto) values (new.user_id, new.id, m); end if;
  return new;
end $$;
drop trigger if exists avisar_pedido on public.pedidos;
create trigger avisar_pedido after update on public.pedidos for each row execute function public._avisar_pedido();

create or replace function public.leer_avisos() returns void
language sql security definer set search_path = public, extensions as $$
  update public.avisos set leido = true where user_id = auth.uid() and not leido;
  delete from public.avisos where user_id = auth.uid() and creado < now() - interval '60 days';
$$;
grant execute on function public.leer_avisos() to authenticated;

-- ---------- comentarios en la vitrina ----------
create table if not exists public.comentarios (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  nombre text not null default '',
  texto text not null,
  creado timestamptz not null default now()
);
create index if not exists comentarios_pedido on public.comentarios (pedido_id, creado);
alter table public.comentarios enable row level security;
drop policy if exists leer on public.comentarios;
create policy leer on public.comentarios for select using (true);
grant select on public.comentarios to anon, authenticated;

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
  if not found then raise exception 'Esa pieza ya no está'; end if;
  select coalesce(nullif(p.nombre, ''), nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1)) into v_nombre
  from auth.users u left join public.perfiles p on p.user_id = u.id where u.id = auth.uid();
  insert into public.comentarios (pedido_id, user_id, nombre, texto) values (p_id, auth.uid(), left(coalesce(v_nombre, ''), 40), v) returning id into v_id;
  if v_dueno is not null and v_dueno <> auth.uid() then
    insert into public.avisos (user_id, pedido_id, texto) values (v_dueno, p_id, left(coalesce(v_nombre, 'Alguien') || ' ha comentado «' || coalesce(nullif(v_titulo, ''), 'tu pieza') || '»: ' || v, 300));
  end if;
  return v_id;
end $$;

-- borra tu comentario (el taller puede borrar cualquiera)
create or replace function public.borrar_comentario(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.comentarios where id = p_id
    and (user_id = auth.uid() or exists (select 1 from public.admins where user_id = auth.uid()));
  if not found then raise exception 'No puedes borrar ese comentario'; end if;
end $$;
grant execute on function public.comentar(uuid, text), public.borrar_comentario(uuid) to authenticated;

-- ---------- ideas: «búscame un modelo de…» ----------
create table if not exists public.deseos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  nombre text not null default '',
  texto text not null,
  estado text not null default 'abierto' check (estado in ('abierto', 'encontrado', 'descartado')),
  respuesta text not null default '',
  enlace text not null default '',
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
alter table public.deseos enable row level security;
drop policy if exists propios_o_taller on public.deseos;
create policy propios_o_taller on public.deseos for select
  using (user_id = auth.uid() or exists (select 1 from public.admins where user_id = auth.uid()));
grant select on public.deseos to authenticated;

create or replace function public.crear_deseo(p_texto text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v text := left(trim(coalesce(p_texto, '')), 600); v_nombre text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entra con tu cuenta'; end if;
  if length(v) < 4 then raise exception 'Cuéntalo un poco más'; end if;
  if (select count(*) from public.deseos where user_id = auth.uid() and estado = 'abierto') >= 5 then
    raise exception 'Ya tienes 5 ideas esperando respuesta';
  end if;
  select coalesce(nullif(p.nombre, ''), nullif(u.raw_user_meta_data->>'nombre', ''), split_part(u.email, '@', 1)) into v_nombre
  from auth.users u left join public.perfiles p on p.user_id = u.id where u.id = auth.uid();
  insert into public.deseos (user_id, nombre, texto) values (auth.uid(), left(coalesce(v_nombre, ''), 40), v) returning id into v_id;
  return v_id;
end $$;

create or replace function public.borrar_deseo(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.deseos where id = p_id and (user_id = auth.uid() or exists (select 1 from public.admins where user_id = auth.uid()));
end $$;

-- el taller responde: le pasa un enlace (encontrado) o lo descarta, con una nota
create or replace function public.admin_deseo(p_clave text, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare d public.deseos; v_enlace text := left(trim(coalesce(p->>'enlace', '')), 500);
begin
  perform public._exigir_admin(p_clave);
  select * into d from public.deseos where id = p_id;
  if not found then raise exception 'Esa idea ya no está'; end if;
  if v_enlace <> '' and v_enlace !~* '^https://' then raise exception 'El enlace tiene que empezar por https://'; end if;
  update public.deseos set
    estado = case when p->>'estado' in ('abierto', 'encontrado', 'descartado') then p->>'estado' else estado end,
    respuesta = left(coalesce(p->>'respuesta', respuesta), 600),
    enlace = case when p ? 'enlace' then v_enlace else enlace end,
    actualizado = now()
  where id = p_id;
  if p->>'estado' = 'encontrado' then
    insert into public.avisos (user_id, texto) values (d.user_id, 'El taller ha encontrado un modelo para tu idea «' || left(d.texto, 60) || '»');
  elsif p->>'estado' = 'descartado' then
    insert into public.avisos (user_id, texto) values (d.user_id, 'Respuesta del taller a tu idea «' || left(d.texto, 60) || '»');
  end if;
end $$;
grant execute on function public.crear_deseo(text), public.borrar_deseo(uuid) to authenticated;
grant execute on function public.admin_deseo(text, uuid, jsonb) to anon, authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.avisos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.comentarios; exception when others then null; end;
  begin alter publication supabase_realtime add table public.deseos; exception when others then null; end;
end $$;
