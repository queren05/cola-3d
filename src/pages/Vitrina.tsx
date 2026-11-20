import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { IVitrina } from "../components/Iconos";
import { Portada } from "../components/Pedido";
import { Avatar, Numero, Vacio } from "../components/Piezas";
import { gramos, hace, n1 } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Pedido } from "../lib/types";

const ease = [0.22, 1, 0.36, 1] as const;

/** cuándo se terminó de imprimir (o la última vez que se tocó) */
const cuando = (p: Pedido) => [...(p.historial || [])].reverse().find((h) => h.estado === "impreso")?.fecha || p.actualizado || p.creado;

/** todo lo que ha salido de la impresora, con las fotos de cómo ha quedado */
export function Vitrina({ abrir }: { abrir: (id: string) => void }) {
  const { datos, cargado } = useDatos();
  const [soloFotos, setSoloFotos] = useState(false);
  const hechas = useMemo(
    () => datos.pedidos.filter((p) => p.estado === "impreso" || p.estado === "entregado").sort((a, b) => cuando(b).localeCompare(cuando(a))),
    [datos.pedidos],
  );
  const lista = soloFotos ? hechas.filter((p) => p.fotos?.length) : hechas;
  const g = hechas.reduce((t, p) => t + (p.coste_detalle?.gramos || 0), 0);
  const horas = hechas.reduce((t, p) => t + (p.minutos || 0) * Math.max(1, p.copias || 1), 0) / 60;
  const fotos = hechas.reduce((t, p) => t + (p.fotos?.length || 0), 0);

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <span className="sobretitulo">Lo que ha salido de la impresora</span>
        <h1>Vitrina</h1>
      </header>

      {hechas.length > 0 && (
        <div className="cifras">
          <div><span className="etiqueta">Piezas</span><span className="cifra"><Numero valor={hechas.reduce((t, p) => t + Math.max(1, p.copias || 1), 0)} formato={(v) => String(Math.round(v))} /></span></div>
          <div><span className="etiqueta">Filamento</span><span className="cifra"><Numero valor={g} formato={gramos} /></span></div>
          <div><span className="etiqueta">Imprimiendo</span><span className="cifra"><Numero valor={horas} formato={(v) => `${n1(v)} h`} /></span></div>
          <div><span className="etiqueta">Fotos</span><span className="cifra"><Numero valor={fotos} formato={(v) => String(Math.round(v))} /></span></div>
        </div>
      )}

      {hechas.length > 0 && (
        <div className="filtros" role="tablist">
          {[{ v: false, t: "Todas" }, { v: true, t: "Con foto" }].map((f) => (
            <button key={String(f.v)} className={soloFotos === f.v ? "activo" : ""} onClick={() => setSoloFotos(f.v)} role="tab" aria-selected={soloFotos === f.v}>
              {soloFotos === f.v && <motion.span layoutId="vitrina-filtro" className="filtro-fondo" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
              <span>{f.t}</span>
            </button>
          ))}
        </div>
      )}

      {!cargado ? null : lista.length === 0 ? (
        <Vacio titulo={hechas.length ? "Todavía no hay fotos" : "Aún no se ha impreso nada"} icono={<IVitrina width={48} height={48} />} />
      ) : (
        <motion.div className="vitrina" layout>
          <AnimatePresence initial={true}>
            {lista.map((p, i) => (
              <motion.button
                key={p.id}
                layout
                className="vitrina-pieza"
                onClick={() => abrir(p.id)}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ delay: Math.min(i * 0.05, 0.5), duration: 0.5, ease }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className={`vitrina-foto${p.fotos?.length ? "" : " sin-foto"}`}>
                  <Portada p={p} />
                  {(p.fotos?.length || 0) > 1 && <span className="vitrina-num">{p.fotos!.length} fotos</span>}
                  {!p.fotos?.length && <span className="vitrina-modelo">Foto del modelo</span>}
                </div>
                <div className="vitrina-txt">
                  <strong>{p.titulo || "Pieza"}</strong>
                  <span>
                    <Avatar nombre={p.nombre} size={18} /> {p.nombre} · {hace(cuando(p))}
                    {p.copias > 1 ? ` · ${p.copias} copias` : ""}
                  </span>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
