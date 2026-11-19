import type { Filamento, Linea, Perfil } from "./types";

/**
 * Tiempo aproximado en la A1 mini a partir del tiempo de MakerWorld.
 * La A1 mini acelera la mitad que las X1/P1/H2, así que en esas tarda más.
 */
export function minutosA1mini(p: Perfil): number {
  const m = p.modelo;
  const f = m === "N1" ? 1 : m === "N2S" || m === "N9" ? 1.05 : /^(BL-P|C1|N6|N7|O1)/.test(m) ? 1.3 : 1.15;
  return Math.round(p.minutos * f);
}
/** solo se admiten modelos de MakerWorld (traen el perfil de impresión ya preparado) */
export const esMakerWorld = (url: string) => /^https?:\/\/([a-z0-9-]+\.)*makerworld\.com(\.cn)?\//i.test(url);
export const esA1mini = (p: Perfil) => p.modelo === "N1";

/** el perfil del enlace (#profileId-…), el hecho para la A1 mini, el principal o el primero */
export function perfilInicial(perfiles: Perfil[], url: string): Perfil | undefined {
  const id = url.match(/profileId-(\d+)/)?.[1];
  return perfiles.find((p) => p.id === id) || perfiles.find(esA1mini) || perfiles.find((p) => p.porDefecto && p.a1mini) || perfiles.find((p) => p.a1mini) || perfiles[0];
}

/** el enlace apuntando al perfil elegido, para abrirlo directamente en Bambu Handy */
export function urlConPerfil(url: string, p?: Perfil): string {
  if (!p || !/makerworld\.com/i.test(url)) return url;
  return url.split("#")[0] + "#profileId-" + p.id;
}

function rgb(h: string): [number, number, number] {
  const x = h.replace("#", "");
  const v = x.length === 3 ? x.split("").map((c) => c + c).join("") : x.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0) as [number, number, number];
}
function distancia(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

export interface Falta {
  color: string;
  material: string;
}
const mismoMaterial = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const disponible = (f: Filamento) => f.activo && f.stock_g >= 50;

/**
 * reparte los gramos del perfil entre los rollos que tienes: mismo material y color parecido.
 * Si no hay ninguno así, la línea lleva «falta» para avisar y que elijan otro.
 */
export function lineasDePerfil(p: Perfil, filamentos: Filamento[]): (Linea & { falta?: Falta })[] {
  const out: (Linea & { falta?: Falta })[] = [];
  for (const c of p.colores) {
    if (c.gramos <= 0) continue;
    let mejor: Filamento | undefined;
    let dmin = Infinity;
    for (const f of filamentos) {
      if (!disponible(f) || !mismoMaterial(f.material, c.material)) continue;
      const d = distancia(c.color, f.color);
      if (d < dmin) {
        dmin = d;
        mejor = f;
      }
    }
    if (mejor && dmin < 150) {
      const ya = out.find((l) => l.filamento_id === mejor!.id);
      if (ya) ya.gramos += c.gramos;
      else out.push({ filamento_id: mejor.id, nombre: mejor.nombre, color: mejor.color, gramos: c.gramos });
    } else {
      out.push({ filamento_id: null, nombre: c.material, color: c.color, gramos: c.gramos, falta: { color: c.color, material: c.material } });
    }
  }
  return out.map((l) => ({ ...l, gramos: Math.round(l.gramos * 10) / 10 }));
}

/** rollos que puedes ofrecer en lugar de uno que no tienes: primero el mismo material, luego el color más parecido */
export function alternativas(f: Falta, filamentos: Filamento[], n = 4): Filamento[] {
  return filamentos
    .filter(disponible)
    .map((x) => ({ x, d: distancia(f.color, x.color) + (f.material && !mismoMaterial(x.material, f.material) ? 400 : 0) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((o) => o.x);
}
export const tieneMaterial = (material: string, filamentos: Filamento[]) => filamentos.some((f) => disponible(f) && mismoMaterial(f.material, material));
