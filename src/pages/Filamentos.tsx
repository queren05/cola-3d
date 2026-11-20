import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useState } from "react";
import { IBobina, ICerrar, ILapiz, IMas, IPapelera } from "../components/Iconos";
import { Bobina, Numero, Vacio } from "../components/Piezas";
import { eur, gramos, num } from "../lib/formato";
import { useDatos } from "../lib/store";
import type { Filamento } from "../lib/types";

const ease = [0.22, 1, 0.36, 1] as const;
const MATERIALES = ["PLA", "PLA Mate", "PLA Silk", "PETG", "TPU", "ABS", "ASA"];

function disponibilidad(f: Filamento) {
  if (f.stock_g < 50) return { txt: "Agotado", cls: "agotado" };
  if (f.stock_g < 250) return { txt: "Queda poco", cls: "poco" };
  return { txt: "Disponible", cls: "ok" };
}

/** familia de color, para filtrar */
export function familia(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255, g = parseInt(m.slice(2, 4), 16) / 255, b = parseInt(m.slice(4, 6), 16) / 255;
  if ([r, g, b].some(isNaN)) return "Otros";
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.16) return "Negros";
  if (l > 0.86 && s < 0.5) return "Blancos";
  if (s < 0.18) return "Grises";
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 340) return l > 0.7 ? "Rosas" : "Rojos";
  if (h < 40) return l < 0.4 ? "Marrones" : "Naranjas";
  if (h < 70) return "Amarillos";
  if (h < 170) return "Verdes";
  if (h < 255) return "Azules";
  if (h < 300) return "Morados";
  return "Rosas";
}

