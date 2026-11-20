import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { dominio, duracion, eur, fechaLarga, gramos, hace, num } from "../lib/formato";
import { acumula, aplicarGratis, calcularCoste, deudaDe, gratisRestante } from "../lib/coste";
import { esMakerWorld, minutosA1mini, perfilInicial } from "../lib/perfiles";
import { vistaPrevia } from "../lib/vista-previa";
import { useInclinar } from "../lib/inclinar";
import { useDatos } from "../lib/store";
import { ESTADOS, type Estado, type Linea, type Pedido } from "../lib/types";
import { ICerrar, ICheck, IEnlace, IPapelera, IReloj } from "./Iconos";
import { Avatar, Chip, colorEstado, Impresora, Muestra } from "./Piezas";
import { BotonGuardar, BotonGusta } from "../pages/Vitrina";

const ease = [0.22, 1, 0.36, 1] as const;

/** foto de la figura; sin foto, franjas con los colores de filamento como capas impresas */
export function Portada({ p, alto, layoutId }: { p: Pedido; alto?: number; layoutId?: string }) {
  const [rota, setRota] = useState(false);
  const colores = p.lineas.map((l) => l.color).filter(Boolean);
  const franjas = colores.length ? colores : ["var(--line)"];
  return (
    <motion.div layoutId={layoutId} className="portada" style={alto ? { height: alto } : undefined} transition={{ duration: 0.45, ease }}>
      {(p.fotos?.[0] || p.imagen) && !rota ? (
        <img src={p.fotos?.[0] || p.imagen} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRota(true)} />
      ) : (
        <div className="capas-portada" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, i) => (
            <span key={i} style={{ background: franjas[i % franjas.length], opacity: 0.55 + (i % 3) * 0.15 }} />
          ))}
          <b>{(p.titulo || dominio(p.url)).slice(0, 2).toUpperCase()}</b>
        </div>
      )}
      {!!p.fotos?.length && !rota && <span className="foto-real">Foto real</span>}
      {p.estado === "imprimiendo" && (
        <div className="portada-imprimiendo">
          <Impresora size={34} />
        </div>
      )}
    </motion.div>
  );
}

