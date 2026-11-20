import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { ICerrar, ICheck, IMas } from "../components/Iconos";
import { Bobina, EtiquetaColor, Muestra, Numero, ClaveInput } from "../components/Piezas";
import { aplicarGratis, calcularCoste, gratisRestante, juntarLineas } from "../lib/coste";
import { dominio, duracion, eur, gramos, limpiarUrl, n1, num, tintaSobre } from "../lib/formato";
import { useDatos } from "../lib/store";
import { alternativas, esA1mini, esMakerWorld, lineasDePerfil, tieneMaterial, type Falta, minutosA1mini, perfilInicial, urlConPerfil } from "../lib/perfiles";
import type { Linea, Perfil } from "../lib/types";
import { vistaPrevia, type Vista } from "../lib/vista-previa";

const ease = [0.22, 1, 0.36, 1] as const;
const POCO = 50; // gramos: por debajo se considera agotado

interface LineaForm extends Linea {
  key: string;
  txt: string;
  /** color o material del modelo que no hay en el taller */
  falta?: Falta;
  /** a qué se ha cambiado, o que lo elija el taller */
  cambio?: string;
  /** cómo venía en el perfil (para deshacer) */
  orig?: { filamento_id: string | null; nombre: string; color: string; falta?: Falta };
  /** el color que pide el modelo (para el texto) */
  pide?: string;
}

/** «#ff0000» → nombre aproximado para la nota */
function nombreColor(hex: string): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510, d = max - min;
  if (d < 25) return l > 0.85 ? "blanco" : l < 0.15 ? "negro" : "gris";
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 340) return l > 0.7 ? "rosa" : "rojo";
  if (hue < 40) return l < 0.35 ? "marrón" : "naranja";
  if (hue < 65) return "amarillo";
  if (hue < 165) return "verde";
  if (hue < 200) return "turquesa";
  if (hue < 255) return "azul";
  if (hue < 290) return "morado";
  return "rosa";
}

