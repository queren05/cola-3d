-- ---------- perfil solo para otra impresora (P1S, X1…): se puede pedir, llega como petición ----------
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
  if coalesce((p->>'otra_impresora')::boolean, false) and v_src.id is null then v_motivo := 'impresora';
  elsif v_colores > 4 then v_motivo := 'colores'; end if;
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
