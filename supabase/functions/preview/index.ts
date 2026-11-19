// Función de Supabase (opcional): saca la foto y el nombre de la figura de un enlace.
// MakerWorld no deja leer sus páginas desde el navegador; desde aquí se consulta su API.
// Despliegue: supabase functions deploy preview --no-verify-jwt   y en GitHub la variable PREVIEW_FN=1
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function meta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  return (html.match(re) || html.match(re2))?.[1];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { url } = await req.json();
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol)) throw new Error("enlace no válido");
    let out: { titulo?: string; imagen?: string } = {};
    const mw = u.hostname.endsWith("makerworld.com") && u.pathname.match(/models\/(\d+)/);
    if (mw) {
      const r = await fetch(`https://makerworld.com/api/v1/design-service/design/${mw[1]}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (r.ok) {
        const d = await r.json();
        out = { titulo: d.title, imagen: d.coverUrl };
      }
    }
    if (!out.imagen) {
      const r = await fetch(u.href, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
      if (r.ok) {
        const html = (await r.text()).slice(0, 300_000);
        out = { titulo: out.titulo || meta(html, "og:title"), imagen: meta(html, "og:image") };
      }
    }
    return new Response(JSON.stringify(out), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
