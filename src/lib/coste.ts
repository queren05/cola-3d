import type { Ajustes, CosteDetalle, Filamento, Linea } from "./types";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lo mismo que calcula la base de datos (supabase/schema.sql, función _coste). */
export function calcularCoste(lineas: Linea[], minutos: number, copias: number, fils: Filamento[], a: Ajustes): CosteDetalle {
  const cop = Math.max(1, Math.round(copias || 1));
  let fil = 0;
  let gtot = 0;
  let colores = 0;
  const out = lineas.map((l) => {
    const f = l.filamento_id ? fils.find((x) => x.id === l.filamento_id) : undefined;
    const precio = f?.precio ?? a.precio_defecto;
    const peso = f?.peso || a.peso_defecto;
    const g = Math.max(0, l.gramos || 0) * cop;
    const c = (g * precio) / peso;
    fil += c;
    gtot += g;
    if (g > 0) colores++;
    return { nombre: f?.nombre ?? l.nombre, color: f?.color ?? l.color, gramos: g, precio, peso, coste: r2(c) };
  });
  const mermaPct = colores > 1 ? a.merma_pct : 0;
  const merma = (fil * mermaPct) / 100;
  const luz = ((minutos || 0) / 60) * cop * a.luz_hora;
  return { filamento: r2(fil), merma: r2(merma), merma_pct: mermaPct, luz: r2(luz), gramos: gtot, total: r2(fil + merma + luz), lineas: out };
}

export const AJUSTES_DEFECTO: Ajustes = { precio_defecto: 16, peso_defecto: 1000, luz_hora: 0.02, merma_pct: 10 };
