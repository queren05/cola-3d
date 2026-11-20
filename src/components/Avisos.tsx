import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { hace } from "../lib/formato";
import { useDatos } from "../lib/store";

/** campana con tus avisos: tu pieza se imprime, te comentan, el taller responde a tu idea… */
export function Campana({ abrir }: { abrir: (id: string) => void }) {
  const { api, datos, recargar, sesion } = useDatos();
  const [abierto, setAbierto] = useState(false);
  const [permiso, setPermiso] = useState(() => (typeof Notification === "undefined" ? "denied" : Notification.permission));
  const caja = useRef<HTMLDivElement>(null);
  const avisos = datos.avisos || [];
  const sinLeer = avisos.filter((a) => !a.leido).length;
  const vistos = useRef<Set<string> | null>(null);

  // aviso del navegador cuando llega uno nuevo y la web está en segundo plano
  useEffect(() => {
    const ids = new Set(avisos.map((a) => a.id));
    if (vistos.current && permiso === "granted" && document.visibilityState !== "visible") {
      for (const a of avisos) if (!a.leido && !vistos.current.has(a.id)) new Notification("Cola 3D", { body: a.texto, icon: "icono-180.png", tag: a.id });
    }
    vistos.current = ids;
  }, [avisos, permiso]);

  useEffect(() => {
    if (!abierto) return;
    const f = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [abierto]);

  if (!sesion || !api.leerAvisos) return null;

  async function abrirCampana() {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo && sinLeer) {
      await api.leerAvisos?.().catch(() => {});
      recargar();
    }
  }
  return (
    <div className="campana" ref={caja}>
      <button className="tema-btn" onClick={abrirCampana} aria-label={sinLeer ? `${sinLeer} avisos sin leer` : "Avisos"} aria-expanded={abierto}>
        <motion.svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          animate={sinLeer ? { rotate: [0, -14, 12, -8, 6, 0] } : {}} transition={{ duration: 0.8, repeat: sinLeer ? Infinity : 0, repeatDelay: 4 }}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </motion.svg>
        <AnimatePresence>{sinLeer > 0 && <motion.span className="insignia num campana-num" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>{sinLeer}</motion.span>}</AnimatePresence>
      </button>
      <AnimatePresence>
        {abierto && (
          <motion.div className="tema-pop campana-pop" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.16 }}>
            <span className="listas-tit">Avisos</span>
            {avisos.length === 0 ? (
              <p className="campana-vacia">Aquí te avisaré cuando tu pieza se imprima, te comenten o el taller te responda.</p>
            ) : (
              <div className="campana-lista">
                {avisos.map((a) => (
                  <button key={a.id} className={a.leido ? "" : "nuevo"} onClick={() => { setAbierto(false); if (a.pedido_id) abrir(a.pedido_id); }}>
                    <span className="campana-txt">{a.texto}</span>
                    <small>{hace(a.creado)}</small>
                  </button>
                ))}
              </div>
            )}
            {permiso === "default" && typeof Notification !== "undefined" && (
              <button className="boton campana-permiso" onClick={async () => setPermiso(await Notification.requestPermission())}>Avisarme también en este navegador</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
