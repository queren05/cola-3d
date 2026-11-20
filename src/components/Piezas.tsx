import { animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { colorPersona, eur, tintaSobre } from "../lib/formato";
import type { Estado } from "../lib/types";
import { estadoLabel } from "../lib/types";

/** número que sube o baja rodando hasta su valor */
export function Numero({ valor, formato = eur }: { valor: number; formato?: (v: number) => string }) {
  const reducir = useReducedMotion();
  const mv = useMotionValue(valor);
  const [txt, setTxt] = useState(formato(valor));
  useEffect(() => {
    if (reducir) {
      setTxt(formato(valor));
      return;
    }
    const c = animate(mv, valor, { duration: 0.55, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setTxt(formato(v)) });
    return () => c.stop();
  }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="num">{txt}</span>;
}

/** bobina de filamento: el anillo exterior es lo que queda */
export function Bobina({ color, fraccion, size = 64, girar = false }: { color: string; fraccion: number; size?: number; girar?: boolean }) {
  const f = Math.min(1, Math.max(0, fraccion));
  const r = 26, c = 2 * Math.PI * r;
  return (
    <motion.svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" animate={girar ? { rotate: 360 } : undefined} transition={girar ? { repeat: Infinity, duration: 6, ease: "linear" } : undefined}>
      <circle cx="32" cy="32" r="30" fill="var(--spool)" stroke="var(--swatch-ring)" strokeWidth=".8" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--spool-track)" strokeWidth="9" />
      <motion.circle
        cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="butt"
        transform="rotate(-90 32 32)"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - f) }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
      {/* borde fino del hilo: así se ve también un filamento negro sobre fondo oscuro (o blanco sobre claro) */}
      {[r + 4.5, r - 4.5].map((rr) => (
        <motion.circle
          key={rr}
          cx="32" cy="32" r={rr} fill="none" stroke="var(--swatch-ring)" strokeWidth=".9"
          transform="rotate(-90 32 32)"
          strokeDasharray={2 * Math.PI * rr}
          initial={{ strokeDashoffset: 2 * Math.PI * rr }}
          animate={{ strokeDashoffset: 2 * Math.PI * rr * (1 - f) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
      {/* líneas del hilo enrollado */}
      <circle cx="32" cy="32" r={r - 2.5} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth=".8" strokeDasharray={f > 0 ? "2 2" : "0"} />
      <circle cx="32" cy="32" r="12" fill="var(--spool-hub)" />
      <circle cx="32" cy="32" r="5" fill="var(--bg)" />
      {[0, 120, 240].map((a) => (
        <rect key={a} x="30.5" y="21" width="3" height="5" rx="1" fill="var(--bg)" transform={`rotate(${a} 32 32)`} />
      ))}
    </motion.svg>
  );
}

const COLORES_ESTADO: Record<Estado, string> = {
  pendiente: "var(--st-pendiente)",
  imprimiendo: "var(--st-imprimiendo)",
  impreso: "var(--st-impreso)",
  entregado: "var(--st-entregado)",
  cancelado: "var(--st-cancelado)",
};
export const colorEstado = (e: Estado) => COLORES_ESTADO[e];

export function Chip({ estado }: { estado: Estado }) {
  return (
    <motion.span layout="position" className="chip" style={{ ["--c" as string]: colorEstado(estado) }}>
      {estado === "imprimiendo" ? <span className="pulso" /> : <span className="punto" />}
      {estadoLabel(estado)}
    </motion.span>
  );
}

export function Avatar({ nombre, size = 36 }: { nombre: string; size?: number }) {
  const bg = colorPersona(nombre);
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }}>
      {(nombre.trim()[0] || "?").toUpperCase()}
    </span>
  );
}

export function Muestra({ color, size = 14, borde = true }: { color: string; size?: number; borde?: boolean }) {
  return <span className="muestra" style={{ width: size, height: size, background: color || "var(--line)", boxShadow: borde ? "inset 0 0 0 1px var(--swatch-ring)" : undefined }} />;
}

export function EtiquetaColor({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span className="etq-color" style={{ background: color || "var(--line)", color: tintaSobre(color || "#ddd") }}>
      {nombre}
    </span>
  );
}

/** impresora dibujando capas: pieza que crece y boquilla que va y viene */
export function Impresora({ size = 56 }: { size?: number }) {
  // cada capa se imprime en una pasada: las pares de izquierda a derecha y las impares de vuelta;
  // la boquilla va justo encima, en el borde por el que crece la capa. Al final todo se desvanece suave
  const N = 6, CICLO = 7.2, PASADA = 0.1;
  const inicio = (i: number) => 0.06 + i * 0.12;
  const izq = -10, der = 10; // la capa va de x=18 a x=38 y la punta de la boquilla está en x=28
  const xs: number[] = [izq], ys: number[] = [0], ts: number[] = [0];
  for (let i = 0; i < N; i++) {
    const [desde, hasta] = i % 2 ? [der, izq] : [izq, der];
    xs.push(desde, hasta);
    ys.push(-3.2 * i, -3.2 * i);
    ts.push(inicio(i), inicio(i) + PASADA);
  }
  xs.push(xs[xs.length - 1], izq, izq);
  ys.push(ys[ys.length - 1], 0, 0);
  ts.push(0.86, 0.97, 1);
  return (
    <svg className="impresora" width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
      <rect x="6" y="6" width="44" height="44" rx="7" fill="none" stroke="currentColor" strokeWidth="2.2" opacity=".35" />
      <rect x="10" y="42" width="36" height="3" rx="1.5" fill="currentColor" opacity=".5" />
      <g>
        {Array.from({ length: N }).map((_, i) => (
          <motion.rect
            key={i}
            x="18"
            y={38 - i * 3.2}
            width="20"
            height="2.6"
            rx="1"
            fill="var(--hot)"
            style={{ transformBox: "fill-box", transformOrigin: i % 2 ? "right center" : "left center" }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: [0, 0, 1, 1, 1], opacity: [0, 1, 1, 1, 0] }}
            transition={{ duration: CICLO, times: [0, inicio(i), inicio(i) + PASADA, 0.86, 0.97], ease: "linear", repeat: Infinity }}
          />
        ))}
      </g>
      <motion.g animate={{ x: xs, y: ys }} transition={{ duration: CICLO, times: ts, ease: "linear", repeat: Infinity }}>
        <rect x="23" y="27.5" width="10" height="6" rx="1.8" fill="currentColor" />
        <path d="M26.5 33.5h3l-1.5 2.6z" fill="currentColor" />
      </motion.g>
    </svg>
  );
}

export function Vacio({ titulo, children, icono }: { titulo: string; children?: ReactNode; icono?: ReactNode }) {
  return (
    <motion.div className="vacio" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {icono}
      <strong>{titulo}</strong>
      {children}
    </motion.div>
  );
}

/** barra que se llena hasta su valor */
export function Barra({ fraccion, color = "var(--hot)" }: { fraccion: number; color?: string }) {
  return (
    <div className="barra">
      <motion.div className="barra-relleno" style={{ background: color }} initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, Math.max(0, fraccion)) }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}

/** campo de contraseña con botón para verla mientras se escribe */
export function ClaveInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [ver, setVer] = useState(false);
  return (
    <span className="clave-input">
      <input {...props} type={ver ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      <button type="button" className="clave-ojo" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseña" : "Ver contraseña"} aria-pressed={ver}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          <motion.path d="M4 4l16 16" initial={false} animate={{ opacity: ver ? 0 : 1, scale: ver ? 0.6 : 1 }} transition={{ duration: 0.25 }} />
        </svg>
      </button>
    </span>
  );
}