export function TarjetaPedido({ p, posicion, onAbrir, mio, resaltar }: { p: Pedido; posicion: number | null; onAbrir: () => void; mio: boolean; resaltar: boolean }) {
  const { datos: datosCola } = useDatos();
  const inc = useInclinar();
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
      onPointerMove={inc.onPointerMove}
      onPointerLeave={inc.onPointerLeave}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onAbrir())}
      aria-label={`${p.titulo || "Pedido"} de ${p.nombre}`}
      style={{ ["--estado" as string]: colorEstado(p.estado), ...inc.estilo }}
    >
      <motion.span className="brillo" style={{ background: inc.brillo }} aria-hidden="true" />
      <div className="tarjeta-img">
        <Portada p={p} layoutId={`img-${p.id}`} />
        {posicion !== null && <span className="turno num">#{posicion}</span>}
        {!esTaller(p) && <span className="precio num">{eur(p.coste)}</span>}
      </div>
      <div className="tarjeta-cuerpo">
        <div className="tarjeta-titulo">{p.titulo || dominio(p.url)}</div>
        <div className="tarjeta-quien">
          <Avatar nombre={p.nombre} size={22} uid={p.user_id} />
          <span>{p.nombre}</span>
          <span className="sep">·</span>
          <span>{hace(p.creado)}</span>
        </div>
        <div className="tarjeta-pie">
          <span className="chips">
            <Chip estado={p.estado} />
            {p.peticion && p.estado === "pendiente" ? <span className="peticion-chip">Petición · {p.lineas.filter((l) => l.gramos > 0).length} colores</span> : p.estado === "pendiente" && !p.pagado && acumula(p, datosCola.pedidos, datosCola.ajustes) ? <span className="acumula-chip">Se acumula</span> : p.estado === "pendiente" && (p.pagado ? <span className="pagado"><ICheck width={12} height={12} /> Pagado</span> : <span className="sin-pagar">Sin pagar</span>)}
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
  const { api, clave, esAdmin, tokens, aviso, datos, esMio, sesion, recargar, quitar } = useDatos();
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
      // se ve al momento, sin esperar al aviso del servidor
      await recargar();
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
                  <Avatar nombre={p.nombre} size={24} uid={p.user_id} />
                  <span>{p.nombre}</span>
                  <span className="sep">·</span>
                  <span>{fechaLarga(p.creado)}</span>
                </div>
              </div>
              {esTaller(p) ? (
                <div className="hoja-total"><span className="del-taller">Del taller</span></div>
              ) : (
                <div className="hoja-total">
                  <span className="num">{eur(p.coste)}</span>
                  {p.estado !== "cancelado" && (p.pagado ? <span className="pagado"><ICheck width={14} height={14} /> Pagado</span> : <span className="sin-pagar">Sin pagar</span>)}
                </div>
              )}
            </div>

            {p.peticion && p.estado === "pendiente" && (
              <div className="peticion-aviso">
                <strong>Petición: {p.lineas.filter((l) => l.gramos > 0).length} colores</strong>
                <span>{esAdmin ? "La impresora lleva 4 colores a la vez. Si te animas a cambiar carretes, acéptala y entra en la cola." : "La impresora lleva 4 colores a la vez. El taller te dirá si se puede; hasta entonces no hace falta pagar."}</span>
                {esAdmin && clave !== null && (
                  <button className="boton primario" disabled={ocupado} onClick={() => hacer(() => api.adminPedido(clave, p.id, { peticion: false }), "Petición aceptada: ya está en la cola")}>Aceptar petición</button>
                )}
              </div>
            )}

            {!esAdmin && esMio(p) && !p.pagado && p.estado !== "cancelado" && !p.peticion && !esTaller(p) && <Pago p={p} bizum={datos.ajustes.bizum} />}

            {!!p.url && (
              <a className="boton primario ancho" href={p.url} target="_blank" rel="noopener noreferrer">
                <IEnlace width={18} height={18} /> Abrir en {dominio(p.url)}
              </a>
            )}

            {(p.estado === "impreso" || p.estado === "entregado") && <AccionesVitrina p={p} onCerrar={onCerrar} />}
            <Compartir p={p} />

            {(esAdmin || !!p.fotos?.length) && (
              <Fotos p={p} puede={esAdmin && clave !== null && !!api.subirFoto} guardar={async (fotos) => { await api.adminPedido(clave ?? "", p.id, { fotos }); await recargar(); }} />
            )}

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
                  {!esTaller(p) && (
                    <button className="boton" disabled={ocupado} onClick={() => hacer(() => api.adminPedido(clave, p.id, { pagado: !p.pagado }), p.pagado ? "Quitado el pagado" : "Marcado como pagado")}>
                      {p.pagado ? "Quitar pagado" : "Marcar pagado"}
                    </button>
                  )}
                  {!p.pagado && !esTaller(p) && p.estado !== "cancelado" && (
                    <button className="boton" disabled={ocupado} onClick={() => hacer(() => api.adminPedido(clave, p.id, { acumulado: !p.acumulado }), p.acumulado ? "Vuelve a pedir el pago" : "Acumulado: se imprime sin esperar al pago")}>
                      {p.acumulado ? "Quitar acumulado" : "Acumular"}
                    </button>
                  )}
                  {p.estado === "pendiente" && (
                    (p.prioridad || 0) > 0 ? (
                      <button className="boton" disabled={ocupado} onClick={() => hacer(() => api.adminPedido(clave, p.id, { prioridad: 0 }), "Vuelve a su sitio en la cola")}>Quitar prioridad</button>
                    ) : (
                      <button className="boton" disabled={ocupado} onClick={() => hacer(() => api.adminPedido(clave, p.id, { prioridad: Math.max(0, ...datos.pedidos.map((x) => x.prioridad || 0)) + 1 }), "Pasado el primero de la cola")}>Pasar el primero</button>
                    )
                  )}
                  <button className="boton" onClick={() => setEditar((v) => !v)}>{editar ? "Cerrar ajuste" : "Ajustar gramos"}</button>
                  {!borrar ? (
                    <button className="boton peligro-suave" onClick={() => setBorrar(true)}><IPapelera width={16} height={16} /> Borrar</button>
                  ) : (
                    <>
                      <button className="boton peligro" disabled={ocupado} onClick={() => hacer(async () => { await api.adminBorrarPedido(clave, p.id); onCerrar(); quitar(p.id); }, "Pedido borrado")}>Sí, borrar</button>
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

            {esAdmin && clave !== null && !esTaller(p) && esMakerWorld(p.url) && <Comprobar p={p} />}

            {!esTaller(p) && <div className="bloque">
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
                {(det?.descuento || 0) > 0 && (
                  <div className="desglose-fila gratis">
                    <span className="muestra" style={{ background: "var(--ok)" }} />
                    <span className="d-nombre">Gramos de regalo</span>
                    <span className="num d-calc">{gramos(det.gratis_g || 0)}</span>
                    <span className="num">−{eur(det.descuento || 0)}</span>
                  </div>
                )}
                <div className="desglose-fila total">
                  <span />
                  <span className="d-nombre">Total{p.copias > 1 ? ` · ${p.copias} copias` : ""}</span>
                  <span className="num d-calc">{gramos(det?.gramos ?? 0)}</span>
                  <span className="num">{eur(p.coste)}</span>
                </div>
              </div>
            </div>}

            {p.notas && (
              <div className="bloque">
                <span className="etiqueta">Notas</span>
                <p className="notas">{p.notas}</p>
              </div>
            )}

            {(p.estado === "impreso" || p.estado === "entregado") && <Comentarios p={p} />}

            {(token || (!!sesion && p.user_id === sesion.id)) && p.estado === "pendiente" && (
              <div className="fila-botones">
                {!borrar ? (
                  <button className="boton peligro-suave" onClick={() => setBorrar(true)}>Cancelar mi pedido</button>
                ) : (
                  <>
                    <button className="boton peligro" disabled={ocupado} onClick={() => hacer(() => api.cancelarPedido(p.id, token || ""), "Pedido cancelado")}>Sí, cancelarlo</button>
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
  const { aviso, datos } = useDatos();
  const minimo = datos.ajustes.pago_minimo ?? 0.5;
  const deuda = deudaDe(p, datos.pedidos);
  if (p.acumulado && deuda.total >= minimo) {
    return (
      <motion.div className="pago acumula" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, ease }}>
        <div className="pago-arriba">
          <span className="etiqueta">Apuntado a tu cuenta</span>
          <strong className="num">{eur(deuda.total)}</strong>
        </div>
        <p>El taller lo imprime sin esperar al pago. Págalo cuando puedas por Bizum{bizum ? <> al <b className="num">{bizum}</b></> : ""} o en mano.</p>
      </motion.div>
    );
  }
  if (deuda.total < minimo) {
    return (
      <motion.div className="pago acumula" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, ease }}>
        <div className="pago-arriba">
          <span className="etiqueta">Se acumula</span>
          <strong className="num">{eur(deuda.total)}</strong>
        </div>
        <p>Aún no hace falta pagar: se paga todo junto cuando llegues a {eur(minimo)} (Bizum no deja enviar menos). Se imprime igual.</p>
      </motion.div>
    );
  }
  const varios = deuda.pedidos.length > 1;
  return (
    <motion.div className="pago" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, ease }}>
      <div className="pago-arriba">
        <span className="etiqueta">{varios ? `Por pagar · ${deuda.pedidos.length} pedidos` : "Por pagar"}</span>
        <strong className="num">{eur(deuda.total)}</strong>
      </div>
      <p>
        {varios ? "Paga todo junto " : ""}por Bizum{bizum ? <> al <b className="num">{bizum}</b></> : ""} o en mano. {p.estado === "pendiente" ? "Se imprime cuando llegue el pago." : ""}
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

/** pieza que el taller ha subido a la vitrina por su cuenta (no se cobra) */
export const esTaller = (p: Pedido) => !!(p.coste_detalle as { taller?: boolean } | undefined)?.taller;

/** reduce la foto a 1600 px como mucho y la pasa a JPEG */
export async function reducir(f: File): Promise<Blob> {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error("No se ha podido leer la foto"))), "image/jpeg", 0.85));
}

