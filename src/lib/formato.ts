const eurF = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const n0F = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const n1F = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

export const eur = (v: number) => eurF.format(v || 0).replace(/\s/g, "\u00a0");
export const n0 = (v: number) => n0F.format(v || 0);
export const n1 = (v: number) => n1F.format(v || 0);
// espacio que no se parte: «14 g» nunca queda con el número en una línea y la unidad en otra
const NB = "\u00a0";
export const gramos = (g: number) => (g >= 1000 ? `${n1(g / 1000)}${NB}kg` : `${n0(g)}${NB}g`);

/** «12,5» → 12.5 ; «1.200» → 1200 */
export function num(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v ?? "").trim().replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const x = parseFloat(t);
  return Number.isFinite(x) ? x : 0;
}

export function duracion(min: number): string {
  const m = Math.round(min || 0);
  if (!m) return "";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}${NB}h ${r}${NB}min` : `${h}${NB}h`) : `${r}${NB}min`;
}

export function hace(iso: string): string {
  return haceTxt(iso).replace(/ /g, "\u00a0");
}
function haceTxt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  const s = (Date.now() - +d) / 1000;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 2) return "ayer";
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} días`;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

export function fechaLarga(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return "";
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + ", " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export function dominio(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export function limpiarUrl(u: string): string {
  let s = String(u || "").trim();
  const m = s.match(/https?:\/\/\S+/i);
  if (m) s = m[0];
  else if (s && !/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const x = new URL(s);
    return /^https?:$/.test(x.protocol) && x.hostname.includes(".") ? x.href : "";
  } catch {
    return "";
  }
}

export const clave = (nombre: string) => nombre.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** color estable para el avatar de una persona */
export function colorPersona(nombre: string): string {
  let h = 0;
  for (const c of clave(nombre)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tono = h % 360;
  // amarillos, verdes y turquesas son muy claros: más oscuros para que la letra blanca se lea
  const luz = tono >= 25 && tono <= 200 ? 36 : 48;
  return `hsl(${tono} 62% ${luz}%)`;
}

/** texto legible sobre un color de filamento */
export function tintaSobre(hex: string): string {
  const m = hex.replace("#", "");
  if (m.length < 6) return "#111";
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}
