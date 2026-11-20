import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IVitrina } from "../components/Iconos";
import { Ficha } from "../components/Ficha";
import { SelectorVista, useVista } from "../components/Ver";
import { Portada, reducir } from "../components/Pedido";
import { ICerrar } from "../components/Iconos";
import { Avatar, Muestra, Numero, Vacio } from "../components/Piezas";
import { clave as claveNombre, gramos, hace, n1, num } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Cuenta, Pedido } from "../lib/types";

const ease = [0.22, 1, 0.36, 1] as const;

/** cuándo se terminó de imprimir (o la última vez que se tocó) */
const cuando = (p: Pedido) => [...(p.historial || [])].reverse().find((h) => h.estado === "impreso")?.fecha || p.actualizado || p.creado;

type Orden = "recientes" | "gustan" | "grandes" | "caras";
const TAMANOS = [
  { id: "", label: "Cualquier tamaño" },
  { id: "p", label: "Pequeñas (< 50 g)" },
  { id: "m", label: "Medianas (50–200 g)" },
  { id: "g", label: "Grandes (> 200 g)" },
];
const PRECIOS = [
  { id: "", label: "Cualquier precio" },
  { id: "1", label: "Hasta 1 €" },
  { id: "5", label: "De 1 a 5 €" },
  { id: "+", label: "Más de 5 €" },
];
const enTamano = (g: number, t: string) => !t || (t === "p" ? g < 50 : t === "m" ? g >= 50 && g <= 200 : g > 200);
const enPrecio = (c: number, t: string) => !t || (t === "1" ? c <= 1 : t === "5" ? c > 1 && c <= 5 : c > 5);

