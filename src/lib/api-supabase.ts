import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AJUSTES_DEFECTO } from "./coste";
import type { Ajustes, Api, Datos, Filamento, Pedido, Perfil } from "./types";

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
        ? { precio_defecto: num(a.data.precio_defecto), peso_defecto: num(a.data.peso_defecto), luz_hora: num(a.data.luz_hora), merma_pct: num(a.data.merma_pct) }
        : AJUSTES_DEFECTO;
      const filamentos = (f.data || []).map((x) => ({ ...x, precio: x.precio === null ? null : Number(x.precio), peso: num(x.peso), stock_g: num(x.stock_g) })) as Filamento[];
      const pedidos = (p.data || []).map((x) => ({ ...x, coste: num(x.coste) })) as Pedido[];
      return { ajustes: aj, filamentos, pedidos };
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
    adminBorrarPedido: (clave, id) => rpc("admin_borrar_pedido", { p_clave: clave, p_id: id }),
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
            if (error) throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos" : error.message);
          },
          async registrar(nombre: string, email: string, clave: string) {
            const { error } = await sb.auth.signUp({ email, password: clave, options: { data: { nombre } } });
            if (error) throw new Error(error.message);
          },
          async salir() {
            await sb.auth.signOut();
          },
          soyAdmin: () => rpc<boolean>("soy_admin", {}),
        }
      : {}),
  };
}