export function Pedir({ ir }: { ir: (r: string) => void }) {
  const { api, datos, yo, setYo, sesion, guardarToken, aviso, setResaltado } = useDatos();
  const filamentos = datos.filamentos.filter((f) => f.activo);
  const [nombre, setNombre] = useState(yo);
  const [urlTxt, setUrlTxt] = useState("");
  const [titulo, setTitulo] = useState("");
  const [vista, setVista] = useState<Vista | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [horas, setHoras] = useState("");
  const [mins, setMins] = useState("");
  const [copias, setCopias] = useState(1);
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);
  const ultimaUrl = useRef("");
  const [perfilId, setPerfilId] = useState<string | null>(null);
  const filamentosRef = useRef(filamentos);
  filamentosRef.current = filamentos;

  useEffect(() => setNombre((n) => n || yo), [yo]);
  // sin filamentos dados de alta: una línea libre con el precio por defecto
  useEffect(() => {
    if (!filamentos.length && !lineas.length) setLineas([{ key: "libre", filamento_id: null, nombre: "Color a elegir", color: "#9aa3ad", gramos: 0, txt: "" }]);
  }, [filamentos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const url = limpiarUrl(urlTxt);
  useEffect(() => {
    if (!url || url === ultimaUrl.current) return;
    const t = setTimeout(async () => {
      ultimaUrl.current = url;
      setBuscando(true);
      const v = await vistaPrevia(url, api).catch(() => null);
      if (ultimaUrl.current !== url) return;
      setVista(v);
      setTitulo((t) => t || v?.titulo || "");
      const ini = v?.perfiles?.length ? perfilInicial(v.perfiles, url) : undefined;
      if (ini?.a1mini) aplicar(ini);
      else setPerfilId(null);
      setBuscando(false);
    }, 450);
    return () => clearTimeout(t);
  }, [url, api]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // si varios colores acaban en el mismo rollo (p. ej. «pues todo en gris»), sus gramos se juntan en una sola línea
  const lineasCalc: Linea[] = juntarLineas(lineas.map(({ key, txt, falta, cambio, ...l }) => ({ ...l, gramos: num(txt) })));
  // colores que no hay en el taller y aún no tienen solución
  const sinResolver = filamentos.length > 0 ? lineas.filter((l) => !l.filamento_id && !l.cambio && num(l.txt) > 0) : [];
  const minutos = Math.round(num(horas) * 60 + num(mins));
  const nombreFinal = (sesion?.nombre || nombre).trim();
  const gratisTotal = datos.ajustes.gratis_g ?? 50;
  const gratis = gratisRestante(datos.pedidos, datos.ajustes, sesion?.id, nombreFinal);
  const det = useMemo(
    () => aplicarGratis(calcularCoste(lineasCalc, minutos, copias, datos.filamentos, datos.ajustes), gratis),
    [JSON.stringify(lineasCalc), minutos, copias, datos, gratis], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // ordena: primero los hechos para la A1 mini, luego los que también le sirven
  const perfiles = useMemo(() => [...(vista?.perfiles || [])].sort((a, b) => Number(esA1mini(b)) - Number(esA1mini(a)) || Number(b.a1mini) - Number(a.a1mini)), [vista]);
  const mw = !!url && esMakerWorld(url);
  // con los perfiles a mano: hace falta uno que valga para la A1 mini
  const sinPerfil = mw && perfiles.length > 0 && !perfiles.some((p) => p.a1mini);
  const perfilMalo = perfiles.find((p) => p.id === perfilId && !p.a1mini);
  // con perfil de MakerWorld, los gramos y el tiempo los marca el perfil: solo se cambia el color de cada parte
  const bloqueado = !!perfilId && perfiles.some((p) => p.id === perfilId);
  const necesitaPerfil = !!api.vistaPrevia && !bloqueado;
  const listo = !!nombreFinal && mw && !sinPerfil && !perfilMalo && !necesitaPerfil && det.gramos > 0 && sinResolver.length === 0;
  const nColores = lineasCalc.filter((l) => l.gramos > 0).length;
  const esPeticion = nColores > 4;
  const falta = !nombreFinal ? "Pon tu nombre" : !url ? "Pega el enlace" : !mw ? "Solo MakerWorld" : sinPerfil || perfilMalo ? "Sin perfil para A1 mini" : necesitaPerfil ? (buscando ? "Leyendo el modelo…" : "Elige un perfil") : det.gramos <= 0 ? "Pon los gramos" : sinResolver.length ? "Elige otro color" : "";


  function aplicar(p: Perfil) {
    setPerfilId(p.id);
    const ls = lineasDePerfil(p, filamentosRef.current);
    setLineas(
      ls.map((l, i) => ({
        ...l,
        key: `perfil-${i}`,
        txt: String(l.gramos).replace(".", ","),
        orig: { filamento_id: l.filamento_id, nombre: l.nombre, color: l.color, falta: l.falta },
        pide: l.falta ? `${l.falta.material} ${nombreColor(l.falta.color)}` : l.nombre,
      })),
    );
    const m = minutosA1mini(p);
    setHoras(m >= 60 ? String(Math.floor(m / 60)) : "");
    setMins(m % 60 ? String(m % 60) : "");
  }

  function alternar(fid: string) {
    const f = filamentos.find((x) => x.id === fid);
    if (!f) return;
    setLineas((ls) => {
      const sin = ls.filter((l) => l.key !== "libre" || l.txt);
      return sin.some((l) => l.filamento_id === fid) ? sin.filter((l) => l.filamento_id !== fid) : [...sin, { key: fid, filamento_id: fid, nombre: f.nombre, color: f.color, gramos: 0, txt: "" }];
    });
  }
  // colores que no hay: cambiarlos por uno del taller o dejar que lo elija el taller (va a las notas)
  const descr = (l: LineaForm) => (l.falta ? `${l.falta.material} ${nombreColor(l.falta.color)}` : `${l.nombre ? l.nombre + " " : ""}${nombreColor(l.color)}`.trim());
  function cambiarPor(l: LineaForm, f: { id: string; nombre: string; color: string; material: string }) {
    setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, filamento_id: f.id, nombre: f.nombre, color: f.color, falta: x.falta || { color: x.color, material: "" }, cambio: `Cambio ${descr(x)} por ${f.nombre} (${f.material})` } : x)));
  }
  function queElija(l: LineaForm) {
    setLineas((ls) =>
      ls.map((x) =>
        x.key === l.key
          ? { ...x, filamento_id: null, nombre: x.orig?.falta?.material || x.nombre, color: x.orig?.falta?.color || x.orig?.color || x.color, cambio: `${x.pide || descr(x)}: que lo elija el taller` }
          : x,
      ),
    );
  }
  function deshacer(l: LineaForm) {
    setLineas((ls) =>
      ls.map((x) =>
        x.key !== l.key ? x : x.orig ? { ...x, filamento_id: x.orig.filamento_id, nombre: x.orig.nombre, color: x.orig.color, falta: x.orig.falta, cambio: undefined }
          : { ...x, filamento_id: null, nombre: x.falta?.material || x.nombre, color: x.falta?.color || x.color, cambio: undefined },
      ),
    );
  }
  /** desplegable de cada color del perfil: otro rollo, el original o que lo elija el taller */
  function elegirRollo(l: LineaForm, v: string) {
    if (v === "orig") return deshacer(l);
    if (v === "taller") return queElija(l);
    const f = filamentos.find((x) => x.id === v);
    if (!f) return;
    if (l.orig && l.orig.filamento_id === f.id) return deshacer(l);
    setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, filamento_id: f.id, nombre: f.nombre, color: f.color, cambio: `Cambio ${x.pide || descr(x)} por ${f.nombre} (${f.material})` } : x)));
  }

  function otroColor() {
    setLineas((ls) => [...ls, { key: "otro-" + Date.now(), filamento_id: null, nombre: "", color: "#9aa3ad", gramos: 0, txt: "" }]);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!listo || enviando) return;
    setEnviando(true);
    try {
      if (!sesion) setYo(nombreFinal);
      const r = await api.crearPedido({
        nombre: nombreFinal, url: urlConPerfil(url, perfiles.find((p) => p.id === perfilId)), titulo: titulo.trim(), imagen: vista?.imagen || "",
        lineas: lineasCalc.filter((l) => l.gramos > 0).map((l) => ({ ...l, nombre: l.nombre || "Otro color" })),
        minutos, copias, notas: [notas.trim(), ...lineas.filter((l) => l.cambio && num(l.txt) > 0).map((l) => l.cambio)].filter(Boolean).join("\n"),
      });
      guardarToken(r.id, r.token);
      setHecho(true);
      setTimeout(() => {
        setResaltado(r.id);
        ir("");
      }, 1100);
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido enviar", "error");
      setEnviando(false);
    }
  }

  if (api.cuentas && !sesion) return <Cuenta />;

  const fraccionRollo = det.gramos / Math.max(1, datos.ajustes.peso_defecto);

  return (
    <div className="pagina">
      <header className="cabecera-pagina">
        <span className="sobretitulo">Nuevo pedido</span>
        <h1>Pedir una figura</h1>
      </header>

      <form className="pedir" onSubmit={enviar} noValidate>
        <div className="pedir-campos">
          <AnimatePresence initial={false}>
            {gratis > 0 && (sesion || nombreFinal) && (
              <motion.div key="regalo" className="regalo" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}>
                <span className="regalo-icono" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" /></svg>
                </span>
                <span>
                  {gratis >= gratisTotal ? (
                    <><strong>Tu primera impresión: los primeros {n1(gratisTotal)} g son gratis.</strong> Si gastas menos, lo que sobre se guarda para la siguiente.</>
                  ) : (
                    <><strong>Te quedan {n1(gratis)} g gratis</strong> de tus {n1(gratisTotal)} g de regalo.</>
                  )}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          {!sesion && (
            <label className="campo">
              <span>Quién eres</span>
              <input id="p-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Jorlo" maxLength={40} autoComplete="nickname" />
            </label>
          )}

          <label className="campo">
            <span>Enlace de la figura</span>
            <input id="p-url" value={urlTxt} onChange={(e) => setUrlTxt(e.target.value)} placeholder="https://makerworld.com/es/models/…" inputMode="url" autoComplete="off" aria-invalid={!!url && !mw} />
            <span className={`requisito${url && !mw ? " mal" : ""}`}>Solo modelos de MakerWorld con perfil de impresión para la A1 mini</span>
          </label>

          <AnimatePresence>
            {url && (
              <motion.div className="vista" key="vista" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease }}>
                <div className="vista-inner">
                  <div className={`vista-img${buscando ? " cargando" : ""}`}>
                    <AnimatePresence mode="wait">
                      {vista?.imagen && !buscando ? (
                        <motion.img key={vista.imagen} src={vista.imagen} alt="" referrerPolicy="no-referrer" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease }} />
                      ) : (
                        <motion.span key="sin" className="vista-dominio" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          {buscando ? "" : dominio(url)}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <label className="campo">
                    <span>Qué es</span>
                    <input id="p-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={buscando ? "Buscando…" : "Dragón articulado"} maxLength={120} />
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {perfiles.length > 0 && (
              <motion.fieldset className="campo perfiles" key="perfiles" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease }}>
                <legend>Perfil de impresión</legend>
                <div className="perfiles-lista">
                  {perfiles.map((p, i) => {
                    const sel = p.id === perfilId;
                    return (
                      <motion.button type="button" key={p.id} className={`perfil${sel ? " sel" : ""}`} ref={sel ? (el: HTMLButtonElement | null) => el && requestAnimationFrame(() => el.parentElement?.scrollTo({ left: el.offsetLeft - el.parentElement.offsetLeft - 2, behavior: "smooth" })) : undefined} onClick={() => aplicar(p)} aria-pressed={sel} disabled={!p.a1mini} whileTap={{ scale: 0.97 }}
                        initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i, duration: 0.35, ease }}>
                        <span className="perfil-titulo">{p.titulo || "Perfil"}</span>
                        <span className="perfil-datos num">
                          <b>{gramos(p.gramos)}</b>
                          <i aria-hidden="true" />
                          <b>{duracion(minutosA1mini(p)) || "—"}</b>
                        </span>
                        <span className="perfil-colores">
                          {p.colores.slice(0, 8).map((c, j) => <Muestra key={j} color={c.color} size={12} />)}
                          {p.placas > 1 && <span>{p.placas} placas</span>}
                        </span>
                        <span className={`perfil-imp${esA1mini(p) ? " ok" : p.a1mini ? "" : " mal"}`}>
                          {esA1mini(p) ? "A1 mini" : p.a1mini ? `De ${p.impresora || "otra"} · vale para A1 mini` : `Solo ${p.impresora || "otra impresora"}`}
                        </span>
                        {sel && <motion.span layoutId="perfil-marca" className="perfil-marca"><ICheck width={12} height={12} /></motion.span>}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.fieldset>
            )}
          </AnimatePresence>

          <fieldset className="campo">
            <legend>Colores</legend>
            {filamentos.length > 0 && !bloqueado && (
              <div className="colores-elegir">
                {filamentos.map((f) => {
                  const sel = lineas.some((l) => l.filamento_id === f.id);
                  const agotado = f.stock_g < POCO;
                  return (
                    <motion.button
                      type="button"
                      key={f.id}
                      className={`color-opcion${sel ? " sel" : ""}`}
                      disabled={agotado}
                      onClick={() => alternar(f.id)}
                      whileTap={{ scale: 0.94 }}
                      aria-pressed={sel}
                      title={agotado ? "Agotado" : `${f.material} · ${gramos(f.stock_g)} disponibles`}
                    >
                      <span className="color-bola" style={{ background: f.color, color: tintaSobre(f.color) }}>
                        <AnimatePresence>{sel && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><ICheck width={14} height={14} /></motion.span>}</AnimatePresence>
                      </span>
                      <span className="color-nombre">{f.nombre}</span>
                      <span className="color-sub">{agotado ? "Agotado" : f.material}</span>
                    </motion.button>
                  );
                })}
                <motion.button type="button" className="color-opcion otro" onClick={otroColor} whileTap={{ scale: 0.94 }}>
                  <span className="color-bola"><IMas width={16} height={16} /></span>
                  <span className="color-nombre">Otro</span>
                  <span className="color-sub">No está</span>
                </motion.button>
              </div>
            )}

            <AnimatePresence initial={false}>
              {esPeticion && (
                <motion.div key="peticion" className="peticion-aviso" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <strong>Este modelo lleva {nColores} colores</strong>
                  <span>La impresora pone 4 colores a la vez. Puedes enviarlo como petición y el taller te dirá si se puede hacer; mientras tanto no hace falta pagar.</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="lineas">
              <AnimatePresence initial={false}>
                {lineas.map((l) => (
                  <motion.div key={l.key} className="linea-caja" layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.3, ease }}>
                  {bloqueado ? (
                    <div className="linea bloqueada">
                      <span className="linea-sel" style={{ ["--fil" as string]: l.color }}>
                        <Muestra color={l.color} size={18} />
                        <select
                          aria-label={`Color para ${l.pide || l.nombre}`}
                          value={l.filamento_id || (l.cambio ? "taller" : "orig")}
                          onChange={(e) => elegirRollo(l, e.target.value)}
                        >
                          {!l.orig?.filamento_id && <option value="orig" disabled>{l.pide || l.nombre}: no lo tengo</option>}
                          {[...new Set(filamentos.filter((f) => f.stock_g >= 50).map((f) => f.material.toUpperCase()))].sort().map((m) => (
                            <optgroup key={m} label={m}>
                              {filamentos.filter((f) => f.stock_g >= 50 && f.material.toUpperCase() === m).map((f) => (
                                <option key={f.id} value={f.id}>{f.nombre}</option>
                              ))}
                            </optgroup>
                          ))}
                          <option value="taller">Que lo elija el taller</option>
                        </select>
                      </span>
                      <span className="linea-fija num" title="Lo marca el perfil de MakerWorld">{l.txt} g</span>
                    </div>
                  ) : (
                  <div className="linea">
                    {l.filamento_id ? (
                      <EtiquetaColor nombre={l.nombre} color={l.color} />
                    ) : (
                      <span className="linea-libre">
                        <input type="color" aria-label="Color" value={l.color} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, color: e.target.value } : x)))} />
                        <input aria-label="Nombre del color" value={l.nombre} placeholder="Color" maxLength={40} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, nombre: e.target.value } : x)))} />
                      </span>
                    )}
                    <span className="linea-g">
                      <input className="num" inputMode="decimal" aria-label={`Gramos de ${l.nombre || "este color"}`} placeholder="0" value={l.txt} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, txt: e.target.value } : x)))} />
                      <span className="unidad">g</span>
                    </span>
                    {(lineas.length > 1 || filamentos.length > 0) && (
                      <button type="button" className="icono-boton" aria-label="Quitar color" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}>
                        <ICerrar width={16} height={16} />
                      </button>
                    )}
                  </div>
                  )}
                  <AnimatePresence initial={false}>
                    {filamentos.length > 0 && !l.filamento_id && !l.cambio && num(l.txt) > 0 && (
                      <motion.div key="aviso" className="aviso-color" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }}>
                        <div className="aviso-in">
                          <strong>
                            <Muestra color={l.falta?.color || l.color} size={12} />
                            {l.falta
                              ? tieneMaterial(l.falta.material, filamentos) ? `No tengo ${l.falta.material} ${nombreColor(l.falta.color)}` : `No tengo ${l.falta.material}`
                              : "Ese color no lo tengo"}
                          </strong>
                          <div className="aviso-opciones">
                            {alternativas(l.falta || { color: l.color, material: "" }, filamentos).map((f) => (
                              <motion.button type="button" key={f.id} className="alt" whileTap={{ scale: 0.95 }} onClick={() => cambiarPor(l, f)}>
                                <Muestra color={f.color} size={14} />
                                {f.nombre} <small>{f.material}</small>
                              </motion.button>
                            ))}
                            <motion.button type="button" className="alt taller" whileTap={{ scale: 0.95 }} onClick={() => queElija(l)}>
                              Que lo elija el taller
                            </motion.button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    {l.cambio && (
                      <motion.div key="cambio" className="cambio-color" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                        <span>{l.cambio}</span>
                        <button type="button" onClick={() => deshacer(l)}>Deshacer</button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </fieldset>

          <div className="campos-dos">
            <div className="campo">
              <span>Tiempo de impresión</span>
              <div className="duo">
                <span className="con-unidad"><input className="num" inputMode="numeric" aria-label="Horas" placeholder="0" value={horas} onChange={(e) => setHoras(e.target.value)} readOnly={bloqueado} /><span className="unidad">h</span></span>
                <span className="con-unidad"><input className="num" inputMode="numeric" aria-label="Minutos" placeholder="0" value={mins} onChange={(e) => setMins(e.target.value)} readOnly={bloqueado} /><span className="unidad">min</span></span>
              </div>
            </div>
            <div className="campo">
              <span>Copias</span>
              <div className="contador">
                <button type="button" aria-label="Una menos" onClick={() => setCopias((c) => Math.max(1, c - 1))}>−</button>
                <motion.span key={copias} className="num" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{copias}</motion.span>
                <button type="button" aria-label="Una más" onClick={() => setCopias((c) => Math.min(50, c + 1))}>+</button>
              </div>
            </div>
          </div>

          <label className="campo">
            <span>Notas</span>
            <textarea id="p-notas" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={600} rows={3} placeholder="Escala 120 %, para el cumple del 12" />
          </label>
        </div>

        <aside className="resumen">
          <div className="resumen-card">
            <div className="resumen-top">
              <Bobina color={det.lineas.find((l) => l.gramos > 0)?.color || "var(--hot)"} fraccion={fraccionRollo} size={72} />
              <div>
                <span className="etiqueta">Coste</span>
                <div className="resumen-total"><Numero valor={det.total} /></div>
                <span className="resumen-sub num">{gramos(det.gramos)} · {n1(fraccionRollo * 100)} % de un rollo</span>
              </div>
            </div>
            <div className="resumen-lineas">
              <AnimatePresence initial={false}>
                {det.lineas.filter((l) => l.gramos > 0).map((l, i) => (
                  <motion.div key={l.nombre + i} className="r-fila" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <Muestra color={l.color} size={10} />
                    <span>{l.nombre || "Color"}</span>
                    <span className="num">{eur(l.coste)}</span>
                  </motion.div>
                ))}
                {det.merma > 0 && (
                  <motion.div key="merma" className="r-fila" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <span className="muestra multicolor" style={{ width: 10, height: 10 }} />
                    <span>Purga de colores +{det.merma_pct} %</span>
                    <span className="num">{eur(det.merma)}</span>
                  </motion.div>
                )}
                {(det.descuento || 0) > 0 && (
                  <motion.div key="gratis" className="r-fila r-gratis" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <span className="muestra" style={{ width: 10, height: 10, background: "var(--ok)" }} />
                    <span>{n1(det.gratis_g || 0)} g gratis</span>
                    <span className="num">−{eur(det.descuento || 0)}</span>
                  </motion.div>
                )}
                {det.luz > 0 && (
                  <motion.div key="luz" className="r-fila" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <span className="muestra" style={{ width: 10, height: 10, background: "var(--st-imprimiendo)" }} />
                    <span>Luz y desgaste · {duracion(minutos * copias)}</span>
                    <span className="num">{eur(det.luz)}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <motion.button type="submit" className={`boton primario ancho grande${hecho ? " exito" : ""}`} disabled={!listo || enviando} whileTap={{ scale: 0.97 }}>
              <AnimatePresence mode="wait" initial={false}>
                {hecho ? (
                  <motion.span key="ok" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="boton-ok"><ICheck width={20} height={20} /> En la cola</motion.span>
                ) : (
                  <motion.span key="txt" exit={{ opacity: 0, y: -6 }}>{enviando ? "Enviando…" : falta || (esPeticion ? "Enviar como petición" : "Añadir a la cola")}</motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </aside>
      </form>
      {hecho && <Confeti />}
    </div>
  );
}

/** trocitos de filamento que saltan al enviar */
function Confeti() {
  const { datos } = useDatos();
  const cols = datos.filamentos.map((f) => f.color).concat(["#ff5b1f", "#ffd23f", "#2ec4b6", "#5b6cff"]);
  return (
    <div className="confeti" aria-hidden="true">
      {Array.from({ length: 28 }).map((_, i) => {
        const a = (i / 28) * Math.PI * 2;
        const d = 120 + (i % 5) * 40;
        return (
          <motion.span
            key={i}
            style={{ background: cols[i % cols.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d - 60, opacity: 0, rotate: 260 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

function Cuenta() {
  const { api, setSesion, aviso } = useDatos();
  const [modo, setModo] = useState<"entrar" | "crear" | "olvido">("entrar");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      if (modo === "olvido") {
        await api.recuperar!(email.trim());
        aviso("Te hemos mandado un correo para cambiarla");
        setModo("entrar");
        return;
      }
      if (modo === "crear") await api.registrar!(nombre.trim(), email.trim(), clave);
      else await api.entrar!(email.trim(), clave);
      const s = await api.sesion!();
      if (!s && modo === "crear") aviso("Revisa tu correo para confirmar la cuenta");
      setSesion(s);
    } catch (err) {
      aviso(err instanceof Error ? err.message : "No se ha podido entrar", "error");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="pagina estrecha">
      <header className="cabecera-pagina">
        <span className="sobretitulo">Para pedir figuras</span>
        <h1>{modo === "entrar" ? "Entrar" : modo === "crear" ? "Crear cuenta" : "Cambiar contraseña"}</h1>
      </header>
      <form className="panel formulario" onSubmit={enviar}>
        <AnimatePresence initial={false}>
          {modo === "crear" && (
            <motion.label className="campo" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <span>Tu nombre</span>
              <input id="c-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" required />
            </motion.label>
          )}
        </AnimatePresence>
        <label className="campo"><span>Correo</span><input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
        {modo !== "olvido" && (
          <label className="campo"><span>Contraseña</span><ClaveInput id="c-clave" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete={modo === "crear" ? "new-password" : "current-password"} minLength={6} required /></label>
        )}
        <button className="boton primario ancho" disabled={ocupado}>{modo === "entrar" ? "Entrar" : modo === "crear" ? "Crear cuenta" : "Mandarme el correo"}</button>
        <button type="button" className="boton plano" onClick={() => setModo(modo === "entrar" ? "crear" : "entrar")}>
          {modo === "entrar" ? "No tengo cuenta" : "Ya tengo cuenta"}
        </button>
        {modo === "entrar" && (
          <button type="button" className="boton plano" onClick={() => setModo("olvido")}>He olvidado la contraseña</button>
        )}
      </form>
    </div>
  );
}
