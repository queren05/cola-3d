import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { IBobina, ICola, IGente, IPedir, ITaller } from "./components/Iconos";
import { DetallePedido } from "./components/Pedido";
import { Cola } from "./pages/Cola";
import { Filamentos } from "./pages/Filamentos";
import { Gente } from "./pages/Gente";
import { Pedir } from "./pages/Pedir";
import { Taller } from "./pages/Taller";
import { useDatos, useRuta } from "./lib/store";

const SECCIONES = [
  { id: "", label: "Cola", Icono: ICola },
  { id: "pedir", label: "Pedir", Icono: IPedir },
  { id: "filamentos", label: "Filamentos", Icono: IBobina },
  { id: "gente", label: "Gente", Icono: IGente },
  { id: "taller", label: "Taller", Icono: ITaller },
];

export default function App() {
  const [ruta, ir] = useRuta();
  const { datos, toasts, api, esAdmin, sesion, api: { cuentas } } = useDatos();
  const seccion = SECCIONES.some((s) => s.id === ruta[0]) ? ruta[0] : "";
  const [abierto, setAbierto] = useState<string | null>(null);
  const abiertoRef = useRef<string | null>(null);
  abiertoRef.current = abierto;

  // la ficha abierta ocupa una entrada del historial: el botón atrás del móvil la cierra
  const abrir = useCallback((id: string) => {
    history.pushState({ ficha: id }, "");
    setAbierto(id);
  }, []);
  const cerrar = useCallback(() => {
    if (history.state?.ficha) history.back();
    else setAbierto(null);
  }, []);
  useEffect(() => {
    const f = () => abiertoRef.current && setAbierto(null);
    window.addEventListener("popstate", f);
    return () => window.removeEventListener("popstate", f);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [seccion]);

  const pedido = abierto ? datos.pedidos.find((p) => p.id === abierto) : undefined;
  const pendientes = datos.pedidos.filter((p) => p.estado === "pendiente").length;

  let pagina;
  switch (seccion) {
    case "pedir":
      pagina = <Pedir ir={ir} />;
      break;
    case "filamentos":
      pagina = <Filamentos />;
      break;
    case "gente":
      pagina = <Gente persona={ruta[1]} ir={ir} abrir={abrir} />;
      break;
    case "taller":
      pagina = <Taller />;
      break;
    default:
      pagina = <Cola abrir={abrir} ir={ir} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <header className="barra-top">
          <div className="barra-top-in">
            <button className="marca" onClick={() => ir("")} aria-label="Ir a la cola">
              <span className="marca-logo" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>Cola 3D</span>
            </button>
            <nav className="nav-escritorio" aria-label="Secciones">
              {SECCIONES.map((s) => (
                <button key={s.id} className={seccion === s.id ? "activo" : ""} onClick={() => ir(s.id)} aria-current={seccion === s.id ? "page" : undefined}>
                  {seccion === s.id && <motion.span layoutId="nav-fondo" className="nav-fondo" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
                  <span>{s.label}</span>
                  {s.id === "" && pendientes > 0 && <span className="insignia num">{pendientes}</span>}
                </button>
              ))}
            </nav>
            <div className="barra-estado">
              {api.modo === "local" && <span className="modo-prueba" title="Los pedidos se guardan solo en este navegador">Modo prueba</span>}
              {esAdmin && <span className="modo-taller">Taller</span>}
              {cuentas && sesion && <span className="quien">{sesion.nombre}</span>}
            </div>
          </div>
        </header>

        <main>
          <AnimatePresence mode="wait">
            <motion.div key={seccion} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              {pagina}
            </motion.div>
          </AnimatePresence>
        </main>

        <nav className="nav-movil" aria-label="Secciones">
          {SECCIONES.map(({ id, label, Icono }) => (
            <button key={id} className={seccion === id ? "activo" : ""} onClick={() => ir(id)} aria-current={seccion === id ? "page" : undefined}>
              {seccion === id && <motion.span layoutId="nav-movil-fondo" className="nav-movil-fondo" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
              <span className="nm-icono">
                <Icono />
                {id === "" && pendientes > 0 && <span className="insignia num">{pendientes}</span>}
              </span>
              <span className="nm-txt">{label}</span>
            </button>
          ))}
        </nav>

        <AnimatePresence>{pedido && <DetallePedido key={pedido.id} p={pedido} onCerrar={cerrar} />}</AnimatePresence>

        <div className="toasts" aria-live="polite">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div key={t.id} className={`toast ${t.tipo}`} initial={{ opacity: 0, y: 20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ type: "spring", stiffness: 500, damping: 32 }}>
                {t.texto}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
