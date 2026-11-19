import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { IFlecha, IGente } from "../components/Iconos";
import { Avatar, Barra, Chip, Numero, Vacio } from "../components/Piezas";
import { Portada } from "../components/Pedido";
import { clave, dominio, eur, gramos, hace } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Pedido } from "../lib/types";

const ease = [0.22, 1, 0.36, 1] as const;
const hechos = (p: Pedido) => p.estado === "impreso" || p.estado === "entregado";
const vivos = (p: Pedido) => p.estado === "pendiente" || p.estado === "imprimiendo";

export interface Persona {
  clave: string;
  nombre: string;
  pedidos: Pedido[];
  gastado: number;
  enCola: number;
  debe: number;
  gramos: number;
  ultimo: string;
}

export function agruparPersonas(ps: Pedido[]): Persona[] {
  const m = new Map<string, Persona>();
  for (const p of ps) {
    const k = clave(p.nombre);
    const x = m.get(k) ?? { clave: k, nombre: p.nombre, pedidos: [], gastado: 0, enCola: 0, debe: 0, gramos: 0, ultimo: "" };
    x.pedidos.push(p);
    if (hechos(p)) {
      x.gastado += p.coste;
      x.gramos += p.coste_detalle?.gramos || 0;
      if (!p.pagado) x.debe += p.coste;
    }
    if (vivos(p)) x.enCola += p.coste;
    if (p.creado > x.ultimo) {
      x.ultimo = p.creado;
      x.nombre = p.nombre;
    }
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.gastado - a.gastado || b.ultimo.localeCompare(a.ultimo));
}

export function Gente({ persona, ir, abrir }: { persona?: string; ir: (r: string) => void; abrir: (id: string) => void }) {
  const { datos, esAdmin } = useDatos();
  const gente = useMemo(() => agruparPersonas(datos.pedidos), [datos.pedidos]);
  const sel = persona ? gente.find((g) => g.clave === persona) : undefined;
  const max = Math.max(1, ...gente.map((g) => g.gastado + g.enCola));

  return (
    <div className="pagina">
      <AnimatePresence mode="wait" initial={false}>
        {sel ? (
          <motion.div key={sel.clave} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.35, ease }}>
            <button className="boton plano volver" onClick={() => ir("gente")}><IFlecha width={18} height={18} /> Gente</button>
            <header className="persona-cab">
              <motion.div layoutId={`av-${sel.clave}`}><Avatar nombre={sel.nombre} size={64} /></motion.div>
              <div>
                <h1>{sel.nombre}</h1>
                <span className="sobretitulo">{sel.pedidos.length} pedido{sel.pedidos.length === 1 ? "" : "s"} · {gramos(sel.gramos)} impresos</span>
              </div>
            </header>
            <div className="cifras">
              <div><span className="etiqueta">Gastado</span><span className="cifra"><Numero valor={sel.gastado} /></span></div>
              <div><span className="etiqueta">En cola</span><span className="cifra"><Numero valor={sel.enCola} /></span></div>
              <div><span className="etiqueta">Pendiente de pagar</span><span className={`cifra${sel.debe > 0 ? " debe" : ""}`}><Numero valor={sel.debe} /></span></div>
            </div>
            <div className="historial">
              {[...sel.pedidos].sort((a, b) => b.creado.localeCompare(a.creado)).map((p, i) => (
                <motion.button key={p.id} className="hist-fila" onClick={() => abrir(p.id)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.4), ease }}>
                  <div className="hist-img"><Portada p={p} /></div>
                  <div className="hist-txt">
                    <strong>{p.titulo || dominio(p.url)}</strong>
                    <span>{hace(p.creado)} · {gramos(p.coste_detalle?.gramos || 0)}</span>
                  </div>
                  <Chip estado={p.estado} />
                  <span className={`hist-precio num${p.estado === "cancelado" ? " tachado" : ""}`}>
                    {eur(p.coste)}
                    {hechos(p) && <small className={p.pagado ? "pagado" : "sin-pagar"}>{p.pagado ? "Pagado" : "Sin pagar"}</small>}
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key="lista" initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.35, ease }}>
            <header className="cabecera-pagina">
              <span className="sobretitulo">Quién ha pedido qué</span>
              <h1>Gente</h1>
            </header>
            {gente.length === 0 ? (
              <Vacio titulo="Aún no ha pedido nadie" icono={<IGente width={48} height={48} />} />
            ) : (
              <>
                {esAdmin && (
                  <div className="cifras">
                    <div><span className="etiqueta">Impreso en total</span><span className="cifra"><Numero valor={gente.reduce((t, g) => t + g.gastado, 0)} /></span></div>
                    <div><span className="etiqueta">Te deben</span><span className="cifra debe"><Numero valor={gente.reduce((t, g) => t + g.debe, 0)} /></span></div>
                    <div><span className="etiqueta">Filamento gastado</span><span className="cifra"><Numero valor={gente.reduce((t, g) => t + g.gramos, 0)} formato={gramos} /></span></div>
                  </div>
                )}
                <div className="gente">
                  {gente.map((g, i) => (
                    <motion.button key={g.clave} className="persona" onClick={() => ir("gente/" + encodeURIComponent(g.clave))} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.4, ease }} whileHover={{ y: -3 }}>
                      <motion.div layoutId={`av-${g.clave}`}><Avatar nombre={g.nombre} size={46} /></motion.div>
                      <div className="persona-txt">
                        <strong>{g.nombre}</strong>
                        <span>{g.pedidos.length} pedido{g.pedidos.length === 1 ? "" : "s"} · {hace(g.ultimo)}</span>
                        <Barra fraccion={(g.gastado + g.enCola) / max} />
                      </div>
                      <div className="persona-cifras">
                        <span className="num">{eur(g.gastado)}</span>
                        {g.debe > 0 ? <small className="sin-pagar">debe {eur(g.debe)}</small> : g.enCola > 0 ? <small>{eur(g.enCola)} en cola</small> : null}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
