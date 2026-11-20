import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AJUSTES_DEFECTO } from "./coste";
import type { Ajustes, Api, Cuenta, Datos, Filamento, Pedido, Perfil } from "./types";

/** Supabase: la web solo lee las tablas; todo lo que escribe pasa por las funciones de supabase/schema.sql. */
export function apiSupabase(url: string, key: string, cuentas: boolean, previewFn: boolean): Api {
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: cuentas, autoRefreshToken: cuentas } });

  async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message.replace(/^.*?: /, ""));
    return data as T;
  }
  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

  return {
    modo: "supabase",
    cuentas,
    async cargar(): Promise<Datos> {
      const [a, f, p] = await Promise.all([
        sb.from("ajustes").select("*").eq("id", 1).maybeSingle(),
        sb.from("filamentos").select("*").order("orden").order("creado"),
        sb.from("pedidos").select("*").order("creado"),
      ]);
      const err = a.error || f.error || p.error;
      if (err) throw new Error(err.message);
      const aj: Ajustes = a.data
        ? { precio_defecto: num(a.data.precio_defecto), peso_defecto: num(a.data.peso_defecto), luz_hora: num(a.data.luz_hora), merma_pct: num(a.data.merma_pct), bizum: String(a.data.bizum || ""), gratis_g: a.data.gratis_g === undefined || a.data.gratis_g === null ? 50 : num(a.data.gratis_g), pago_minimo: a.data.pago_minimo === undefined || a.data.pago_minimo === null ? 0.5 : num(a.data.pago_minimo) }
        : AJUSTES_DEFECTO;
      const filamentos = (f.data || []).map((x) => ({ ...x, precio: x.precio === null ? null : Number(x.precio), peso: num(x.peso), stock_g: num(x.stock_g) })) as Filamento[];
      const pedidos = (p.data || []).map((x) => ({ ...x, coste: num(x.coste) })) as Pedido[];
      // me gusta y guardados (si aún no existen las tablas, la web sigue funcionando)
      const sesionActiva = cuentas ? (await sb.auth.getSession()).data.session : null;
      const [v, g, pf] = await Promise.all([
        sb.from("votos").select("pedido_id,user_id"),
        sesionActiva ? sb.from("guardados").select("pedido_id,lista") : Promise.resolve({ data: [] as { pedido_id: string; lista: string }[], error: null }),
        sb.from("perfiles").select("user_id,nombre,avatar"),
      ]);
      const listas = g.error ? [] : ((g.data || []) as { pedido_id: string; lista?: string }[]).map((x) => ({ pedido_id: x.pedido_id, lista: x.lista || "Guardados" }));
      const perfiles: Datos["perfiles"] = {};
      for (const x of (pf.error ? [] : pf.data || []) as { user_id: string; nombre: string; avatar: string }[]) perfiles[x.user_id] = { nombre: x.nombre, avatar: x.avatar };
      return { ajustes: aj, filamentos, pedidos, votos: v.error ? [] : (v.data as Datos["votos"]) || [], guardados: [...new Set(listas.map((x) => x.pedido_id))], listas, perfiles };
    },
    escuchar(cb) {
      let t: ReturnType<typeof setTimeout> | undefined;
      const aviso = () => {
        clearTimeout(t);
        t = setTimeout(cb, 250);
      };
      const ch = sb
        .channel("cola3d")
        .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, aviso)
        .on("postgres_changes", { event: "*", schema: "public", table: "filamentos" }, aviso)
        .on("postgres_changes", { event: "*", schema: "public", table: "ajustes" }, aviso)
        .on("postgres_changes", { event: "*", schema: "public", table: "votos" }, aviso)
        .on("postgres_changes", { event: "*", schema: "public", table: "perfiles" }, aviso)
        .subscribe();
      // por si el tiempo real se corta: refresco al volver a la pestaña
      const vis = () => document.visibilityState === "visible" && aviso();
      document.addEventListener("visibilitychange", vis);
      return () => {
        clearTimeout(t);
        document.removeEventListener("visibilitychange", vis);
        sb.removeChannel(ch);
      };
    },
    crearPedido: (p) => rpc("crear_pedido", { p }),
    cancelarPedido: (id, token) => rpc("cancelar_pedido", { p_id: id, p_token: token }),
    comprobarClave: (clave) => rpc<boolean>("comprobar_clave", { p_clave: clave }),
    adminPedido: (clave, id, cambios) => rpc("admin_pedido", { p_clave: clave, p_id: id, p: cambios }),
    async subirFoto(pedidoId, foto) {
      const ruta = `${pedidoId}/${Date.now()}.jpg`;
      const { error } = await sb.storage.from("fotos").upload(ruta, foto, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(error.message.includes("row-level") || error.message.includes("Unauthorized") ? "Solo el taller puede subir fotos" : "No se ha podido subir la foto");
      return sb.storage.from("fotos").getPublicUrl(ruta).data.publicUrl;
    },
    async borrarFoto(url) {
      const ruta = url.split("/object/public/fotos/")[1];
      if (ruta) await sb.storage.from("fotos").remove([decodeURIComponent(ruta)]);
    },
    adminBorrarPedido: (clave, id) => rpc("admin_borrar_pedido", { p_clave: clave, p_id: id }),
    adminCrearPieza: (clave, p) => rpc<string>("admin_crear_pieza", { p_clave: clave, p }),
    adminCuentas: (clave) => rpc<Cuenta[]>("admin_cuentas", { p_clave: clave }),
    votar: (id) => rpc<boolean>("votar", { p_id: id }),
    guardar: (id) => rpc<boolean>("guardar", { p_id: id }),
    guardarEn: (id, lista) => rpc<boolean>("guardar_en", { p_id: id, p_lista: lista }),
    renombrarLista: (lista, nueva) => rpc("renombrar_lista", { p_lista: lista, p_nueva: nueva }),
    borrarLista: (lista) => rpc("borrar_lista", { p_lista: lista }),
    guardarPerfil: async (nombre, avatar) => {
      await rpc("guardar_perfil", { p_nombre: nombre, p_avatar: avatar });
      await sb.auth.refreshSession().catch(() => {});
    },
    async subirAvatar(foto) {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error("Entra con tu cuenta");
      const ruta = `${uid}/${Date.now()}.jpg`;
      const { error } = await sb.storage.from("avatares").upload(ruta, foto, { contentType: "image/jpeg" });
      if (error) throw new Error("No se ha podido subir la foto");
      return sb.storage.from("avatares").getPublicUrl(ruta).data.publicUrl;
    },
    pedirIgual: (id, nombre, copias, notas) => rpc("crear_pedido", { p: { copia_de: id, nombre, copias, notas } }),
    marcarVisita: async () => {
      await sb.rpc("marcar_visita", {});
    },
    adminFilamento: (clave, f) => rpc("admin_filamento", { p_clave: clave, f }),
    adminBorrarFilamento: (clave, id) => rpc("admin_borrar_filamento", { p_clave: clave, p_id: id }),
    adminAjustes: (clave, a) => rpc("admin_ajustes", { p_clave: clave, a }),
    adminCambiarClave: (clave, nueva) => rpc("admin_cambiar_clave", { p_clave: clave, p_nueva: nueva }),
    vistaPrevia: previewFn
      ? async (u) => {
          const { data, error } = await sb.functions.invoke("preview", { body: { url: u } });
          if (error || !data) return null;
          return data as { titulo?: string; imagen?: string; perfiles?: Perfil[] };
        }
      : undefined,
    ...(cuentas
      ? {
          async sesion() {
            const { data } = await sb.auth.getSession();
            const u = data.session?.user;
            if (!u) return null;
            return { id: u.id, email: u.email || "", nombre: String(u.user_metadata?.nombre || u.email?.split("@")[0] || "") };
          },
          async entrar(email: string, clave: string) {
            const { error } = await sb.auth.signInWithPassword({ email, password: clave });
            if (error) throw new Error(traducir(error.message));
          },
          async registrar(nombre: string, email: string, clave: string) {
            const { error } = await sb.auth.signUp({ email, password: clave, options: { data: { nombre }, emailRedirectTo: volver() } });
            if (error) throw new Error(traducir(error.message));
          },
          async salir() {
            await sb.auth.signOut();
          },
          soyAdmin: () => rpc<boolean>("soy_admin", {}),
          async recuperar(email: string) {
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: volver() });
            if (error) throw new Error(traducir(error.message));
          },
          async nuevaClave(clave: string) {
            const { error } = await sb.auth.updateUser({ password: clave });
            if (error) throw new Error(traducir(error.message));
          },
          alRecuperar(cb: () => void) {
            const { data } = sb.auth.onAuthStateChange((ev) => {
              if (ev === "PASSWORD_RECOVERY") cb();
            });
            return () => data.subscription.unsubscribe();
          },
        }
      : {}),
  };
}

/** la dirección de la web sin la parte de #/… (para los enlaces de los correos) */
const volver = () => location.origin + location.pathname;

function traducir(m: string): string {
  if (/invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos";
  if (/already registered|already exists/i.test(m)) return "Ese correo ya tiene cuenta";
  if (/email not confirmed/i.test(m)) return "Confirma tu correo antes de entrar";
  if (/password.*(at least|characters)/i.test(m)) return "La contraseña necesita al menos 6 caracteres";
  if (/same.*password|different from the old/i.test(m)) return "Pon una contraseña distinta a la anterior";
  if (/email rate limit/i.test(m)) return "Ahora mismo no se pueden mandar más correos. Prueba dentro de un rato";
  if (/security purposes.*after (\d+) seconds/i.test(m)) return `Espera ${m.match(/after (\d+) seconds/i)![1]} segundos y vuelve a probar`;
  if (/rate limit|too many|security purposes/i.test(m)) return "Demasiados intentos, espera un poco";
  if (/invalid.*email|unable to validate email/i.test(m)) return "El correo no es válido";
  return m;
}
