import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { Portada } from "../components/Pedido";
import { Avatar, Chip, Numero, Vacio } from "../components/Piezas";
import { IVitrina } from "../components/Iconos";
import { BotonGusta } from "./Vitrina";
import { gratisRestante } from "../lib/coste";
import { eur, gramos, hace } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Pedido } from "../lib/types";

const ease = [0.22, 1, 0.36, 1] as const;
type Pestana = "mias" | "gustan" | "guardados";

/** tu perfil: foto, nombre, lo que llevas y tus piezas, me gusta y listas de guardados */
export function Perfil({ ir, abrir }: { ir: (r: string) => void; abrir: (id: string) => void }) {
  const { api, datos, sesion, setSesion, esMio, aviso, recargar } = useDatos();
  const [pestana, setPestana] = useState<Pestana>("mias");
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(sesion?.nombre || "");
  const [ocupado, setOcupado] = useState("");
  const [lista, setLista] = useState("");
  const fichero = useRef<HTMLInputElement>(null);

  const mios = useMemo(() => datos.pedidos.filter(esMio).sort((a, b) => b.creado.localeCompare(a.creado)), [datos.pedidos, esMio]);
  const vivos = mios.filter((p) => p.estado !== "cancelado");
  const yoId = api.modo === "local" ? "yo" : sesion?.id;
  const gustanIds = new Set((datos.votos || []).filter((v) => v.user_id === yoId).map((v) => v.pedido_id));
  const gustan = datos.pedidos.filter((p) => gustanIds.has(p.id));
  const recibidos = (datos.votos || []).filter((v) => mios.some((p) => p.id === v.pedido_id)).length;
  const listas = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const x of datos.listas || []) m.set(x.lista, [...(m.get(x.lista) || []), x.pedido_id]);
    return [...m.entries()].sort((a, b) => (a[0] === "Guardados" ? -1 : b[0] === "Guardados" ? 1 : a[0].localeCompare(b[0], "es")));
  }, [datos.listas]);
  const listaActual = listas.find(([n]) => n === lista) ? lista : listas[0]?.[0] || "";
  const enLista = (listas.find(([n]) => n === listaActual)?.[1] || []).map((id) => datos.pedidos.find((p) => p.id === id)).filter(Boolean) as Pedido[];

  if (!sesion && api.cuentas) {
    return (
      <div className="pagina estrecha">
        <Vacio titulo="Entra para ver tu perfil">
          <button className="boton primario" onClick={() => ir("pedir")}>Entrar</button>
        </Vacio>
      </div>
    );
  }
  const miNombre = sesion?.nombre || "Tú";

  async function cambiarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !api.subirAvatar || !api.guardarPerfil || !sesion) return;
    try {
      setOcupado("Subiendo foto…");
      const url = await api.subirAvatar(await reducirCuadrada(f));
      await api.guardarPerfil(sesion.nombre, url);
      await recargar();
      aviso("Foto cambiada");
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido cambiar la foto", "error");
    } finally {
      setOcupado("");
    }
  }
  async function guardarNombre(e: React.FormEvent) {
    e.preventDefault();
    const n = nombre.trim();
    if (!n || !sesion || !api.guardarPerfil) return;
    try {
      setOcupado("Guardando…");
      await api.guardarPerfil(n, datos.perfiles?.[sesion.id]?.avatar || "");
      setSesion({ ...sesion, nombre: n });
      await recargar();
      setEditando(false);
      aviso("Nombre cambiado");
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido guardar", "error");
    } finally {
      setOcupado("");
    }
  }
  async function renombrar(l: string) {
    const nueva = prompt("Nuevo nombre de la lista", l)?.trim();
    if (!nueva || nueva === l || !api.renombrarLista) return;
    try { await api.renombrarLista(l, nueva); await recargar(); setLista(nueva); aviso("Lista renombrada"); }
    catch (err) { aviso(err instanceof Error ? err.message : "No se ha podido", "error"); }
  }
  async function borrar(l: string) {
    if (!api.borrarLista || !confirm(`¿Borrar la lista «${l}»? Las piezas siguen en la vitrina.`)) return;
    try { await api.borrarLista(l); await recargar(); setLista(""); aviso("Lista borrada"); }
    catch (err) { aviso(err instanceof Error ? err.message : "No se ha podido", "error"); }
  }

  const piezas = pestana === "mias" ? mios : pestana === "gustan" ? gustan : enLista;
  return (
    <div className="pagina">
      <motion.header className="perfil-cab" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }}>
        <div className="perfil-foto">
          <Avatar nombre={miNombre} size={96} uid={sesion?.id} />
          {sesion && api.subirAvatar && (
            <>
              <button className="perfil-camara" onClick={() => fichero.current?.click()} aria-label="Cambiar foto" disabled={!!ocupado}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </button>
              <input ref={fichero} type="file" accept="image/*" hidden onChange={cambiarFoto} />
            </>
          )}
        </div>
        <div className="perfil-datos">
          <AnimatePresence mode="wait" initial={false}>
            {editando ? (
              <motion.form key="f" className="perfil-nombre-form" onSubmit={guardarNombre} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} autoFocus aria-label="Tu nombre" />
                <button className="boton primario" disabled={!nombre.trim() || !!ocupado}>Guardar</button>
                <button type="button" className="boton" onClick={() => { setEditando(false); setNombre(miNombre); }}>Cancelar</button>
              </motion.form>
            ) : (
              <motion.div key="n" className="perfil-nombre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <h1>{miNombre}</h1>
                {sesion && api.guardarPerfil && <button className="boton" onClick={() => { setNombre(miNombre); setEditando(true); }}>Cambiar nombre</button>}
              </motion.div>
            )}
          </AnimatePresence>
          {sesion && <span className="perfil-email">{sesion.email}</span>}
          {ocupado && <span className="perfil-email">{ocupado}</span>}
        </div>
      </motion.header>

      <div className="cifras">
        <div><span className="etiqueta">Pedidos</span><span className="cifra"><Numero valor={vivos.length} formato={(v) => String(Math.round(v))} /></span></div>
        <div><span className="etiqueta">Has pagado</span><span className="cifra"><Numero valor={vivos.filter((p) => p.pagado).reduce((t, p) => t + p.coste, 0)} /></span></div>
        <div><span className="etiqueta">Debes</span><span className={`cifra${vivos.some((p) => !p.pagado && !p.peticion) ? " debe" : ""}`}><Numero valor={vivos.filter((p) => !p.pagado && !p.peticion).reduce((t, p) => t + p.coste, 0)} /></span></div>
        <div><span className="etiqueta">Impreso</span><span className="cifra"><Numero valor={vivos.filter((p) => p.estado === "impreso" || p.estado === "entregado").reduce((t, p) => t + (p.coste_detalle?.gramos || 0), 0)} formato={gramos} /></span></div>
        <div><span className="etiqueta">Me gusta recibidos</span><span className="cifra"><Numero valor={recibidos} formato={(v) => String(Math.round(v))} /></span></div>
        <div><span className="etiqueta">Gramos de regalo</span><span className="cifra"><Numero valor={gratisRestante(datos.pedidos, datos.ajustes, sesion?.id, miNombre)} formato={gramos} /></span></div>
      </div>

      <div className="filtros" role="tablist">
        {([["mias", `Mis impresiones · ${mios.length}`], ["gustan", `Me gusta · ${gustan.length}`], ["guardados", `Guardados · ${datos.guardados?.length || 0}`]] as [Pestana, string][]).map(([id, t]) => (
          <button key={id} className={pestana === id ? "activo" : ""} onClick={() => setPestana(id)} role="tab" aria-selected={pestana === id}>
            {pestana === id && <motion.span layoutId="perfil-pestana" className="filtro-fondo" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
            <span>{t}</span>
          </button>
        ))}
      </div>

      {pestana === "guardados" && listas.length > 0 && (
        <div className="v-chips">
          {listas.map(([n, ids]) => (
            <button key={n} className={`v-chip${n === listaActual ? " activo" : ""}`} onClick={() => setLista(n)}>{n} · {ids.length}</button>
          ))}
          {listaActual && (
            <>
              <button className="v-chip quitar" onClick={() => renombrar(listaActual)}>Renombrar</button>
              <button className="v-chip quitar" onClick={() => borrar(listaActual)}>Borrar lista</button>
            </>
          )}
        </div>
      )}

      {piezas.length === 0 ? (
        <Vacio
          titulo={pestana === "mias" ? "Todavía no has pedido nada" : pestana === "gustan" ? "Aún no te ha gustado nada" : "Aún no has guardado nada"}
          icono={<IVitrina width={48} height={48} />}
        >
          <button className="boton primario" onClick={() => ir(pestana === "mias" ? "pedir" : "vitrina")}>{pestana === "mias" ? "Pedir una figura" : "Ir a la vitrina"}</button>
        </Vacio>
      ) : (
        <motion.div className="vitrina" layout key={pestana + listaActual}>
          {piezas.map((p, i) => (
            <motion.div
              key={p.id}
              role="button"
              tabIndex={0}
              className="vitrina-pieza"
              onClick={() => abrir(p.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), abrir(p.id))}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.4, ease }}
              whileHover={{ y: -4 }}
            >
              <div className={`vitrina-foto${p.fotos?.length ? "" : " sin-foto"}`}><Portada p={p} /></div>
              <div className="vitrina-txt">
                <strong>{p.titulo || "Pieza"}</strong>
                <span><Avatar nombre={p.nombre} size={18} uid={p.user_id} /> {p.nombre} · {hace(p.creado)}</span>
                <div className="vitrina-pie">
                  {pestana === "mias" ? <Chip estado={p.estado} /> : <span className="vitrina-g num">{gramos(p.coste_detalle?.gramos || 0)}</span>}
                  {pestana === "mias" ? <span className="num vitrina-g">{eur(p.coste)}</span> : <BotonGusta id={p.id} n={(datos.votos || []).filter((v) => v.pedido_id === p.id).length} mio={gustanIds.has(p.id)} puede={!!yoId} />}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

/** foto de perfil: cuadrada, 512 px, JPEG */
async function reducirCuadrada(f: File): Promise<Blob> {
  const bmp = await createImageBitmap(f);
  const lado = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = Math.min(512, lado);
  c.getContext("2d")!.drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se ha podido leer la foto"))), "image/jpeg", 0.88));
}
