import { clave } from "./formato";
import type { Ajustes, CosteDetalle, Filamento, Linea, Pedido } from "./types";

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Lo mismo que calcula la base de datos (supabase/schema.sql, función _coste). */
export function calcularCoste(lineas: Linea[], minutos: number, copias: number, fils: Filamento[], a: Ajustes): CosteDetalle {
  const cop = Math.max(1, Math.round(copias || 1));
  let fil = 0;
  let gtot = 0;
  let colores = 0;
  const out = juntarLineas(lineas).map((l) => {
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
  // cada color de más purga hilo en cada cambio: 2 colores +10 %, 3 colores +20 %… (máximo 50 %)
  const mermaPct = colores > 1 ? Math.min(50, a.merma_pct * (colores - 1)) : 0;
  const merma = (fil * mermaPct) / 100;
  const luz = ((minutos || 0) / 60) * cop * a.luz_hora;
  return { filamento: r2(fil), merma: r2(merma), merma_pct: mermaPct, luz: r2(luz), gramos: gtot, total: r2(fil + merma + luz), lineas: out };
}

export const AJUSTES_DEFECTO: Ajustes = { precio_defecto: 17.99, peso_defecto: 1000, luz_hora: 0.1, merma_pct: 10, bizum: "", gratis_g: 50, pago_minimo: 0.5 };

/** gramos gratis que le quedan a una persona (lo mismo que _gratis_restante en la base de datos) */
export function gratisRestante(pedidos: Pedido[], a: Ajustes, uid: string | null | undefined, nombre: string, excluir?: string): number {
  const usados = pedidos
    .filter((p) => p.estado !== "cancelado" && p.id !== excluir && (uid ? p.user_id === uid : !p.user_id && clave(p.nombre) === clave(nombre)))
    .reduce((t, p) => t + (p.coste_detalle?.gratis_g || 0), 0);
  return Math.max(0, (a.gratis_g ?? 50) - usados);
}

/** descuenta el filamento (y su purga) de los gramos gratis; la luz se cobra igual */
export function aplicarGratis(d: CosteDetalle, restante: number): CosteDetalle {
  const libre = Math.min(d.gramos, Math.max(0, restante));
  const descuento = d.gramos > 0 && libre > 0 ? r2(((d.filamento + d.merma) * libre) / d.gramos) : 0;
  return { ...d, gratis_g: Math.round(libre * 10) / 10, descuento, total: Math.max(0, r2(d.total - descuento)) };
}

/** junta las líneas que van al mismo rollo (o, sin rollo, al mismo color): cuenta como un solo color */
export function juntarLineas(ls: Linea[]): Linea[] {
  const m = new Map<string, Linea>();
  for (const l of ls) {
    const k = l.filamento_id ? "f:" + l.filamento_id : "c:" + (l.color || "").toLowerCase();
    const ya = m.get(k);
    if (ya) ya.gramos = Math.round((ya.gramos + l.gramos) * 10) / 10;
    else m.set(k, { ...l });
  }
  return [...m.values()];
}

/** el mismo que pidió: su cuenta o, sin cuenta, su nombre */
export const mismaPersona = (a: Pedido, b: Pedido) => (a.user_id ? a.user_id === b.user_id : !b.user_id && clave(a.nombre) === clave(b.nombre));
const delTaller = (p: Pedido) => !!(p.coste_detalle as { taller?: boolean } | undefined)?.taller;

/** lo que debe esa persona entre todos sus pedidos sin pagar */
export function deudaDe(p: Pedido, pedidos: Pedido[]): { total: number; pedidos: Pedido[] } {
  const ps = pedidos.filter((x) => mismaPersona(p, x) && !x.pagado && x.estado !== "cancelado" && !x.peticion && !delTaller(x) && x.coste > 0);
  return { total: Math.round(ps.reduce((t, x) => t + x.coste, 0) * 100) / 100, pedidos: ps };
}

/** aún no llega al mínimo: no se pide pagar, se acumula y se imprime igual */
export const acumula = (p: Pedido, pedidos: Pedido[], a: Ajustes) => !p.pagado && (!!p.acumulado || deudaDe(p, pedidos).total < (a.pago_minimo ?? 0.5));
