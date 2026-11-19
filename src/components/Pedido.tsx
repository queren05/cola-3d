import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { dominio, duracion, eur, fechaLarga, gramos, hace, num } from "../lib/formato";
import { useDatos } from "../lib/store";
import { ESTADOS, type Estado, type Linea, type Pedido } from "../lib/types";
import { ICerrar, ICheck, IEnlace, IPapelera, IReloj } from "./Iconos";
import { Avatar, Chip, colorEstado, Impresora, Muestra } from "./Piezas";

const ease = [0.22, 1, 0.36, 1] as const;

/** foto de la figura; sin foto, franjas con los colores de filamento como capas impresas */
export function Portada({ p, alto, layoutId }: { p: Pedido; alto?: number; layoutId?: string }) {
  const [rota, setRota] = useState(false);
  const colores = p.lineas.map((l) => l.color).filter(Boolean);
  const franjas = colores.length ? colores : ["var(--line)"];
  return (
    <motion.div layoutId={layoutId} className="portada" style={alto ? { height: alto } : undefined} transition={{ duration: 0.45, ease }}>
      {p.imagen && !rota ? (
        <img src={p.imagen} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRota(true)} />
      ) : (
        <div className="capas-portada" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} style={{ background: franjas[i % franjas.length], opacity: 0.55 + (i % 3) * 0.15 }} />
          ))}
          <b>{(p.titulo || dominio(p.url)).slice(0, 2).toUpperCase()}</b>
        </div>
      )}
      {p.estado === "imprimiendo" && (
        <div className="portada-imprimiendo">
          <Impresora size={34} />
        </div>
      )}
    </motion.div>
  );
}

export function TarjetaPedido({ p, posicion, onAbrir, mio, resaltar }: { p: Pedido; posicion: number | null; onAbrir: () => void; mio: boolean; resaltar: boolean }) {
  return (
    <motion.article
      layout
      layoutId={`card-${p.id}`}
      className={`tarjeta${mio ? " mia" : ""}${resaltar ? " nueva" : ""}`}
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
      transition={{ duration: 0.45, ease }}
      whileHover={{ y: -4 }}
      onClick={onAbrir}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onAbrir())}
      aria-label={`${p.titulo || "Pedido"} de ${p.nombre}`}
      style={{ ["--estado" as string]: colorEstado(p.estado) }}
    >
      <div className="tarjeta-img">
        <Portada p={p} layoutId={`img-${p.id}`} />
        {posicion !== null && <span className="turno num">#{posicion}</span>}
        <span className="precio num">{eur(p.coste)}</span>
      </div>
      <div className="tarjeta-cuerpo">
        <div className="tarjeta-titulo">{p.titulo || dominio(p.url)}</div>
        <div className="tarjeta-quien">
          <Avatar nombre={p.nombre} size={22} />
          <span>{p.nombre}</span>
          <span className="sep">·</span>
          <span>{hace(p.creado)}</span>
        </div>
        <div className="tarjeta-pie">
          <span className="chips">
            <Chip estado={p.estado} />
            {p.estado === "pendiente" && (p.pagado ? <span className="pagado"><ICheck width={12} height={12} /> Pagado</span> : <span className="sin-pagar">Sin pagar</span>)}
          </span>
          <span className="colores">
            {p.lineas.slice(0, 5).map((l, i) => (
              <Muestra key={i} color={l.color} size={12} />
            ))}
            <span className="num">{gramos(p.coste_detalle?.gramos ?? 0)}</span>
          </span>
        </div>
      </div>
    </motion.article>
  );
}

