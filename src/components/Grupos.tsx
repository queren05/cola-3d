import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { nombreGrupo, useDatos } from "../lib/store";
import type { Grupo } from "../lib/types";

const ease = [0.22, 1, 0.36, 1] as const;

/** con cuenta pero sin grupo: para entrar hace falta el enlace de invitación */
export function SinAcceso() {
  const { unirme, sesion } = useDatos();
  const [codigo, setCodigo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <motion.section className="panel sin-acceso" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ease }}>
      <span className="sin-acceso-icono" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      </span>
      <h2>Hola{sesion?.nombre ? `, ${sesion.nombre}` : ""}</h2>
      <p>Para pedir necesitas el enlace de invitación del taller. Ábrelo o pega aquí el enlace.</p>
      <form
        className="sin-acceso-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setOcupado(true);
          if (await unirme(codigo)) setCodigo("");
          setOcupado(false);
        }}
      >
        <input id="g-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Enlace o código" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <button className="boton primario" disabled={ocupado || codigo.trim().length < 4}>{ocupado ? "Entrando…" : "Entrar"}</button>
      </form>
    </motion.section>
  );
}

const enlace = (codigo: string) => `${location.origin}${location.pathname}?invita=${codigo}`;

/** los dos enlaces de invitación (familia y amigos) para mandar por WhatsApp */
export function Invitaciones() {
  const { api, clave, aviso } = useDatos();
  const [lista, setLista] = useState<{ grupo: Grupo; codigo: string }[] | null>(null);
  const [fallo, setFallo] = useState("");
  useEffect(() => {
    if (!api.adminInvitaciones || clave === null) return;
    api.adminInvitaciones(clave).then(setLista).catch((e) => setFallo(e instanceof Error ? e.message : "Falta el SQL de los grupos"));
  }, [api, clave]);
  if (!api.adminInvitaciones) return null;

  async function copiar(c: string) {
    try {
      await navigator.clipboard.writeText(enlace(c));
      aviso("Enlace copiado");
    } catch {
      prompt("Copia el enlace", enlace(c));
    }
  }
  async function compartir(g: Grupo, c: string) {
    const texto = `Pide tus impresiones 3D aquí (grupo ${nombreGrupo(g)}):`;
    if (navigator.share) await navigator.share({ title: "Cola 3D", text: texto, url: enlace(c) }).catch(() => {});
    else copiar(c);
  }
  async function cambiar(g: Grupo) {
    if (clave === null || !api.adminNuevaInvitacion) return;
    if (!confirm(`¿Cambiar el enlace de ${nombreGrupo(g)}? El de ahora deja de valer (quien ya entró sigue dentro).`)) return;
    try {
      const c = await api.adminNuevaInvitacion(clave, g);
      setLista((l) => l?.map((x) => (x.grupo === g ? { ...x, codigo: c } : x)) ?? null);
      aviso("Enlace nuevo listo");
    } catch (e) {
      aviso(e instanceof Error ? e.message : "No se ha podido", "error");
    }
  }

  return (
    <section className="panel invitaciones">
      <h2>Invitaciones</h2>
      {fallo && <p className="error-txt">{fallo}</p>}
      {(lista || []).map((x) => (
        <div key={x.grupo} className={`invitacion inv-${x.grupo}`}>
          <div className="invitacion-txt">
            <strong>{nombreGrupo(x.grupo)}</strong>
            <code>{enlace(x.codigo).replace(/^https?:\/\//, "")}</code>
          </div>
          <div className="invitacion-botones">
            <button className="boton" onClick={() => compartir(x.grupo, x.codigo)}>Enviar</button>
            <button className="boton" onClick={() => copiar(x.codigo)}>Copiar</button>
            <button className="boton fantasma" onClick={() => cambiar(x.grupo)}>Cambiar</button>
          </div>
        </div>
      ))}
    </section>
  );
}

const GRUPOS: Grupo[] = ["familia", "amigos", "otros"];

/** los grupos de una cuenta: se encienden y apagan (puede estar en varios; ninguno = sin acceso) */
export function ElegirGrupo({ userId, nombre, grupo, alCambiar }: { userId: string; nombre: string; grupo: string | null | undefined; alCambiar: (g: string | null) => void }) {
  const { api, clave, aviso, recargar } = useDatos();
  const [ocupado, setOcupado] = useState(false);
  if (!api.adminGrupos) return null;
  const tiene = (grupo || "").split(",").filter(Boolean) as Grupo[];
  async function cambiar(g: Grupo) {
    if (clave === null) return;
    const nuevos = tiene.includes(g) ? tiene.filter((x) => x !== g) : GRUPOS.filter((x) => x === g || tiene.includes(x));
    setOcupado(true);
    try {
      await api.adminGrupos!(clave, userId, nuevos);
      alCambiar(nuevos.length ? nuevos.join(",") : null);
      aviso(nuevos.length ? `${nombre}: ${nombreGrupo(nuevos.join(","))}` : `${nombre} ya no tiene acceso`);
      recargar();
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido", "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="grupos-chips" role="group" aria-label={`Grupos de ${nombre}`}>
      {GRUPOS.map((g) => (
        <button key={g} type="button" disabled={ocupado} className={`grupo-sel g-${g}${tiene.includes(g) ? " on" : ""}`} aria-pressed={tiene.includes(g)} onClick={() => cambiar(g)}>
          {nombreGrupo(g)}
        </button>
      ))}
      {!tiene.length && <span className="grupo-sel g-nada">Sin acceso</span>}
    </div>
  );
}
