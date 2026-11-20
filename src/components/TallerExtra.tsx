import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { duracion, eur, gramos, n1 } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Pedido } from "../lib/types";
import { Muestra } from "./Piezas";

const delTaller = (p: Pedido) => !!(p.coste_detalle as { taller?: boolean } | undefined)?.taller;
const enCola = (p: Pedido) => (p.estado === "pendiente" && !p.peticion) || p.estado === "imprimiendo";

/** cuánto trabajo hay en cola y qué pedidos van juntos (mismos rollos = menos cambios de carrete) */
export function Plan() {
  const { datos } = useDatos();
  const [horas, setHoras] = useState(() => {
    try { return Number(localStorage.getItem("cola3d-horas-dia")) || 8; } catch { return 8; }
  });
  const cola = datos.pedidos.filter(enCola);
  const min = cola.reduce((t, p) => t + (p.minutos || 0) * Math.max(1, p.copias || 1), 0);
  const grupos = useMemo(() => {
    const m = new Map<string, { nombres: { nombre: string; color: string }[]; n: number; min: number; g: number }>();
    for (const p of cola) {
      const ls = p.lineas.filter((l) => l.gramos > 0);
      const k = ls.map((l) => l.filamento_id || "?" + l.color).sort().join("+");
      const x = m.get(k) ?? { nombres: ls.map((l) => ({ nombre: l.filamento_id ? l.nombre : "Lo elige el taller", color: l.color })), n: 0, min: 0, g: 0 };
      x.n++;
      x.min += (p.minutos || 0) * Math.max(1, p.copias || 1);
      x.g += p.coste_detalle?.gramos || 0;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || b.min - a.min);
  }, [cola]);
  return (
    <section className="panel plan">
      <h2>Plan de impresión</h2>
      <div className="cifras">
        <div><span className="etiqueta">En cola</span><span className="cifra num">{cola.length}</span></div>
        <div><span className="etiqueta">Tiempo de impresora</span><span className="cifra num">{duracion(min) || "0 min"}</span></div>
        <div>
          <span className="etiqueta">Al ritmo de</span>
          <span className="cifra num plan-ritmo">
            <input type="number" min={1} max={24} value={horas} aria-label="Horas al día" onChange={(e) => { const v = Math.min(24, Math.max(1, Number(e.target.value) || 1)); setHoras(v); try { localStorage.setItem("cola3d-horas-dia", String(v)); } catch { /* */ } }} />
            h/día
          </span>
        </div>
        <div><span className="etiqueta">Terminas en</span><span className="cifra num">{min ? `${n1(min / 60 / horas)} días` : "—"}</span></div>
      </div>
      {grupos.length > 1 && (
        <>
          <span className="etiqueta">Imprime juntos los que usan los mismos rollos</span>
          <div className="plan-grupos">
            {grupos.map((g, i) => (
              <motion.div key={i} className="plan-grupo" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <span className="plan-rollos">
                  {g.nombres.map((x, j) => (
                    <span key={j}><Muestra color={x.color} size={12} /> {x.nombre}</span>
                  ))}
                </span>
                <span className="plan-dato num">{g.n} {g.n === 1 ? "pedido" : "pedidos"} · {duracion(g.min) || "—"} · {gramos(g.g)}</span>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** rollos que no llegan para lo que hay en cola */
export function Faltan() {
  const { datos } = useDatos();
  const necesita = new Map<string, number>();
  for (const p of datos.pedidos.filter(enCola)) {
    const extra = 1 + (p.coste_detalle?.merma_pct || 0) / 100;
    for (const l of p.lineas) if (l.filamento_id) necesita.set(l.filamento_id, (necesita.get(l.filamento_id) || 0) + l.gramos * Math.max(1, p.copias || 1) * extra);
  }
  const faltan = datos.filamentos
    .map((f) => ({ f, hace: Math.round(necesita.get(f.id) || 0), hay: Math.round(f.stock_g) }))
    .filter((x) => x.hace > x.hay)
    .sort((a, b) => b.hace - b.hay - (a.hace - a.hay));
  return (
    <section className={`panel faltan${faltan.length ? " hay" : ""}`}>
      <h2>Rollos para la cola</h2>
      {faltan.length === 0 ? (
        <p className="comprobar-txt">✓ Tienes filamento de sobra para todo lo que hay en cola.</p>
      ) : (
        faltan.map(({ f, hace, hay }) => (
          <div key={f.id} className="falta-fila">
            <Muestra color={f.color} size={22} />
            <div className="falta-txt">
              <strong>Te falta {f.nombre}</strong>
              <span>La cola necesita {gramos(hace)} y quedan {gramos(hay)} (faltan {gramos(hace - hay)})</span>
            </div>
            <a className="boton" href={`https://eu.store.bambulab.com/search?q=${encodeURIComponent(`${f.material} ${f.nombre}`)}`} target="_blank" rel="noopener noreferrer">Comprar</a>
          </div>
        ))
      )}
    </section>
  );
}

/** lo que has cobrado, lo que te debe la gente, lo que te ha costado el filamento de verdad y lo que ganas */
export function Rentabilidad() {
  const { datos } = useDatos();
  const real = datos.ajustes.coste_real_kg ?? 12;
  const cuenta = useMemo(() => datos.pedidos.filter((p) => p.estado !== "cancelado" && !delTaller(p) && p.coste > 0), [datos.pedidos]);
  // coste real: el filamento de lo que ya se ha impreso (o se está imprimiendo)
  const costeDe = (p: Pedido) => ((p.coste_detalle?.gramos || 0) * real) / 1000 + (p.coste_detalle?.luz || 0);
  const hechos = cuenta.filter((p) => p.estado === "impreso" || p.estado === "entregado" || p.estado === "imprimiendo");
  const cobrado = cuenta.filter((p) => p.pagado).reduce((t, p) => t + p.coste, 0);
  const porCobrar = hechos.filter((p) => !p.pagado).reduce((t, p) => t + p.coste, 0);
  const coste = hechos.reduce((t, p) => t + costeDe(p), 0);
  const beneficio = cobrado + porCobrar - coste;

  const meses = useMemo(() => {
    const m = new Map<string, { ingresos: number; coste: number }>();
    for (const p of hechos) {
      const k = p.creado.slice(0, 7);
      const x = m.get(k) ?? { ingresos: 0, coste: 0 };
      x.ingresos += p.coste;
      x.coste += costeDe(p);
      m.set(k, x);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  }, [hechos]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(0.01, ...meses.map(([, x]) => Math.max(x.ingresos, x.coste)));
  const nombreMes = (k: string) => new Date(k + "-01T12:00:00").toLocaleDateString("es-ES", { month: "short" });
  const ultimas = [...hechos].sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, 6);

  return (
    <section className="panel rentab">
      <h2>Cuentas del taller</h2>
      <div className="cifras">
        <div><span className="etiqueta">Cobrado</span><span className="cifra num">{eur(cobrado)}</span></div>
        <div><span className="etiqueta">Por cobrar</span><span className={`cifra num${porCobrar > 0 ? " debe" : ""}`}>{eur(porCobrar)}</span></div>
        <div><span className="etiqueta">Coste real</span><span className="cifra num">{eur(coste)}</span></div>
        <div><span className="etiqueta">Beneficio</span><span className={`cifra num ${beneficio >= 0 ? "gana" : "debe"}`}>{eur(beneficio)}</span></div>
      </div>

      {ultimas.length > 0 && (
        <div className="pieza-cuentas">
          <span className="etiqueta">Pieza a pieza</span>
          {ultimas.map((p) => {
            const c = costeDe(p), g = p.coste - c;
            return (
              <div key={p.id} className="pc-fila">
                <span className="pc-tit">{p.titulo || "Pieza"} <small>· {p.nombre}</small></span>
                <span className="pc-barra" aria-hidden="true">
                  <span className="pc-coste" style={{ width: `${Math.min(100, (c / Math.max(p.coste, c, 0.01)) * 100)}%` }} />
                </span>
                <span className="num pc-num">{eur(p.coste)}</span>
                <span className={`num pc-num ${g >= 0 ? "gana" : "debe"}`}>{g >= 0 ? "+" : ""}{eur(g)}</span>
              </div>
            );
          })}
          <span className="pc-leyenda"><i className="l-coste" /> lo que te cuesta · el resto es lo que ganas</span>
        </div>
      )}

      {meses.length >= 2 && (
        <div className="barras" role="img" aria-label="Ingresos y coste por mes">
          {meses.map(([k, x]) => (
            <div key={k} className="barra-mes" title={`${nombreMes(k)}: ingresos ${eur(x.ingresos)} · coste ${eur(x.coste)}`}>
              <span className="barra-valor num">{eur(x.ingresos - x.coste)}</span>
              <div className="barra-par">
                <motion.span className="barra-col" initial={{ height: 0 }} animate={{ height: `${(x.ingresos / max) * 100}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                <motion.span className="barra-col coste" initial={{ height: 0 }} animate={{ height: `${(x.coste / max) * 100}%` }} transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <span className="barra-mes-txt">{nombreMes(k)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="comprobar-txt">Coste real = filamento a {eur(real)}/kg (lo cambias en Precios) + la luz.</p>
    </section>
  );
}
