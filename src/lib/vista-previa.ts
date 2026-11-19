import type { Api, Perfil } from "./types";

export interface Vista {
  titulo?: string;
  imagen?: string;
  perfiles?: Perfil[];
}

const CACHE = "cola3d-vistas2";
function cache(): Record<string, Vista> {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || "{}");
  } catch {
    return {};
  }
}

/** limpia «Tanjiro – Demon Slayer - Free 3D Print Model - MakerWorld» */
function limpiarTitulo(t?: string): string | undefined {
  if (!t) return undefined;
  const s = t.replace(/\s*[-|–]\s*(Free\s+)?3D\s+Print(able)?\s+Model.*$/i, "").replace(/\s*[-|–]\s*MakerWorld.*$/i, "").trim();
  return /^\d+$/.test(s) ? undefined : s || undefined;
}
const generica = (img?: string) => !img || /og-icon|favicon|logo/i.test(img);

/** Saca la foto y el nombre de la figura del enlace (MakerWorld, Printables, Thingiverse…). */
export async function vistaPrevia(url: string, api: Api): Promise<Vista | null> {
  const c = cache();
  const k = url.split("#")[0];
  if (c[k]) return c[k];
  let v: Vista | null = null;
  if (api.vistaPrevia) {
    try {
      v = await api.vistaPrevia(url);
    } catch {}
  }
  if (!v?.imagen) {
    try {
      const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
      if (r.ok) {
        const j = await r.json();
        const d = j?.data || {};
        v = { ...v, titulo: v?.titulo || d.title, imagen: generica(d.image?.url) ? v?.imagen : d.image.url };
      }
    } catch {}
  }
  if (!v) return null;
  v = { titulo: limpiarTitulo(v.titulo), imagen: generica(v.imagen) ? undefined : v.imagen, perfiles: v.perfiles?.length ? v.perfiles : undefined };
  if (v.titulo || v.imagen) {
    try {
      localStorage.setItem(CACHE, JSON.stringify({ ...c, [k]: v }));
    } catch {}
  }
  return v;
}