export function Filamentos() {
  const { datos, esAdmin } = useDatos();
  const [editando, setEditando] = useState<Partial<Filamento> | null>(null);
  const [q, setQ] = useState("");
  const [material, setMaterial] = useState("");
  const [fam, setFam] = useState("");
  const [conStock, setConStock] = useState(false);
  const [orden, setOrden] = useState<"estanteria" | "stock" | "nombre">("estanteria");
  const todos = datos.filamentos.filter((f) => esAdmin || f.activo);
  const materiales = [...new Set(todos.map((f) => f.material.trim().toUpperCase()))].sort();
  const familias = [...new Set(todos.map((f) => familia(f.color)))].sort();
  const filtrando = !!q || !!material || !!fam || conStock;
  const fils = todos
    .filter((f) => (!q || `${f.nombre} ${f.material}`.toLowerCase().includes(q.toLowerCase())) && (!material || f.material.trim().toUpperCase() === material) && (!fam || familia(f.color) === fam) && (!conStock || (f.activo && f.stock_g >= 50)))
    .sort((a, b) =>
      orden === "stock" ? b.stock_g - a.stock_g : orden === "nombre" ? a.nombre.localeCompare(b.nombre, "es") : Number(b.activo) - Number(a.activo) || a.orden - b.orden,
    );
  const stock = datos.filamentos.filter((f) => f.activo).reduce((t, f) => t + f.stock_g, 0);
  const valor = datos.filamentos.filter((f) => f.activo).reduce((t, f) => t + (f.stock_g * (f.precio ?? datos.ajustes.precio_defecto)) / (f.peso || 1000), 0);

  return (
    <div className="pagina">
      <header className="cabecera-pagina con-accion">
        <div>
          <span className="sobretitulo">Lo que hay en la estantería</span>
          <h1>Filamentos</h1>
        </div>
        {esAdmin && (
          <button className="boton primario" onClick={() => setEditando({})}>
            <IMas width={18} height={18} /> Añadir rollo
          </button>
        )}
      </header>

      {datos.filamentos.length > 0 && (
        <div className="cifras">
          <div><span className="etiqueta">Colores</span><span className="cifra num">{datos.filamentos.filter((f) => f.activo).length}</span></div>
          <div><span className="etiqueta">En stock</span><span className="cifra"><Numero valor={stock} formato={gramos} /></span></div>
          {esAdmin && <div><span className="etiqueta">Vale</span><span className="cifra"><Numero valor={valor} /></span></div>}
          <div><span className="etiqueta">Sin precio propio</span><span className="cifra num">{eur(datos.ajustes.precio_defecto)}/kg</span></div>
        </div>
      )}

      {todos.length > 1 && (
        <div className="v-filtros">
          <input className="buscador" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar color o material" aria-label="Buscar" autoComplete="off" />
          <div className="v-chips">
            {materiales.length > 1 && materiales.map((m) => (
              <button key={m} className={`v-chip${material === m ? " activo" : ""}`} onClick={() => setMaterial((x) => (x === m ? "" : m))} aria-pressed={material === m}>{m}</button>
            ))}
            {familias.length > 1 && (
              <select className={`v-chip${fam ? " activo" : ""}`} value={fam} onChange={(e) => setFam(e.target.value)} aria-label="Color">
                <option value="">Todos los colores</option>
                {familias.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            )}
            <button className={`v-chip${conStock ? " activo" : ""}`} onClick={() => setConStock((v) => !v)} aria-pressed={conStock}>Solo con stock</button>
            <select className="v-chip" value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} aria-label="Ordenar">
              <option value="estanteria">Como en la estantería</option>
              <option value="stock">Más cantidad primero</option>
              <option value="nombre">Por nombre</option>
            </select>
            {filtrando && <button className="v-chip quitar" onClick={() => { setQ(""); setMaterial(""); setFam(""); setConStock(false); }}>Quitar filtros</button>}
          </div>
        </div>
      )}

      {fils.length === 0 && filtrando ? (
        <Vacio titulo="Ningún rollo con estos filtros" icono={<IBobina width={48} height={48} />} />
      ) : fils.length === 0 ? (
        <Vacio titulo="Todavía no hay filamentos" icono={<IBobina width={48} height={48} />}>
          {esAdmin && <button className="boton primario" onClick={() => setEditando({})}>Añadir el primero</button>}
        </Vacio>
      ) : (
        <LayoutGroup>
          <motion.div className="rejilla-bobinas" layout>
            <AnimatePresence>
              {fils.map((f, i) => {
                const d = disponibilidad(f);
                return (
                  <motion.article
                    key={f.id}
                    layout
                    className={`bobina-card${f.activo ? "" : " inactiva"}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.4, ease, delay: Math.min(i * 0.03, 0.3) }}
                    style={{ ["--fil" as string]: f.color }}
                  >
                    <div className="bobina-arte">
                      <Bobina color={f.color} fraccion={f.stock_g / (f.peso || 1000)} size={96} />
                    </div>
                    <div className="bobina-info">
                      <strong>{f.nombre}</strong>
                      <span className="bobina-mat">{f.material}</span>
                      <span className={`disp ${d.cls}`}>{f.activo ? d.txt : "Oculto"}</span>
                      <span className="bobina-datos num">
                        {gramos(f.stock_g)}
                        {esAdmin && <> · {eur(f.precio ?? datos.ajustes.precio_defecto)}{f.precio === null ? "*" : ""}</>}
                      </span>
                    </div>
                    {esAdmin && (
                      <button className="icono-boton esquina" aria-label={`Editar ${f.nombre}`} onClick={() => setEditando(f)}>
                        <ILapiz width={16} height={16} />
                      </button>
                    )}
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      )}

      <AnimatePresence>{editando && <EditorFilamento f={editando} onCerrar={() => setEditando(null)} />}</AnimatePresence>
    </div>
  );
}

function EditorFilamento({ f, onCerrar }: { f: Partial<Filamento>; onCerrar: () => void }) {
  const { api, clave, datos, aviso, recargar, quitar } = useDatos();
  const nuevo = !f.id;
  const [nombre, setNombre] = useState(f.nombre ?? "");
  const [material, setMaterial] = useState(f.material ?? "PLA");
  const [color, setColor] = useState(f.color ?? "#e8e8e8");
  const [precio, setPrecio] = useState(f.precio != null ? String(f.precio).replace(".", ",") : "");
  const [peso, setPeso] = useState(String(f.peso ?? datos.ajustes.peso_defecto));
  const [stock, setStock] = useState(String(Math.round(f.stock_g ?? datos.ajustes.peso_defecto)));
  const [activo, setActivo] = useState(f.activo ?? true);
  const [borrar, setBorrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function hacer(fn: () => Promise<void>, ok: string) {
    if (clave === null) return;
    setOcupado(true);
    try {
      await fn();
      aviso(ok);
      onCerrar();
      await recargar();
    } catch (e) {
      aviso(e instanceof Error ? e.message : "No se ha podido guardar", "error");
      setOcupado(false);
    }
  }
  const guardar = () =>
    hacer(
      () => api.adminFilamento(clave!, { id: f.id, nombre: nombre.trim(), material, color, precio: precio.trim() ? num(precio) : null, peso: Math.max(1, Math.round(num(peso))), stock_g: Math.max(0, num(stock)), activo, orden: f.orden ?? datos.filamentos.length }),
      nuevo ? "Rollo añadido" : "Guardado",
    );

  return (
    <motion.div className="capa" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCerrar}>
      <motion.div className="hoja hoja-form" role="dialog" aria-modal="true" aria-label={nuevo ? "Añadir rollo" : nombre} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.35, ease }} onClick={(e) => e.stopPropagation()}>
        <button className="cerrar" onClick={onCerrar} aria-label="Cerrar"><ICerrar /></button>
        <div className="hoja-scroll">
          <div className="hoja-cuerpo">
            <div className="editor-cab">
              <Bobina color={color} fraccion={num(stock) / Math.max(1, num(peso))} size={84} />
              <h2>{nuevo ? "Añadir rollo" : nombre || "Filamento"}</h2>
            </div>
            <div className="campos-dos">
              <label className="campo"><span>Nombre</span><input id="f-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Blanco" maxLength={40} /></label>
              <label className="campo"><span>Color</span>
                <span className="color-campo"><input id="f-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} /><span className="num">{color.toUpperCase()}</span></span>
              </label>
            </div>
            <div className="campo">
              <span>Material</span>
              <div className="pastillas">
                {MATERIALES.map((m) => (
                  <button type="button" key={m} className={material === m ? "activo" : ""} onClick={() => setMaterial(m)}>{m}</button>
                ))}
              </div>
            </div>
            <div className="campos-tres">
              <label className="campo"><span>Precio del rollo (€)</span><input id="f-precio" className="num" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder={String(datos.ajustes.precio_defecto).replace(".", ",")} /></label>
              <label className="campo"><span>Trae (g)</span><input id="f-peso" className="num" inputMode="numeric" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
              <label className="campo"><span>Quedan (g)</span><input id="f-stock" className="num" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} /></label>
            </div>
            <div className="fila-botones">
              <button type="button" className="boton" onClick={() => setStock(String(Math.round(num(stock) + num(peso))))}>+1 rollo</button>
              <button type="button" className="boton" onClick={() => setStock("0")}>Se ha acabado</button>
              <label className="interruptor">
                <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
                <span className="int-pista"><motion.span className="int-bola" layout transition={{ type: "spring", stiffness: 600, damping: 35 }} /></span>
                Visible
              </label>
            </div>
            <div className="fila-botones fin">
              {!nuevo && (!borrar ? (
                <button className="boton peligro-suave" onClick={() => setBorrar(true)}><IPapelera width={16} height={16} /> Borrar</button>
              ) : (
                <>
                  <button className="boton peligro" disabled={ocupado} onClick={() => hacer(async () => { await api.adminBorrarFilamento(clave!, f.id!); quitar(f.id!); }, "Rollo borrado")}>Sí, borrar</button>
                  <button className="boton" onClick={() => setBorrar(false)}>No</button>
                </>
              ))}
              <span style={{ flex: 1 }} />
              <button className="boton primario" disabled={ocupado || !nombre.trim()} onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
