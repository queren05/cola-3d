import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { clave as claveNombre } from "../lib/formato";
import { useDatos } from "../lib/store";
import { Avatar } from "./Piezas";

/** nombre arriba a la derecha: mi perfil y salir */
export function MenuCuenta({ ir }: { ir: (r: string) => void }) {
  const { api, sesion, setSesion, aviso } = useDatos();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const f = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("pointerdown", f);
    return () => document.removeEventListener("pointerdown", f);
  }, [abierto]);
  if (!sesion) return null;
  return (
    <div className="cuenta-menu" ref={caja}>
      <button className="quien" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <Avatar nombre={sesion.nombre} size={20} />
        <span>{sesion.nombre}</span>
      </button>
      <AnimatePresence>
        {abierto && (
          <motion.div className="cuenta-pop" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ duration: 0.18 }}>
            <span className="cuenta-email">{sesion.email}</span>
            <button onClick={() => { setAbierto(false); ir("gente/" + encodeURIComponent(claveNombre(sesion.nombre))); }}>Mis pedidos</button>
            <button
              onClick={async () => {
                setAbierto(false);
                await api.salir?.();
                setSesion(null);
                aviso("Has salido");
              }}
            >
              Salir
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** al volver del correo de «he olvidado la contraseña» */
export function NuevaClave() {
  const { api, recuperando, setRecuperando, setSesion, aviso } = useDatos();
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <AnimatePresence>
      {recuperando && (
        <motion.div className="velo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.form
            className="panel formulario nueva-clave"
            initial={{ y: 30, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 20, opacity: 0 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setOcupado(true);
              try {
                await api.nuevaClave!(clave);
                setSesion((await api.sesion?.()) ?? null);
                setRecuperando(false);
                aviso("Contraseña cambiada");
              } catch (err) {
                aviso(err instanceof Error ? err.message : "No se ha podido cambiar", "error");
              } finally {
                setOcupado(false);
              }
            }}
          >
            <h2>Nueva contraseña</h2>
            <label className="campo">
              <span>Contraseña</span>
              <input id="n-clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" minLength={6} required autoFocus />
            </label>
            <button className="boton primario ancho" disabled={ocupado || clave.length < 6}>Guardar</button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
