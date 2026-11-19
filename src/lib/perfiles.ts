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

/** reparte los gramos del perfil entre los rollos que tienes (el color más parecido) */
export function lineasDePerfil(p: Perfil, filamentos: Filamento[]): (Linea & { gramos: number })[] {
  const out: Linea[] = [];
  for (const c of p.colores) {
    if (c.gramos <= 0) continue;
    let mejor: Filamento | undefined;
    let dmin = Infinity;
    for (const f of filamentos) {
      if (!f.activo || f.stock_g < 50) continue;
      const d = distancia(c.color, f.color) + (f.material.toUpperCase() === c.material.toUpperCase() ? 0 : 60);
      if (d < dmin) {
        dmin = d;
        mejor = f;
      }
    }
    if (mejor && dmin < 260) {
      const ya = out.find((l) => l.filamento_id === mejor!.id);
      if (ya) ya.gramos += c.gramos;
      else out.push({ filamento_id: mejor.id, nombre: mejor.nombre, color: mejor.color, gramos: c.gramos });
    } else {
      out.push({ filamento_id: null, nombre: c.material, color: c.color, gramos: c.gramos });
    }
  }
  return out.map((l) => ({ ...l, gramos: Math.round(l.gramos * 10) / 10 }));
}