/** todo lo que ha salido de la impresora, con las fotos de cómo ha quedado */
export function Vitrina({ abrir }: { abrir: (id: string) => void }) {
  const { datos, cargado, esAdmin, sesion, api } = useDatos();
  const [nueva, setNueva] = useState(false);
  const [ver, setVer] = useVista("vitrina");
  const [orden, setOrden] = useState<Orden>("recientes");
  const [soloFotos, setSoloFotos] = useState(false);
  const [soloGuardadas, setSoloGuardadas] = useState(false);
  const [persona, setPersona] = useState("");
  const [tamano, setTamano] = useState("");
  const [precio, setPrecio] = useState("");
  const [material, setMaterial] = useState("");
  const yoId = api.modo === "local" ? "yo" : sesion?.id;

  const hechas = useMemo(() => datos.pedidos.filter((p) => p.estado === "impreso" || p.estado === "entregado"), [datos.pedidos]);
  const gustan = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of datos.votos || []) m.set(v.pedido_id, (m.get(v.pedido_id) || 0) + 1);
    return m;
  }, [datos.votos]);
  const misVotos = useMemo(() => new Set((datos.votos || []).filter((v) => v.user_id === yoId).map((v) => v.pedido_id)), [datos.votos, yoId]);
  const guardadas = useMemo(() => new Set(datos.guardados || []), [datos.guardados]);
  const personas = useMemo(() => [...new Map(hechas.map((p) => [claveNombre(p.nombre), p.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es")), [hechas]);
  const materiales = useMemo(() => {
    const m = new Set<string>();
    for (const p of hechas) for (const l of p.lineas) { const f = datos.filamentos.find((x) => x.id === l.filamento_id); if (f) m.add(f.material.toUpperCase()); }
    return [...m].sort();
  }, [hechas, datos.filamentos]);
  const materialDe = (p: Pedido) => p.lineas.map((l) => datos.filamentos.find((x) => x.id === l.filamento_id)?.material.toUpperCase()).filter(Boolean);

  const lista = useMemo(() => {
    const g = (p: Pedido) => p.coste_detalle?.gramos || 0;
    const l = hechas.filter(
      (p) =>
        (!soloFotos || p.fotos?.length) &&
        (!soloGuardadas || guardadas.has(p.id)) &&
        (!persona || claveNombre(p.nombre) === persona) &&
        enTamano(g(p), tamano) &&
        enPrecio(p.coste, precio) &&
        (!material || materialDe(p).includes(material)),
    );
    const porFecha = (a: Pedido, b: Pedido) => cuando(b).localeCompare(cuando(a));
    return l.sort((a, b) =>
      orden === "gustan" ? (gustan.get(b.id) || 0) - (gustan.get(a.id) || 0) || porFecha(a, b)
        : orden === "grandes" ? g(b) - g(a) || porFecha(a, b)
        : orden === "caras" ? b.coste - a.coste || porFecha(a, b)
        : porFecha(a, b),
    );
  }, [hechas, soloFotos, soloGuardadas, guardadas, persona, tamano, precio, material, orden, gustan]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtrando = soloFotos || soloGuardadas || !!persona || !!tamano || !!precio || !!material;
  const g = hechas.reduce((t, p) => t + (p.coste_detalle?.gramos || 0), 0);
  const horas = hechas.reduce((t, p) => t + (p.minutos || 0) * Math.max(1, p.copias || 1), 0) / 60;
  const fotos = hechas.reduce((t, p) => t + (p.fotos?.length || 0), 0);
  const puedeVotar = !!yoId;

  return (
    <div className="pagina">
      <header className="cabecera-pagina con-accion">
        <div className="cabecera-pagina">
          <span className="sobretitulo">Lo que ha salido de la impresora</span>
          <h1>Vitrina</h1>
        </div>
        {esAdmin && (
          <motion.button className="boton primario" onClick={() => setNueva(true)} whileTap={{ scale: 0.96 }}>
            + Añadir pieza
          </motion.button>
        )}
      </header>
      {createPortal(<AnimatePresence>{nueva && <NuevaPiezaForm onCerrar={() => setNueva(false)} onHecha={abrir} />}</AnimatePresence>, document.body)}

      {hechas.length > 0 && (
        <div className="cifras">
          <div><span className="etiqueta">Piezas</span><span className="cifra"><Numero valor={hechas.reduce((t, p) => t + Math.max(1, p.copias || 1), 0)} formato={(v) => String(Math.round(v))} /></span></div>
          <div><span className="etiqueta">Filamento</span><span className="cifra"><Numero valor={g} formato={gramos} /></span></div>
          <div><span className="etiqueta">Imprimiendo</span><span className="cifra"><Numero valor={horas} formato={(v) => `${n1(v)} h`} /></span></div>
          <div><span className="etiqueta">Fotos</span><span className="cifra"><Numero valor={fotos} formato={(v) => String(Math.round(v))} /></span></div>
        </div>
      )}

      {hechas.length > 0 && (
        <div className="v-filtros">
          <div className="barra-filtros">
          <div className="filtros" role="tablist" aria-label="Ordenar">
            {([["recientes", "Recientes"], ["gustan", "Más gustan"], ["grandes", "Más grandes"], ["caras", "Más caras"]] as [Orden, string][]).map(([id, t]) => (
              <button key={id} className={orden === id ? "activo" : ""} onClick={() => setOrden(id)} role="tab" aria-selected={orden === id}>
                {orden === id && <motion.span layoutId="vitrina-orden" className="filtro-fondo" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
                <span>{t}</span>
              </button>
            ))}
          </div>
          <SelectorVista valor={ver} onCambio={setVer} id="vitrina" />
          </div>
          <div className="v-chips">
            <button className={`v-chip${soloFotos ? " activo" : ""}`} onClick={() => setSoloFotos((v) => !v)} aria-pressed={soloFotos}>Con foto</button>
            {puedeVotar && (
              <button className={`v-chip${soloGuardadas ? " activo" : ""}`} onClick={() => setSoloGuardadas((v) => !v)} aria-pressed={soloGuardadas}>
                <IGuardar lleno={soloGuardadas} /> Guardadas{guardadas.size ? ` · ${guardadas.size}` : ""}
              </button>
            )}
            <select className={`v-chip${persona ? " activo" : ""}`} value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="De quién">
              <option value="">De todos</option>
              {personas.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
            <select className={`v-chip${tamano ? " activo" : ""}`} value={tamano} onChange={(e) => setTamano(e.target.value)} aria-label="Tamaño">
              {TAMANOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select className={`v-chip${precio ? " activo" : ""}`} value={precio} onChange={(e) => setPrecio(e.target.value)} aria-label="Precio">
              {PRECIOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {materiales.length > 1 && (
              <select className={`v-chip${material ? " activo" : ""}`} value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material">
                <option value="">Cualquier material</option>
                {materiales.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <AnimatePresence>
              {filtrando && (
                <motion.button className="v-chip quitar" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => { setSoloFotos(false); setSoloGuardadas(false); setPersona(""); setTamano(""); setPrecio(""); setMaterial(""); }}>
                  Quitar filtros
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {!cargado ? null : lista.length === 0 ? (
        <Vacio titulo={!hechas.length ? "Aún no se ha impreso nada" : soloGuardadas ? "No has guardado ninguna" : "Nada con estos filtros"} icono={<IVitrina width={48} height={48} />} />
      ) : (
        <motion.div className={`vitrina v-${ver}`} layout>
          <AnimatePresence initial={true}>
            {lista.map((p, i) => (
              <Ficha
                key={p.id}
                layout
                role="button"
                tabIndex={0}
                className="vitrina-pieza"
                onClick={() => abrir(p.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), abrir(p.id))}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.45, ease }}
                whileHover={{ y: -4 }}
              >
                <div className={`vitrina-foto${p.fotos?.length ? "" : " sin-foto"}`}>
                  <Portada p={p} />
                  {(p.fotos?.length || 0) > 1 && <span className="vitrina-num">{p.fotos!.length} fotos</span>}
                  {!p.fotos?.length && <span className="vitrina-modelo">Foto del modelo</span>}
                  {puedeVotar && <BotonGuardar id={p.id} guardada={guardadas.has(p.id)} />}
                </div>
                <div className="vitrina-txt">
                  <strong>{p.titulo || "Pieza"}</strong>
                  <span>
                    <Avatar nombre={p.nombre} size={18} uid={p.user_id} /> {p.nombre} · {hace(cuando(p))}
                    {p.copias > 1 ? ` · ${p.copias} copias` : ""}
                  </span>
                  <div className="vitrina-pie">
                    <span className="vitrina-g num">{gramos(p.coste_detalle?.gramos || 0)}</span>
                    <BotonGusta id={p.id} n={gustan.get(p.id) || 0} mio={misVotos.has(p.id)} puede={puedeVotar} />
                  </div>
                </div>
              </Ficha>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

/** corazón con contador (me gusta) */
export function BotonGusta({ id, n, mio, puede, grande }: { id: string; n: number; mio: boolean; puede: boolean; grande?: boolean }) {
  const { api, recargar, aviso } = useDatos();
  const [optimista, setOptimista] = useState<boolean | null>(null);
  const activo = optimista ?? mio;
  const cuenta = n + (optimista === null ? 0 : optimista === mio ? 0 : optimista ? 1 : -1);
  useEffect(() => setOptimista(null), [mio, n]);
  async function pulsar(e: React.MouseEvent) {
    e.stopPropagation();
    if (!puede || !api.votar) return aviso("Entra con tu cuenta para votar", "error");
    setOptimista(!activo);
    try {
      await api.votar(id);
      await recargar();
    } catch (err) {
      setOptimista(null);
      aviso(err instanceof Error ? err.message : "No se ha podido votar", "error");
    }
  }
  return (
    <button className={`gusta${activo ? " activo" : ""}${grande ? " grande" : ""}`} onClick={pulsar} aria-pressed={activo} aria-label={activo ? "Quitar me gusta" : "Me gusta"}>
      <motion.svg key={String(activo)} width={grande ? 22 : 18} height={grande ? 22 : 18} viewBox="0 0 24 24" initial={activo ? { scale: 0.4 } : false} animate={{ scale: [null, 1.3, 1] }} transition={{ duration: 0.35 }} aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z" fill={activo ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </motion.svg>
      {cuenta > 0 && <span className="num">{cuenta}</span>}
      {grande && <span>{activo ? "Te gusta" : "Me gusta"}</span>}
    </button>
  );
}

const IGuardar = ({ lleno }: { lleno: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z" fill={lleno ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
);

/** marcador para guardar la pieza: abre un menú con tus listas (o crea una nueva) */
export function BotonGuardar({ id, guardada, grande }: { id: string; guardada: boolean; grande?: boolean }) {
  const { api, datos, recargar, aviso } = useDatos();
  const [abierto, setAbierto] = useState<DOMRect | null>(null);
  const [nueva, setNueva] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const mias = (datos.listas || []).filter((x) => x.pedido_id === id).map((x) => x.lista);
  const todas = [...new Set(["Guardados", ...(datos.listas || []).map((x) => x.lista)])];
  const activo = guardada || mias.length > 0;

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(null);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierto]);

  async function alternar(lista: string) {
    if (!api.guardarEn) return;
    try {
      const ahora = await api.guardarEn(id, lista);
      await recargar();
      aviso(ahora ? `Guardada en «${lista}»` : `Quitada de «${lista}»`);
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido guardar", "error");
    }
  }
  const ancho = 240;
  const pos = abierto ? { top: Math.min(abierto.bottom + 6, innerHeight - 320), left: Math.max(12, Math.min(abierto.right - ancho, innerWidth - ancho - 12)) } : null;
  return (
    <>
      <motion.button
        ref={btn}
        className={`guardar${activo ? " activo" : ""}${grande ? " grande" : ""}`}
        onClick={(e) => { e.stopPropagation(); setAbierto(abierto ? null : btn.current!.getBoundingClientRect()); }}
        aria-pressed={activo}
        aria-haspopup="menu"
        aria-label="Guardar en una lista"
        whileTap={{ scale: 0.85 }}
      >
        <IGuardar lleno={activo} />
        {grande && <span>{activo ? (mias.length === 1 ? mias[0] : `En ${mias.length} listas`) : "Guardar"}</span>}
      </motion.button>
      {createPortal(
        <AnimatePresence>
          {pos && (
            <>
              <div className="listas-velo" onClick={(e) => { e.stopPropagation(); setAbierto(null); }} />
              <motion.div className="listas-pop" role="menu" style={{ top: pos.top, left: pos.left, width: ancho }} onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.15 }}>
                <span className="listas-tit">Guardar en</span>
                <div className="listas-lista">
                  {todas.map((l) => (
                    <button key={l} role="menuitemcheckbox" aria-checked={mias.includes(l)} className={mias.includes(l) ? "activo" : ""} onClick={() => alternar(l)}>
                      <IGuardar lleno={mias.includes(l)} />
                      <span>{l}</span>
                      {mias.includes(l) && <span className="tema-check">✓</span>}
                    </button>
                  ))}
                </div>
                <form className="listas-nueva" onSubmit={(e) => { e.preventDefault(); const n = nueva.trim(); if (n) { alternar(n); setNueva(""); } }}>
                  <input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva lista…" maxLength={40} aria-label="Nombre de la lista nueva" />
                  <button className="boton primario" disabled={!nueva.trim()}>Crear</button>
                </form>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** el taller sube algo que ha impreso por su cuenta: sin enlace, sin cobro, para quien quiera */
function NuevaPiezaForm({ onCerrar, onHecha }: { onCerrar: () => void; onHecha: (id: string) => void }) {
  const { api, clave, datos, sesion, aviso, recargar } = useDatos();
  const [titulo, setTitulo] = useState("");
  const [para, setPara] = useState(sesion?.nombre || "");
  const [paraId, setParaId] = useState<string | null>(sesion?.id || null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  useEffect(() => {
    if (clave !== null) api.adminCuentas?.(clave).then(setCuentas).catch(() => {});
  }, [api, clave]);
  const [fotos, setFotos] = useState<{ file: File; url: string }[]>([]);
  const [filamento, setFilamento] = useState("");
  const [g, setG] = useState("");
  const [entregado, setEntregado] = useState(false);
  const [enlace, setEnlace] = useState("");
  const [notas, setNotas] = useState("");
  const [ocupado, setOcupado] = useState("");
  /** personas con cuenta y, detrás, los nombres de pedidos hechos sin cuenta */
  const personas = useMemo(() => {
    const out: Persona[] = cuentas.map((c) => ({ nombre: c.nombre, email: c.email, id: c.id }));
    const vistos = new Set(out.map((x) => claveNombre(x.nombre)));
    for (const p of datos.pedidos) {
      const k = claveNombre(p.nombre);
      if (!p.user_id && !vistos.has(k) && k !== "taller") {
        vistos.add(k);
        out.push({ nombre: p.nombre, email: "", id: null });
      }
    }
    return out;
  }, [cuentas, datos.pedidos]);
  const rollos = datos.filamentos.filter((f) => f.activo);

  useEffect(() => {
    document.body.classList.add("sin-scroll");
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => {
      document.body.classList.remove("sin-scroll");
      window.removeEventListener("keydown", k);
    };
  }, [onCerrar]);
  useEffect(() => () => fotos.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const nuevas = [...(e.target.files || [])].slice(0, 12 - fotos.length).map((file) => ({ file, url: URL.createObjectURL(file) }));
    e.target.value = "";
    setFotos((f) => [...f, ...nuevas]);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || ocupado || clave === null) return;
    try {
      const carpeta = "taller-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
      const urls: string[] = [];
      for (let i = 0; i < fotos.length; i++) {
        setOcupado(`Subiendo foto ${i + 1} de ${fotos.length}…`);
        if (api.subirFoto) urls.push(await api.subirFoto(carpeta, await reducir(fotos[i].file)));
      }
      setOcupado("Guardando…");
      const f = rollos.find((x) => x.id === filamento);
      const id = await api.adminCrearPieza(clave, {
        titulo: titulo.trim(), nombre: para.trim(), user_id: paraId, url: enlace.trim(), notas: notas.trim(), copias: 1, minutos: 0,
        estado: entregado ? "entregado" : "impreso", fotos: urls,
        lineas: f && num(g) > 0 ? [{ filamento_id: f.id, nombre: f.nombre, color: f.color, gramos: num(g) }] : [],
      });
      await recargar();
      aviso("Pieza añadida a la vitrina");
      onCerrar();
      setTimeout(() => onHecha(id), 350);
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido guardar", "error");
    } finally {
      setOcupado("");
    }
  }

  return (
    <motion.div className="velo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCerrar}>
      <motion.form
        className="panel formulario nueva-pieza"
        onSubmit={guardar}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <div className="np-cabecera">
          <h2>Añadir a la vitrina</h2>
          <button type="button" className="cerrar-mini" onClick={onCerrar} aria-label="Cerrar"><ICerrar width={18} height={18} /></button>
        </div>

        <div className="np-fotos">
          <AnimatePresence initial={false}>
            {fotos.map((f) => (
              <motion.div key={f.url} className="foto" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <img src={f.url} alt="" />
                <button type="button" className="foto-quitar" onClick={() => setFotos((x) => x.filter((y) => y !== f))} aria-label="Quitar foto"><ICerrar width={14} height={14} /></button>
              </motion.div>
            ))}
          </AnimatePresence>
          {fotos.length < 12 && (
            <label className="foto foto-subir">
              <input type="file" accept="image/*" multiple onChange={elegir} />
              <span aria-hidden="true">+</span>
              <small>{fotos.length ? "Más fotos" : "Fotos"}</small>
            </label>
          )}
        </div>

        <label className="campo">
          <span>Qué es</span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Jarrón espiral" maxLength={120} required autoFocus />
        </label>
        <div className="campo">
          <span>Para quién</span>
          <ElegirPersona personas={personas} nombre={para} id={paraId} onCambio={(n, id) => { setPara(n); setParaId(id); }} />
        </div>
        {rollos.length > 0 && (
          <div className="np-fila">
            <label className="campo">
              <span>Rollo</span>
              <select value={filamento} onChange={(e) => setFilamento(e.target.value)}>
                <option value="">Sin apuntar</option>
                {rollos.map((f) => <option key={f.id} value={f.id}>{f.nombre} · {f.material}</option>)}
              </select>
            </label>
            <label className="campo">
              <span>Gramos</span>
              <input className="num" inputMode="decimal" value={g} onChange={(e) => setG(e.target.value)} placeholder="0" disabled={!filamento} />
            </label>
            {filamento && <Muestra color={rollos.find((f) => f.id === filamento)?.color || "#999"} size={22} />}
          </div>
        )}
        <label className="np-check">
          <input type="checkbox" checked={entregado} onChange={(e) => setEntregado(e.target.checked)} />
          <span>Ya está entregado</span>
        </label>
        <label className="campo">
          <span>Enlace (si tiene)</span>
          <input value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="https://makerworld.com/…" inputMode="url" />
        </label>
        <label className="campo">
          <span>Notas</span>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} maxLength={600} />
        </label>
        <button className="boton primario ancho grande" disabled={!titulo.trim() || !!ocupado}>{ocupado || "Añadir a la vitrina"}</button>
      </motion.form>
    </motion.div>
  );
}

interface Persona {
  nombre: string;
  email: string;
  id: string | null;
}

/** desplegable propio con las personas que tienen cuenta (se puede escribir otro nombre) */
function ElegirPersona({ personas, nombre, id, onCambio }: { personas: Persona[]; nombre: string; id: string | null; onCambio: (nombre: string, id: string | null) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const filtro = claveNombre(q);
  const lista = personas.filter((p) => !filtro || claveNombre(p.nombre).includes(filtro) || p.email.toLowerCase().includes(q.toLowerCase()));
  const opciones: Persona[] = [{ nombre: "Taller", email: "", id: null }, ...lista];
  if (q.trim() && !lista.some((p) => claveNombre(p.nombre) === filtro)) opciones.push({ nombre: q.trim(), email: "nuevo", id: null });

  useEffect(() => {
    if (!abierto) return;
    const f = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [abierto]);

  function elegir(p: Persona) {
    onCambio(p.nombre === "Taller" && !p.id ? "" : p.nombre, p.id);
    setAbierto(false);
    setQ("");
  }
  const actual = personas.find((p) => p.id && p.id === id);

  return (
    <div className="persona-sel" ref={caja}>
      <button type="button" className={`persona-btn${abierto ? " abierto" : ""}`} onClick={() => { setAbierto((v) => !v); setActivo(0); }} aria-haspopup="listbox" aria-expanded={abierto}>
        <Avatar nombre={nombre || "Taller"} size={28} uid={id} />
        <span className="persona-btn-txt">
          <strong>{nombre || "Taller"}</strong>
          <small>{actual ? actual.email : nombre ? "Sin cuenta" : "Lo ha hecho el taller"}</small>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="persona-flecha"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <AnimatePresence>
        {abierto && (
          <motion.div className="persona-pop" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.16 }}>
            <input
              className="persona-buscar"
              value={q}
              onChange={(e) => { setQ(e.target.value); setActivo(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(opciones.length - 1, a + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(0, a - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); opciones[activo] && elegir(opciones[activo]); }
                else if (e.key === "Escape") { e.stopPropagation(); setAbierto(false); }
              }}
              placeholder="Buscar o escribir un nombre"
              autoComplete="off"
              autoFocus
              name="buscar-persona-cola3d"
            />
            <div className="persona-lista" role="listbox">
              {opciones.map((p, i) => (
                <button
                  type="button"
                  key={(p.id || "") + p.nombre + i}
                  role="option"
                  aria-selected={(p.id ? p.id === id : p.nombre === (nombre || "Taller"))}
                  className={`persona-op${i === activo ? " activo" : ""}`}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => elegir(p)}
                >
                  <Avatar nombre={p.nombre} size={30} uid={p.id} />
                  <span className="persona-btn-txt">
                    <strong>{p.email === "nuevo" ? `Usar «${p.nombre}»` : p.nombre}</strong>
                    <small>{p.email === "nuevo" ? "Sin cuenta" : p.email || (p.nombre === "Taller" && !p.id ? "Lo ha hecho el taller" : "Sin cuenta")}</small>
                  </span>
                  {(p.id ? p.id === id : p.email !== "nuevo" && p.nombre === (nombre || "Taller")) && <span className="persona-check">✓</span>}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