function Fotos({ p, puede, guardar }: { p: Pedido; puede: boolean; guardar: (fotos: string[]) => Promise<void> }) {
  const { api, aviso } = useDatos();
  const [subiendo, setSubiendo] = useState(0);
  const [grande, setGrande] = useState<string | null>(null);
  const fotos = p.fotos || [];
  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files || [])].slice(0, 12 - fotos.length);
    e.target.value = "";
    if (!files.length || !api.subirFoto) return;
    setSubiendo(files.length);
    try {
      const nuevas: string[] = [];
      for (const f of files) {
        nuevas.push(await api.subirFoto(p.id, await reducir(f)));
        setSubiendo((n) => n - 1);
      }
      await guardar([...fotos, ...nuevas]);
      aviso(nuevas.length === 1 ? "Foto subida" : `${nuevas.length} fotos subidas`);
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido subir la foto", "error");
    } finally {
      setSubiendo(0);
    }
  }
  async function quitar(url: string) {
    try {
      await guardar(fotos.filter((x) => x !== url));
      await api.borrarFoto?.(url).catch(() => {});
      aviso("Foto quitada");
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido quitar", "error");
    }
  }
  return (
    <div className="bloque">
      <span className="etiqueta">Cómo ha quedado</span>
      <div className="fotos">
        <AnimatePresence initial={false}>
          {fotos.map((u) => (
            <motion.div key={u} className="foto" layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.3, ease }}>
              <button className="foto-ver" onClick={() => setGrande(u)} aria-label="Ver en grande"><img src={u} alt="" loading="lazy" /></button>
              {puede && <button className="foto-quitar" onClick={() => quitar(u)} aria-label="Quitar foto"><ICerrar width={14} height={14} /></button>}
            </motion.div>
          ))}
          {Array.from({ length: subiendo }).map((_, i) => <motion.div key={"s" + i} className="foto cargando" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />)}
        </AnimatePresence>
        {puede && fotos.length < 12 && (
          <label className="foto foto-subir">
            <input type="file" accept="image/*" multiple onChange={elegir} disabled={subiendo > 0} />
            <span aria-hidden="true">+</span>
            <small>{subiendo ? "Subiendo…" : "Subir foto"}</small>
          </label>
        )}
      </div>
      {createPortal(<AnimatePresence>
        {grande && (
          <motion.div className="foto-grande" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => { e.stopPropagation(); setGrande(null); }}>
            <motion.img src={grande} alt="" initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} transition={{ type: "spring", stiffness: 300, damping: 28 }} />
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}

/** me gusta, guardar y pedir una igual (piezas ya impresas) */
function AccionesVitrina({ p, onCerrar }: { p: Pedido; onCerrar: () => void }) {
  const { api, datos, sesion, yo, aviso, guardarToken, recargar, setResaltado } = useDatos();
  const [copias, setCopias] = useState(1);
  const [ocupado, setOcupado] = useState(false);
  const yoId = api.modo === "local" ? "yo" : sesion?.id;
  const votos = (datos.votos || []).filter((v) => v.pedido_id === p.id);
  const nombre = sesion?.nombre || yo;
  async function pedir() {
    if (!api.pedirIgual) return;
    if (api.cuentas && !sesion) return aviso("Entra con tu cuenta para pedirla", "error");
    if (!nombre.trim()) return aviso("Pon tu nombre en Pedir primero", "error");
    setOcupado(true);
    try {
      const r = await api.pedirIgual(p.id, nombre, copias, `Igual que «${p.titulo || "la pieza"}» de ${p.nombre}`);
      guardarToken(r.id, r.token);
      await recargar();
      setResaltado(r.id);
      aviso("¡En la cola!");
      onCerrar();
      setTimeout(() => (location.hash = "#/"), 300);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "No se ha podido pedir", "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="bloque">
      <div className="vitrina-acciones">
        <BotonGusta id={p.id} n={votos.length} mio={!!yoId && votos.some((v) => v.user_id === yoId)} puede={!!yoId} grande />
        {!!yoId && <BotonGuardar id={p.id} guardada={(datos.guardados || []).includes(p.id)} grande />}
      </div>
      {api.pedirIgual && (
        <div className="pedir-igual">
          <p>¿Te gusta? Pide una igual</p>
          <span className="contador">
            <button type="button" onClick={() => setCopias((c) => Math.max(1, c - 1))} aria-label="Menos copias">−</button>
            <span className="num">{copias}</span>
            <button type="button" onClick={() => setCopias((c) => Math.min(20, c + 1))} aria-label="Más copias">+</button>
          </span>
          <button className="boton primario" disabled={ocupado} onClick={pedir}>{ocupado ? "Pidiendo…" : "Pedir igual"}</button>
        </div>
      )}
    </div>
  );
}

/** el taller comprueba que lo pedido coincide con el perfil de MakerWorld (gramos, tiempo y precio) */
function Comprobar({ p }: { p: Pedido }) {
  const { api, clave, datos, aviso, recargar } = useDatos();
  const [estado, setEstado] = useState<"cargando" | "sin" | "listo">("cargando");
  const [perfil, setPerfil] = useState<import("../lib/types").Perfil | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    vistaPrevia(p.url, api)
      .then((v) => {
        if (!vivo) return;
        const pf = v?.perfiles?.length ? perfilInicial(v.perfiles, p.url) : undefined;
        setPerfil(pf || null);
        setEstado(pf ? "listo" : "sin");
      })
      .catch(() => vivo && setEstado("sin"));
    return () => { vivo = false; };
  }, [p.url, api]);

  if (estado === "cargando") return <div className="bloque comprobar cargando"><span className="etiqueta">Comprobar con MakerWorld</span><span className="comprobar-txt">Leyendo el perfil…</span></div>;
  if (!perfil) return <div className="bloque comprobar"><span className="etiqueta">Comprobar con MakerWorld</span><span className="comprobar-txt">No se ha podido leer el perfil de este modelo.</span></div>;

  const pedidoG = Math.round(p.lineas.reduce((t, l) => t + l.gramos, 0) * 10) / 10; // por copia
  const perfilG = Math.round(perfil.gramos * 10) / 10;
  const perfilMin = minutosA1mini(perfil);
  const difG = Math.round((pedidoG - perfilG) * 10) / 10;
  const difMin = p.minutos - perfilMin;
  const bien = Math.abs(difG) <= 1 && Math.abs(difMin) <= 2;
  // lo que costaría con los gramos y el tiempo del perfil (mismos rollos, repartidos igual)
  const k = pedidoG > 0 ? perfilG / pedidoG : 1;
  const lineasPerfil = p.lineas.map((l) => ({ ...l, gramos: Math.round(l.gramos * k * 10) / 10 }));
  // el regalo, como lo calcula la base de datos al recalcular: lo que le queda a esa persona sin contar este pedido
  const deberia = aplicarGratis(calcularCoste(lineasPerfil, perfilMin, p.copias, datos.filamentos, datos.ajustes), gratisRestante(datos.pedidos, datos.ajustes, p.user_id, p.nombre, p.id)).total;

  async function corregir() {
    if (clave === null) return;
    setOcupado(true);
    try {
      await api.adminPedido(clave, p.id, { lineas: lineasPerfil, minutos: perfilMin });
      await recargar();
      aviso(`Corregido: ahora cuesta ${eur(deberia)}`);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "No se ha podido corregir", "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className={`bloque comprobar ${bien ? "bien" : "mal"}`}>
      <span className="etiqueta">Comprobar con MakerWorld</span>
      <strong className="comprobar-tit">{bien ? "✓ Coincide con el perfil" : "⚠ No coincide con el perfil"}</strong>
      <div className="comprobar-cifras">
        {([
          ["Gramos", gramos(pedidoG), gramos(perfilG), Math.abs(difG) <= 1],
          ["Tiempo", duracion(p.minutos) || "—", duracion(perfilMin) || "—", Math.abs(difMin) <= 2],
          ["Colores", String(p.lineas.filter((l) => l.gramos > 0).length), String(perfil.colores.length), true],
        ] as [string, string, string, boolean][]).map(([t, ped, per, ok]) => (
          <div key={t} className={`comp-dato${ok ? "" : " mal"}`}>
            <span className="etiqueta"><span className={ok ? "ok" : "ko"}>{ok ? "✓" : "✗"}</span>{t}</span>
            <strong className="num">{ped}</strong>
            <small>{ok ? (ped === per ? "Igual que el perfil" : `Perfil: ${per}`) : `Perfil: ${per}`}</small>
          </div>
        ))}
      </div>
      <span className="comprobar-txt">
        Perfil «{perfil.titulo || "sin nombre"}»{perfil.impresora ? ` · ${perfil.impresora}` : ""}
        {!bien && <> · Con lo del perfil costaría <b className="num">{eur(deberia)}</b> (ahora {eur(p.coste)}).</>}
      </span>
      {!bien && (
        <button className="boton primario" disabled={ocupado} onClick={corregir}>{ocupado ? "Corrigiendo…" : "Corregir a lo del perfil"}</button>
      )}
    </div>
  );
}

/** compartir el enlace directo a esta pieza (WhatsApp, etc.) */
function Compartir({ p }: { p: Pedido }) {
  const { aviso } = useDatos();
  const enlace = `${location.origin}${location.pathname}#/pieza/${p.id}`;
  async function compartir() {
    try {
      if (navigator.share) await navigator.share({ title: p.titulo || "Cola 3D", text: `${p.titulo || "Mira esta pieza"} · Cola 3D`, url: enlace });
      else {
        await navigator.clipboard.writeText(enlace);
        aviso("Enlace copiado");
      }
    } catch {
      /* cancelado */
    }
  }
  return (
    <button className="boton compartir" onClick={compartir}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" /></svg>
      Compartir
    </button>
  );
}

/** comentarios de la vitrina */
function Comentarios({ p }: { p: Pedido }) {
  const { api, datos, sesion, esAdmin, aviso, recargar } = useDatos();
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const lista = (datos.comentarios || []).filter((c) => c.pedido_id === p.id);
  if (!api.comentar) return null;
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || ocupado) return;
    setOcupado(true);
    try {
      await api.comentar!(p.id, t);
      setTexto("");
      await recargar();
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido comentar", "error");
    } finally {
      setOcupado(false);
    }
  }
  async function borrar(id: string) {
    try {
      await api.borrarComentario?.(id);
      await recargar();
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido borrar", "error");
    }
  }
  const yo = api.modo === "local" ? "yo" : sesion?.id;
  return (
    <div className="bloque">
      <span className="etiqueta">Comentarios{lista.length ? ` · ${lista.length}` : ""}</span>
      <div className="comentarios">
        <AnimatePresence initial={false}>
          {lista.map((c) => (
            <motion.div key={c.id} className="comentario" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
              <Avatar nombre={c.nombre || "?"} size={30} uid={c.user_id} />
              <div className="comentario-txt">
                <span><b>{c.nombre || "Alguien"}</b> <small>{hace(c.creado)}</small></span>
                <p>{c.texto}</p>
              </div>
              {(c.user_id === yo || esAdmin) && (
                <button className="cerrar-mini" aria-label="Borrar comentario" onClick={() => borrar(c.id)}><ICerrar width={14} height={14} /></button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {sesion || api.modo === "local" ? (
          <form className="comentar" onSubmit={enviar}>
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe un comentario…" maxLength={500} aria-label="Comentario" />
            <button className="boton primario" disabled={!texto.trim() || ocupado}>Enviar</button>
          </form>
        ) : (
          <span className="comprobar-txt">Entra con tu cuenta para comentar.</span>
        )}
      </div>
    </div>
  );
}
