import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Tema = "auto" | "light" | "dark";

function leer(): Tema {
  try {
    const t = localStorage.getItem("cola3d-tema");
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

function aplicar(t: Tema) {
  const html = document.documentElement;
  if (t === "auto") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", t);
  const oscuro = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (t === "auto") m.setAttribute("content", m.getAttribute("media")?.includes("dark") ? "#0d1013" : "#eceff3");
    else m.setAttribute("content", oscuro ? "#0d1013" : "#eceff3");
  });
  try {
    if (t === "auto") localStorage.removeItem("cola3d-tema");
    else localStorage.setItem("cola3d-tema", t);
  } catch {
    /* sin almacenamiento: vale solo para esta visita */
  }
}

const Sol = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </svg>
);
const Luna = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);
const Auto = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
  </svg>
);

const OPCIONES: { id: Tema; label: string; Icono: () => JSX.Element }[] = [
  { id: "auto", label: "Como el móvil", Icono: Auto },
  { id: "light", label: "Claro", Icono: Sol },
  { id: "dark", label: "Oscuro", Icono: Luna },
];

/** botón de arriba: claro, oscuro o como el móvil */
export function BotonTema() {
  const [tema, setTema] = useState<Tema>(leer);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const [oscuroSistema, setOscuroSistema] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => setOscuroSistema(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  useEffect(() => {
    if (!abierto) return;
    const f = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", f);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", f);
      document.removeEventListener("keydown", k);
    };
  }, [abierto]);

  function elegir(t: Tema) {
    // transición suave de colores solo durante el cambio
    document.documentElement.classList.add("cambiando-tema");
    aplicar(t);
    setTema(t);
    setAbierto(false);
    setTimeout(() => document.documentElement.classList.remove("cambiando-tema"), 400);
  }

  const oscuro = tema === "dark" || (tema === "auto" && oscuroSistema);
  return (
    <div className="tema" ref={caja}>
      <button className="tema-btn" onClick={() => setAbierto((v) => !v)} aria-label="Modo claro u oscuro" aria-expanded={abierto} title="Modo claro u oscuro">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={oscuro ? "luna" : "sol"} initial={{ rotate: -90, scale: 0.4, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.4, opacity: 0 }} transition={{ duration: 0.25 }} style={{ display: "grid" }}>
            {oscuro ? <Luna /> : <Sol />}
          </motion.span>
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {abierto && (
          <motion.div className="tema-pop" role="menu" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.16 }}>
            {OPCIONES.map(({ id, label, Icono }) => (
              <button key={id} role="menuitemradio" aria-checked={tema === id} className={tema === id ? "activo" : ""} onClick={() => elegir(id)}>
                <Icono />
                <span>{label}</span>
                {tema === id && <span className="tema-check">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
