import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { hace } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Deseo } from "../lib/types";
import { Avatar } from "./Piezas";

const ESTADO: Record<Deseo["estado"], string> = { abierto: "Esperando respuesta", encontrado: "¡Encontrado!", descartado: "Respondida" };

/** «¿No encuentras el modelo?»: cada uno deja su idea y el taller le responde */
export function Ideas() {
  const { api, datos, sesion, aviso, recargar } = useDatos();
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  if (!api.crearDeseo || (!sesion && api.modo !== "local")) return null;
  const mias = (datos.deseos || []).filter((d) => api.modo === "local" || d.user_id === sesion?.id);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim() || ocupado) return;
    setOcupado(true);
    try {
      await api.crearDeseo!(texto.trim());
      setTexto("");
      await recargar();
      aviso("Idea enviada al taller");
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido enviar", "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="panel ideas">
      <h2>¿No encuentras el modelo?</h2>
      <p className="comprobar-txt">Cuéntame qué quieres y te busco uno para imprimir.</p>
      <form className="comentar" onSubmit={enviar}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Un soporte para el móvil del coche…" maxLength={600} aria-label="Tu idea" />
        <button className="boton primario" disabled={texto.trim().length < 4 || ocupado}>Enviar</button>
      </form>
      <AnimatePresence initial={false}>
        {mias.map((d) => (
          <motion.div key={d.id} className={`idea ${d.estado}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
            <div className="idea-cab">
              <strong>{d.texto}</strong>
              <span className="idea-estado">{ESTADO[d.estado]}</span>
            </div>
            {(d.respuesta || d.enlace) && (
              <div className="idea-resp">
                {d.respuesta && <p>{d.respuesta}</p>}
                {d.enlace && <a className="boton primario" href={d.enlace} target="_blank" rel="noopener noreferrer">Ver el modelo</a>}
              </div>
            )}
            <div className="idea-pie">
              <small>{hace(d.creado)}</small>
              <button className="enlace-btn" onClick={async () => { await api.borrarDeseo?.(d.id); recargar(); }}>Quitar</button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

/** el taller responde a las ideas: le pasa un enlace o la descarta con una nota */
export function IdeasTaller() {
  const { api, clave, datos, aviso, recargar } = useDatos();
  const ideas = datos.deseos || [];
  const [resp, setResp] = useState<Record<string, { texto: string; enlace: string }>>({});
  if (!api.adminDeseo || clave === null) return null;
  async function responder(d: Deseo, estado: Deseo["estado"]) {
    const r = resp[d.id] || { texto: "", enlace: "" };
    if (estado === "encontrado" && !r.enlace.trim()) return aviso("Pega el enlace del modelo", "error");
    try {
      await api.adminDeseo!(clave!, d.id, { estado, respuesta: r.texto.trim(), enlace: r.enlace.trim() });
      await recargar();
      aviso(estado === "encontrado" ? "Enviado: le llega un aviso" : "Respondida");
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido responder", "error");
    }
  }
  const abiertas = ideas.filter((d) => d.estado === "abierto");
  return (
    <section className="panel ideas">
      <div className="cuentas-cab">
        <h2>Ideas que te han pedido</h2>
        <span className="etiqueta">{abiertas.length} sin responder</span>
      </div>
      {ideas.length === 0 && <p className="comprobar-txt">Aún nadie ha pedido ninguna idea.</p>}
      {ideas.map((d) => (
        <div key={d.id} className={`idea ${d.estado}`}>
          <div className="idea-cab">
            <span className="idea-quien"><Avatar nombre={d.nombre || "?"} size={24} uid={d.user_id} /> {d.nombre}</span>
            <span className="idea-estado">{ESTADO[d.estado]}</span>
          </div>
          <strong>{d.texto}</strong>
          {d.estado === "abierto" ? (
            <div className="idea-form">
              <input placeholder="Enlace del modelo (https://makerworld.com/…)" value={resp[d.id]?.enlace || ""} onChange={(e) => setResp((r) => ({ ...r, [d.id]: { texto: r[d.id]?.texto || "", enlace: e.target.value } }))} />
              <input placeholder="Nota (opcional)" value={resp[d.id]?.texto || ""} onChange={(e) => setResp((r) => ({ ...r, [d.id]: { enlace: r[d.id]?.enlace || "", texto: e.target.value } }))} />
              <div className="fila-botones">
                <button className="boton primario" onClick={() => responder(d, "encontrado")}>Mandar el modelo</button>
                <button className="boton" onClick={() => responder(d, "descartado")}>No se puede</button>
              </div>
            </div>
          ) : (
            <div className="idea-resp">
              {d.respuesta && <p>{d.respuesta}</p>}
              {d.enlace && <a href={d.enlace} target="_blank" rel="noopener noreferrer">{d.enlace}</a>}
            </div>
          )}
          <div className="idea-pie">
            <small>{hace(d.creado)}</small>
            <button className="enlace-btn" onClick={async () => { await api.borrarDeseo?.(d.id); recargar(); }}>Borrar</button>
          </div>
        </div>
      ))}
    </section>
  );
}