/** Ficha del pedido: foto grande, estados con fecha, desglose del coste y, en el taller, todo lo editable. */
export function DetallePedido({ p, onCerrar }: { p: Pedido; onCerrar: () => void }) {
  const { api, clave, esAdmin, tokens, aviso, datos } = useDatos();
  const [ocupado, setOcupado] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const [editar, setEditar] = useState(false);
  const det = p.coste_detalle;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    document.body.classList.add("sin-scroll");
    return () => {
      window.removeEventListener("keydown", k);
      document.body.classList.remove("sin-scroll");
    };
  }, [onCerrar]);

  async function hacer(f: () => Promise<void>, ok?: string) {
    setOcupado(true);
    try {
      await f();
      if (ok) aviso(ok);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "No se ha podido guardar", "error");
    } finally {
      setOcupado(false);
    }
  }
  const token = tokens[p.id];
  const fechas = new Map<Estado, string>();
  for (const h of p.historial || []) fechas.set(h.estado, h.fecha);
  const camino: Estado[] = p.estado === "cancelado" ? ["pendiente", "cancelado"] : ["pendiente", "imprimiendo", "impreso", "entregado"];
  const actual = camino.indexOf(p.estado);

  return (
    <motion.div className="capa" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCerrar}>
      <motion.div
        className="hoja"
        role="dialog"
        aria-modal="true"
        aria-label={p.titulo || "Pedido"}
        layoutId={`card-${p.id}`}
        transition={{ duration: 0.45, ease }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">
          <ICerrar />
        </button>
        <div className="hoja-scroll">
          <Portada p={p} layoutId={`img-${p.id}`} />
          <motion.div className="hoja-cuerpo" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.4, ease }}>
            <div className="hoja-cabecera">
              <div style={{ minWidth: 0 }}>
                <h2>{p.titulo || dominio(p.url)}</h2>
                <div className="tarjeta-quien">
                  <Avatar nombre={p.nombre} size={24} />
                  <span>{p.nombre}</span>
                  <span className="sep">·</span>
                  <span>{fechaLarga(p.creado)}</span>
                </div>
              </div>
              <div className="hoja-total">
                <span className="num">{eur(p.coste)}</span>
                {p.estado !== "cancelado" && (p.pagado ? <span className="pagado"><ICheck width={14} height={14} /> Pagado</span> : <span className="sin-pagar">Sin pagar</span>)}
              </div>
            </div>

            {!esAdmin && !p.pagado && p.estado !== "cancelado" && <Pago p={p} bizum={datos.ajustes.bizum} />}

            <a className="boton primario ancho" href={p.url} target="_blank" rel="noopener noreferrer">
              <IEnlace width={18} height={18} /> Abrir en {dominio(p.url)}
            </a>

            {/* línea de estados */}
            <ol className="camino" style={{ ["--n" as string]: camino.length }}>
              {camino.map((e, i) => (
                <li key={e} className={i <= actual ? "hecho" : ""} style={{ ["--c" as string]: colorEstado(e) }}>
                  <motion.span className="nodo" initial={false} animate={{ scale: i === actual ? 1.15 : 1 }}>
                    {i < actual ? <ICheck width={13} height={13} /> : e === "imprimiendo" && i === actual ? <span className="pulso" /> : null}
                  </motion.span>
                  <span className="camino-txt">
                    <strong>{ESTADOS.find((x) => x.id === e)?.label}</strong>
                    <small>{fechas.get(e) && i <= actual ? new Date(fechas.get(e)!).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : ""}</small>
                  </span>
                </li>
              ))}
            </ol>

            {esAdmin && clave !== null && (
              <div className="bloque">
                <span className="etiqueta">Estado</span>
                <div className="segmentos" role="group" aria-label="Cambiar estado">
                  {ESTADOS.map((e) => (
                    <button
                      key={e.id}
                      className={p.estado === e.id ? "activo" : ""}
                      style={{ ["--c" as string]: colorEstado(e.id) }}
                      disabled={ocupado}
                      onClick={() => p.estado !== e.id && hacer(() => api.adminPedido(clave, p.id, { estado: e.id }), `Pasado a ${e.label.toLowerCase()}`)}
                    >
                      {p.estado === e.id && <motion.span layoutId={`seg-${p.id}`} className="seg-fondo" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                      <span>{e.label}</span>
                    </button>
                  ))}
                </div>
                <div className="fila-botones">
                  <button className="boton" disabled={ocupado} onClick={() => hacer(() => api.adminPedido(clave, p.id, { pagado: !p.pagado }), p.pagado ? "Quitado el pagado" : "Marcado como pagado")}>
                    {p.pagado ? "Quitar pagado" : "Marcar pagado"}
                  </button>
                  <button className="boton" onClick={() => setEditar((v) => !v)}>{editar ? "Cerrar ajuste" : "Ajustar gramos"}</button>
                  {!borrar ? (
                    <button className="boton peligro-suave" onClick={() => setBorrar(true)}><IPapelera width={16} height={16} /> Borrar</button>
                  ) : (
                    <>
                      <button className="boton peligro" disabled={ocupado} onClick={() => hacer(async () => { await api.adminBorrarPedido(clave, p.id); onCerrar(); }, "Pedido borrado")}>Sí, borrar</button>
                      <button className="boton" onClick={() => setBorrar(false)}>No</button>
                    </>
                  )}
                </div>
              </div>
            )}

            <AnimatePresence initial={false}>
              {editar && esAdmin && clave !== null && (
                <motion.div key="editar" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }}>
                  <AjustarGramos p={p} onGuardar={(lineas, minutos, copias) => hacer(() => api.adminPedido(clave, p.id, { lineas, minutos, copias }), "Coste recalculado")} ocupado={ocupado} filamentos={datos.filamentos} />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="bloque">
              <span className="etiqueta">Coste</span>
              <div className="desglose">
                {det?.lineas?.map((l, i) => (
                  <div key={i} className="desglose-fila">
                    <Muestra color={l.color} />
                    <span className="d-nombre">{l.nombre || "Filamento"}</span>
                    <span className="num d-calc">{gramos(l.gramos)} × {eur(l.precio)}/{gramos(l.peso)}</span>
                    <span className="num">{eur(l.coste)}</span>
                  </div>
                ))}
                {det?.merma > 0 && (
                  <div className="desglose-fila">
                    <span className="muestra multicolor" />
                    <span className="d-nombre">Purga por cambio de color</span>
                    <span className="num d-calc">+{det.merma_pct} %</span>
                    <span className="num">{eur(det.merma)}</span>
                  </div>
                )}
                {det?.luz > 0 && (
                  <div className="desglose-fila">
                    <IReloj width={15} height={15} />
                    <span className="d-nombre">Luz y desgaste</span>
                    <span className="num d-calc">{duracion(p.minutos * p.copias)}</span>
                    <span className="num">{eur(det.luz)}</span>
                  </div>
                )}
                <div className="desglose-fila total">
                  <span />
                  <span className="d-nombre">Total{p.copias > 1 ? ` · ${p.copias} copias` : ""}</span>
                  <span className="num d-calc">{gramos(det?.gramos ?? 0)}</span>
                  <span className="num">{eur(p.coste)}</span>
                </div>
              </div>
            </div>

            {p.notas && (
              <div className="bloque">
                <span className="etiqueta">Notas</span>
                <p className="notas">{p.notas}</p>
              </div>
            )}

            {!esAdmin && token && p.estado === "pendiente" && (
              <div className="fila-botones">
                {!borrar ? (
                  <button className="boton peligro-suave" onClick={() => setBorrar(true)}>Cancelar mi pedido</button>
                ) : (
                  <>
                    <button className="boton peligro" disabled={ocupado} onClick={() => hacer(() => api.cancelarPedido(p.id, token), "Pedido cancelado")}>Sí, cancelarlo</button>
                    <button className="boton" onClick={() => setBorrar(false)}>No</button>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AjustarGramos({ p, onGuardar, ocupado, filamentos }: { p: Pedido; onGuardar: (l: Linea[], minutos: number, copias: number) => void; ocupado: boolean; filamentos: { id: string; nombre: string; color: string }[] }) {
  const [lineas, setLineas] = useState(() => p.lineas.map((l) => ({ ...l, txt: String(l.gramos).replace(".", ",") })));
  const [horas, setHoras] = useState(String(Math.floor(p.minutos / 60) || ""));
  const [mins, setMins] = useState(String(p.minutos % 60 || ""));
  const [copias, setCopias] = useState(String(p.copias));
  return (
    <div className="bloque ajustar">
      <span className="etiqueta">Gramos reales por copia</span>
      {lineas.map((l, i) => (
        <div key={i} className="ajustar-fila">
          <select
            aria-label="Filamento"
            value={l.filamento_id ?? ""}
            onChange={(e) => {
              const f = filamentos.find((x) => x.id === e.target.value);
              setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, filamento_id: f?.id ?? null, nombre: f?.nombre ?? x.nombre, color: f?.color ?? x.color } : x)));
            }}
          >
            {!l.filamento_id && <option value="">{l.nombre || "Otro"}</option>}
            {filamentos.map((f) => (
              <option key={f.id} value={f.id}>{f.nombre}</option>
            ))}
          </select>
          <input className="num" inputMode="decimal" aria-label="Gramos" value={l.txt} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, txt: e.target.value } : x)))} />
          <span className="unidad">g</span>
        </div>
      ))}
      <div className="ajustar-fila">
        <span className="d-nombre">Tiempo</span>
        <input className="num" inputMode="numeric" aria-label="Horas" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="0" />
        <span className="unidad">h</span>
        <input className="num" inputMode="numeric" aria-label="Minutos" value={mins} onChange={(e) => setMins(e.target.value)} placeholder="0" />
        <span className="unidad">min</span>
      </div>
      <div className="ajustar-fila">
        <span className="d-nombre">Copias</span>
        <input className="num" inputMode="numeric" aria-label="Copias" value={copias} onChange={(e) => setCopias(e.target.value)} />
      </div>
      <button
        className="boton primario"
        disabled={ocupado}
        onClick={() => onGuardar(lineas.map(({ txt, ...l }) => ({ ...l, gramos: num(txt) })), Math.round(num(horas) * 60 + num(mins)), Math.max(1, Math.round(num(copias))))}
      >
        Guardar y recalcular
      </button>
    </div>
  );
}

/** cómo pagar: Bizum o en mano; se imprime al recibirlo */
function Pago({ p, bizum }: { p: Pedido; bizum: string }) {
  const { aviso } = useDatos();
  return (
    <motion.div className="pago" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, ease }}>
      <div className="pago-arriba">
        <span className="etiqueta">Por pagar</span>
        <strong className="num">{eur(p.coste)}</strong>
      </div>
      <p>
        Por Bizum{bizum ? <> al <b className="num">{bizum}</b></> : ""} o en mano. {p.estado === "pendiente" ? "Se imprime cuando llegue el pago." : ""}
      </p>
      {bizum && (
        <button
          className="boton"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(bizum.replace(/\s/g, ""));
              aviso("Número copiado");
            } catch {
              aviso(bizum);
            }
          }}
        >
          Copiar número
        </button>
      )}
    </motion.div>
  );
}
