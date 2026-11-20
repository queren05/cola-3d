import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiLocal } from "./api-local";
import { apiSupabase } from "./api-supabase";
import { AJUSTES_DEFECTO } from "./coste";
import { clave as claveNombre } from "./formato";
import type { Api, Datos, Pedido, Sesion } from "./types";

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const CUENTAS = import.meta.env.VITE_CUENTAS === "1";
const PREVIEW = import.meta.env.VITE_PREVIEW_FN === "1";

const api: Api = SB_URL && SB_KEY ? apiSupabase(SB_URL, SB_KEY, CUENTAS, PREVIEW) : apiLocal();

function ls<T>(k: string, def: T, store: Storage | null = null): T {
  try {
    const s = (store ?? localStorage).getItem(k);
    return s ? (JSON.parse(s) as T) : def;
  } catch {
    return def;
  }
}
function lsSet(k: string, v: unknown, store: Storage | null = null) {
  try {
    if (v === null || v === undefined) (store ?? localStorage).removeItem(k);
    else (store ?? localStorage).setItem(k, JSON.stringify(v));
  } catch {}
}

export interface Toast {
  id: number;
  texto: string;
  tipo: "ok" | "error";
}

interface Ctx {
  api: Api;
  datos: Datos;
  cargado: boolean;
  error: string | null;
  recargar: () => Promise<void>;
  // quién soy
  yo: string;
  setYo: (n: string) => void;
  sesion: Sesion | null;
  setSesion: (s: Sesion | null) => void;
  /** se ha entrado desde el correo para cambiar la contraseña */
  recuperando: boolean;
  setRecuperando: (v: boolean) => void;
  tokens: Record<string, string>;
  guardarToken: (id: string, token: string) => void;
  // taller
  clave: string | null;
  esAdmin: boolean;
  entrarTaller: (clave: string) => Promise<boolean>;
  salirTaller: () => void;
  // avisos
  toasts: Toast[];
  aviso: (texto: string, tipo?: "ok" | "error") => void;
  // al crear un pedido se resalta en la cola
  resaltado: string | null;
  /** pedido hecho por ti (tu cuenta, este navegador o tu nombre) */
  esMio: (p: Pedido) => boolean;
  setResaltado: (id: string | null) => void;
}

const C = createContext<Ctx | null>(null);

export function Proveedor({ children }: { children: ReactNode }) {
  const [datos, setDatos] = useState<Datos>({ ajustes: AJUSTES_DEFECTO, filamentos: [], pedidos: [] });
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yo, setYoState] = useState<string>(() => ls("cola3d-yo", ""));
  const [tokens, setTokens] = useState<Record<string, string>>(() => ls("cola3d-tokens", {}));
  const [clave, setClave] = useState<string | null>(() => ls<string | null>("cola3d-clave", null, sessionStorage));
  const [adminCuenta, setAdminCuenta] = useState(false);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [recuperando, setRecuperando] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [resaltado, setResaltado] = useState<string | null>(null);
  const tid = useRef(0);

  const recargar = useCallback(async () => {
    try {
      const d = await api.cargar();
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar");
    } finally {
      setCargado(true);
    }
  }, []);

  useEffect(() => {
    recargar();
    return api.escuchar(recargar);
  }, [recargar]);

  useEffect(() => {
    if (!api.cuentas || !api.sesion) return;
    const quitar = api.alRecuperar?.(() => setRecuperando(true));
    api.sesion().then(async (s) => {
      setSesion(s);
      if (s) api.marcarVisita?.().catch(() => {});
      if (s && api.soyAdmin) setAdminCuenta(await api.soyAdmin().catch(() => false));
    });
    return quitar;
  }, []);

  const aviso = useCallback((texto: string, tipo: "ok" | "error" = "ok") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const value: Ctx = useMemo(
    () => ({
      api,
      datos,
      cargado,
      error,
      recargar,
      yo: sesion?.nombre || yo,
      setYo: (n) => {
        setYoState(n);
        lsSet("cola3d-yo", n.trim() || null);
      },
      sesion,
      recuperando,
      setRecuperando,
      setSesion: (s) => {
        setSesion(s);
        if (s) api.marcarVisita?.().catch(() => {});
        if (s && api.soyAdmin) api.soyAdmin().then(setAdminCuenta).catch(() => {});
        else setAdminCuenta(false);
      },
      tokens,
      guardarToken: (id, token) => {
        setTokens((t) => {
          const n = { ...t, [id]: token };
          lsSet("cola3d-tokens", n);
          return n;
        });
      },
      clave: api.cuentas ? (adminCuenta ? "" : null) : clave,
      esAdmin: api.cuentas ? adminCuenta : clave !== null,
      entrarTaller: async (c) => {
        const ok = await api.comprobarClave(c).catch(() => false);
        if (ok) {
          setClave(c);
          lsSet("cola3d-clave", c, sessionStorage);
        }
        return ok;
      },
      salirTaller: () => {
        setClave(null);
        lsSet("cola3d-clave", null, sessionStorage);
      },
      toasts,
      aviso,
      resaltado,
      setResaltado,
      esMio: (p: Pedido) => {
        if (tokens[p.id]) return true;
        if (sesion) return p.user_id === sesion.id || (!p.user_id && claveNombre(p.nombre) === claveNombre(sesion.nombre));
        return !!yo && claveNombre(p.nombre) === claveNombre(yo);
      },
    }),
    [datos, cargado, error, recargar, yo, sesion, tokens, clave, adminCuenta, toasts, aviso, resaltado, recuperando],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useDatos() {
  const c = useContext(C);
  if (!c) throw new Error("Falta el Proveedor");
  return c;
}

/** ruta en el # de la dirección: #/pedir, #/pedido/<id>, #/gente/<persona>… */
export function useRuta(): [string[], (r: string) => void] {
  const leer = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [ruta, setRuta] = useState<string[]>(leer);
  useEffect(() => {
    const f = () => setRuta(leer());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const ir = useCallback((r: string) => {
    const destino = "#/" + r;
    if (location.hash !== destino) location.hash = destino;
  }, []);
  return [ruta, ir];
}
