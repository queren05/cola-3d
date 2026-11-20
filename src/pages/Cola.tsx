import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { IPedir } from "../components/Iconos";
import { Impresora, Numero, Vacio } from "../components/Piezas";
import { TarjetaPedido } from "../components/Pedido";
import { clave, gramos, n0 } from "../lib/formato";
import { useDatos } from "../lib/store";
import { SelectorVista, useVista } from "../components/Ver";
import { acumula } from "../lib/coste";
import type { Ajustes, Pedido } from "../lib/types";

type Filtro = "cola" | "hechos" | "mios" | "todos";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "cola", label: "En cola" },
  { id: "hechos", label: "Impresos" },
  { id: "mios", label: "Los míos" },
  { id: "todos", label: "Todos" },
];

/** orden de la cola: lo que se imprime, luego pendientes */
export function ordenCola(ps: Pedido[], a?: Ajustes) {
  const imp = ps.filter((p) => p.estado === "imprimiendo").sort((x, y) => x.creado.localeCompare(y.creado));
  // pendientes: primero los listos para imprimir (pagados o con deuda tan pequeña que se acumula), luego por llegada
  const listo = (p: Pedido) => p.pagado || (!!a && acumula(p, ps, a));
  const pen = ps
    .filter((p) => p.estado === "pendiente")
    .sort((x, y) => Number(!!x.peticion) - Number(!!y.peticion) || (y.prioridad || 0) - (x.prioridad || 0) || Number(listo(y)) - Number(listo(x)) || x.creado.localeCompare(y.creado));
  return [...imp, ...pen];
}

export function Cola({ abrir, ir }: { abrir: (id: string) => void; ir: (r: string) => void }) {
  const { datos, cargado, yo, tokens, resaltado, setResaltado, error, esMio } = useDatos();
  const [filtro, setFiltro] = useState<Filtro>(() => {
    try {
      return (sessionStorage.getItem("cola3d-filtro") as Filtro) || "cola";
    } catch {
      return "cola";
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem("cola3d-filtro", filtro);
    } catch {}
  }, [filtro]);
  useEffect(() => {
    if (!resaltado) return;
    setFiltro("cola");
    const t = setTimeout(() => setResaltado(null), 2600);
    return () => clearTimeout(t);
  }, [resaltado, setResaltado]);

  const [ver, setVer] = useVista("cola");
  const cola = useMemo(() => ordenCola(datos.pedidos, datos.ajustes), [datos.pedidos, datos.ajustes]);
  const posiciones = useMemo(() => {
    const m = new Map<string, number>();
    cola.filter((p) => p.estado === "pendiente" && !p.peticion).forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [cola]);

  const lista = useMemo(() => {
    const porFecha = (a: Pedido, b: Pedido) => b.actualizado.localeCompare(a.actualizado);
    switch (filtro) {
      case "cola":
        return cola;
      case "hechos":
        return datos.pedidos.filter((p) => p.estado === "impreso" || p.estado === "entregado").sort(porFecha);
      case "mios":
        return [...datos.pedidos].filter(esMio).sort((a, b) => b.creado.localeCompare(a.creado));
      default:
        return [...datos.pedidos].sort((a, b) => b.creado.localeCompare(a.creado));
    }
  }, [filtro, cola, datos.pedidos, tokens, yo]); // eslint-disable-line react-hooks/exhaustive-deps

  const imprimiendo = cola.filter((p) => p.estado === "imprimiendo");
  const enCola = cola.filter((p) => p.estado === "pendiente");
  const gCola = cola.reduce((t, p) => t + (p.coste_detalle?.gramos || 0), 0);
  const minCola = cola.reduce((t, p) => t + p.minutos * p.copias, 0);

  return (
    <div className="pagina">
      <section className="portada-cola">
        <div className="pc-texto">
          <span className="sobretitulo">Taller de impresión 3D</span>
          <h1>
            La cola
            <span className="h1-capas" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </h1>
          <button className="boton primario grande" onClick={() => ir("pedir")}>
            <IPedir width={20} height={20} /> Pedir una figura
          </button>
        </div>
        <div className="pc-datos">
          <div className={`dato dato-imprimiendo${imprimiendo.length ? " activo" : ""}`}>
            {imprimiendo.length ? <Impresora size={46} /> : null}
            <div>
              <span className="dato-v num">{imprimiendo.length ? imprimiendo[0].titulo || "Una figura" : "Libre"}</span>
              <span className="dato-l">{imprimiendo.length ? `Imprimiendo para ${imprimiendo[0].nombre}` : "Impresora"}</span>
            </div>
          </div>
          <div className="dato">
            <span className="dato-v"><Numero valor={enCola.length} formato={n0} /></span>
            <span className="dato-l">En espera</span>
          </div>
          <div className="dato">
            <span className="dato-v"><Numero valor={gCola} formato={gramos} /></span>
            <span className="dato-l">Filamento en cola</span>
          </div>
          <div className="dato">
            <span className="dato-v num">{minCola ? `${Math.round(minCola / 60)} h` : "—"}</span>
            <span className="dato-l">De impresión</span>
          </div>
        </div>
      </section>

      <div className="barra-filtros">
        <div className="filtros" role="tablist" aria-label="Qué pedidos ver">
        {FILTROS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filtro === f.id} className={filtro === f.id ? "activo" : ""} onClick={() => setFiltro(f.id)}>
            {filtro === f.id && <motion.span layoutId="filtro-fondo" className="filtro-fondo" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <span>{f.label}</span>
          </button>
        ))}
      </div>
        <SelectorVista valor={ver} onCambio={setVer} id="cola" />
      </div>

      {error && <div className="aviso-error">{error}</div>}

      {!cargado ? (
        <div className="rejilla">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tarjeta esqueleto" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <Vacio titulo={filtro === "cola" ? "No hay nada en cola" : filtro === "mios" ? "Todavía no has pedido nada" : "Aquí no hay nada todavía"} icono={<Impresora size={64} />}>
          {filtro !== "hechos" && (
            <button className="boton primario" onClick={() => ir("pedir")}>
              Pedir una figura
            </button>
          )}
        </Vacio>
      ) : (
        <LayoutGroup>
          <motion.div className={`rejilla v-${ver}`} layout>
            <AnimatePresence mode="popLayout">
              {lista.map((p) => (
                <TarjetaPedido key={p.id} p={p} posicion={posiciones.get(p.id) ?? null} onAbrir={() => abrir(p.id)} mio={esMio(p)} resaltar={resaltado === p.id} />
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      )}
    </div>
  );
}
