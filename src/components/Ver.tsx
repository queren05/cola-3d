import { motion } from "framer-motion";
import { useState } from "react";

export type Vista = "lista" | "grande" | "pequena";

/** cómo se ven las fichas (se recuerda en este navegador) */
export function useVista(clave: string, porDefecto: Vista = "grande"): [Vista, (v: Vista) => void] {
  const [v, setV] = useState<Vista>(() => {
    try {
      const x = localStorage.getItem("cola3d-ver-" + clave);
      return x === "lista" || x === "grande" || x === "pequena" ? x : porDefecto;
    } catch {
      return porDefecto;
    }
  });
  return [
    v,
    (n) => {
      setV(n);
      try {
        localStorage.setItem("cola3d-ver-" + clave, n);
      } catch {
        /* sin almacenamiento */
      }
    },
  ];
}

const ICONOS: Record<Vista, JSX.Element> = {
  lista: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="5.5" rx="1.6" fill="currentColor" /><rect x="4" y="13.5" width="16" height="5.5" rx="1.6" fill="currentColor" /></svg>
  ),
  grande: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.6" fill="currentColor" /><rect x="13" y="4" width="7" height="7" rx="1.6" fill="currentColor" /><rect x="4" y="13" width="7" height="7" rx="1.6" fill="currentColor" /><rect x="13" y="13" width="7" height="7" rx="1.6" fill="currentColor" /></svg>
  ),
  pequena: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {[4, 10, 16].flatMap((y) => [4, 10, 16].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="4.4" height="4.4" rx="1.1" fill="currentColor" />))}
    </svg>
  ),
};
const NOMBRES: Record<Vista, string> = { lista: "En lista", grande: "Cuadrícula grande", pequena: "Cuadrícula pequeña" };

export function SelectorVista({ valor, onCambio, id }: { valor: Vista; onCambio: (v: Vista) => void; id: string }) {
  return (
    <div className="ver" role="radiogroup" aria-label="Cómo se ven las fichas">
      <span className="ver-txt">Ver:</span>
      {(["lista", "grande", "pequena"] as Vista[]).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={valor === v} aria-label={NOMBRES[v]} title={NOMBRES[v]} className={valor === v ? "activo" : ""} onClick={() => onCambio(v)}>
          {valor === v && <motion.span layoutId={"ver-" + id} className="ver-fondo" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          <span className="ver-ico">{ICONOS[v]}</span>
        </button>
      ))}
    </div>
  );
}
