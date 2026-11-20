// Función de Supabase: saca la foto, el nombre y los perfiles de impresión (gramos, tiempo, colores)
// de un enlace. MakerWorld no deja leer sus datos desde el navegador; desde aquí se consulta su API.
// Despliegue: supabase functions deploy preview --no-verify-jwt   y en GitHub la variable PREVIEW_FN=1
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export interface PerfilColor {
  color: string;
  material: string;
  gramos: number;
}
export interface Perfil {
  id: string;
  titulo: string;
  /** impresora para la que está laminado, p. ej. «A1 mini», «X1 Carbon» */
  impresora: string;
  /** código interno de Bambu: N1 = A1 mini */
  modelo: string;
  /** también sirve para la A1 mini (MakerWorld lo vuelve a laminar) */
  a1mini: boolean;
  minutos: number;
  gramos: number;
  placas: number;
  colores: PerfilColor[];
  porDefecto: boolean;
}

function meta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  return (html.match(re) || html.match(re2))?.[1];
}

// deno-lint-ignore no-explicit-any
export function sacarPerfiles(d: any): Perfil[] {
  // deno-lint-ignore no-explicit-any
  return (d?.instances || []).map((i: any): Perfil => {
    const mi = i?.extention?.modelInfo || {};
    const comp = mi.compatibility || {};
    // deno-lint-ignore no-explicit-any
    const otras: any[] = mi.otherCompatibility || [];
    // deno-lint-ignore no-explicit-any
    const placas: any[] = mi.plates || [];
    const porColor = new Map<string, PerfilColor>();
    for (const p of placas) {
      for (const f of p?.filaments || []) {
        const color = String(f.color || "#9aa3ad").slice(0, 7).toLowerCase();
        const material = String(f.type || "PLA");
        const k = color + "|" + material;
        const g = parseFloat(f.usedG) || 0;
        const prev = porColor.get(k);
        if (prev) prev.gramos += g;
        else porColor.set(k, { color, material, gramos: g });
      }
    }
    const colores = [...porColor.values()].map((c) => ({ ...c, gramos: Math.round(c.gramos * 10) / 10 })).sort((a, b) => b.gramos - a.gramos);
    const gramos = Number(i.weight) || colores.reduce((s, c) => s + c.gramos, 0);
    const modelo = String(comp.devModelName || "");
    return {
      id: String(i.profileId || i.id || ""),
      titulo: String(i.title || "").trim(),
      impresora: String(comp.devProductName || ""),
      modelo,
      a1mini: modelo === "N1" || otras.some((o) => o?.devModelName === "N1"),
      minutos: Math.round((Number(i.prediction) || placas.reduce((s, p) => s + (Number(p?.prediction) || 0), 0)) / 60),
      gramos: Math.round(gramos * 10) / 10,
      placas: placas.length,
      colores,
      porDefecto: !!i.isDefault,
    };
  });
}

async function makerworld(id: string) {
  const r = await fetch(`https://makerworld.com/api/v1/design-service/design/${id}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) return null;
  const d = await r.json();
  return { titulo: d.title as string | undefined, imagen: d.coverUrl as string | undefined, perfiles: sacarPerfiles(d) };
}

if (typeof Deno !== "undefined")
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      const { url } = await req.json();
      let u = new URL(String(url));
      // solo MakerWorld (y sus enlaces cortos): así nadie puede usar esta función para descargar otras webs
      const permitido = (h: string) => /(^|\.)(makerworld\.com(\.cn)?|bambulab\.com)$/i.test(h);
      if (u.protocol !== "https:" || !permitido(u.hostname)) throw new Error("solo enlaces de MakerWorld");
      // enlaces cortos de la app (Bambu Handy): seguir la redirección
      if (!/models\/\d+/.test(u.pathname)) {
        const r = await fetch(u.href, { headers: { "User-Agent": UA }, redirect: "follow" }).catch(() => null);
        if (r?.url) u = new URL(r.url);
        if (!permitido(u.hostname)) throw new Error("solo enlaces de MakerWorld");
      }
      let out: { titulo?: string; imagen?: string; perfiles?: Perfil[] } = {};
      const mw = /makerworld\.com(\.cn)?$/.test(u.hostname) && u.pathname.match(/models\/(\d+)/);
      if (mw) out = (await makerworld(mw[1])) || {};
      if (!out.imagen) {
        const r = await fetch(u.href, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
        if (r.ok) {
          const html = (await r.text()).slice(0, 300_000);
          out = { ...out, titulo: out.titulo || meta(html, "og:title"), imagen: meta(html, "og:image") };
        }
      }
      return new Response(JSON.stringify(out), { headers: { ...cors, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
  });
