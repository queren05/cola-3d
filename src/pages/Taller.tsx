import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ICandado } from "../components/Iconos";
import { Avatar, Numero, ClaveInput } from "../components/Piezas";
import { eur, gramos, hace, num } from "../lib/formato";
import type { Cuenta } from "../lib/types";
import { useDatos } from "../lib/store";

const ease = [0.22, 1, 0.36, 1] as const;

export function Taller() {
  const { esAdmin, api } = useDatos();
  return <div className="pagina estrecha">{esAdmin ? <Panel /> : api.cuentas ? <SoloDueno /> : <Entrar />}</div>;
}

function SoloDueno() {
  const { sesion } = useDatos();
  return (
    <header className="cabecera-pagina centro">
      <motion.span className="candado" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
        <ICandado width={34} height={34} />
      </motion.span>
      <h1>Taller</h1>
      <p className="muted">{sesion ? "Esta cuenta no tiene acceso al taller." : "Solo puede entrar el dueño del taller con su cuenta."}</p>
    </header>
  );
}

function Entrar() {
  const { entrarTaller } = useDatos();
  const [c, setC] = useState("");
  const [mal, setMal] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!c || ocupado) return;
    setOcupado(true);
    const ok = await entrarTaller(c);
    setOcupado(false);
    if (!ok) {
      setMal((m) => m + 1);
      setC("");
    }
  }
  return (
    <>
      <header className="cabecera-pagina centro">
        <motion.span className="candado" key={mal} animate={mal ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
          <ICandado width={34} height={34} />
        </motion.span>
        <h1>Taller</h1>
      </header>
      <form className="panel formulario" onSubmit={enviar}>
        <label className="campo">
          <span>Clave del taller</span>
          <ClaveInput id="t-clave" value={c} onChange={(e) => setC(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        <AnimatePresence>{mal > 0 && <motion.p className="error-txt" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0 }}>Clave incorrecta</motion.p>}</AnimatePresence>
        <button className="boton primario ancho" disabled={!c || ocupado}>{ocupado ? "Comprobando…" : "Entrar"}</button>
      </form>
    </>
  );
}

function Panel() {
  const { api, clave, datos, aviso, salirTaller } = useDatos();
  const a = datos.ajustes;
  const [precio, setPrecio] = useState("");
  const [peso, setPeso] = useState("");
  const [luz, setLuz] = useState("");
  const [merma, setMerma] = useState("");
  const [bizum, setBizum] = useState("");
  const [gratisG, setGratisG] = useState("");
  const [nueva, setNueva] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    setPrecio(String(a.precio_defecto).replace(".", ","));
    setPeso(String(a.peso_defecto));
    setLuz(String(a.luz_hora).replace(".", ","));
    setMerma(String(a.merma_pct).replace(".", ","));
    setBizum(a.bizum || "");
    setGratisG(String(a.gratis_g ?? 50));
  }, [a.precio_defecto, a.peso_defecto, a.luz_hora, a.merma_pct, a.bizum, a.gratis_g]);

  const ps = datos.pedidos;
  const hechos = ps.filter((p) => p.estado === "impreso" || p.estado === "entregado");
  const cobrado = hechos.filter((p) => p.pagado).reduce((t, p) => t + p.coste, 0);
  const porCobrar = hechos.filter((p) => !p.pagado).reduce((t, p) => t + p.coste, 0);
  const pendientes = ps.filter((p) => p.estado === "pendiente" || p.estado === "imprimiendo");
  const gImpresos = hechos.reduce((t, p) => t + (p.coste_detalle?.gramos || 0), 0);
  const horas = hechos.reduce((t, p) => t + p.minutos * p.copias, 0) / 60;

  async function hacer(fn: () => Promise<void>, ok: string) {
    if (clave === null) return;
    setOcupado(true);
    try {
      await fn();
      aviso(ok);
    } catch (e) {
      aviso(e instanceof Error ? e.message : "No se ha podido guardar", "error");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <header className="cabecera-pagina con-accion">
        <div>
          <span className="sobretitulo">Solo para ti</span>
          <h1>Taller</h1>
        </div>
        {clave !== "" && <button className="boton" onClick={salirTaller}>Salir</button>}
      </header>

      <motion.div className="cifras grande" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ease }}>
        <div><span className="etiqueta">Por cobrar</span><span className="cifra debe"><Numero valor={porCobrar} /></span></div>
        <div><span className="etiqueta">Cobrado</span><span className="cifra"><Numero valor={cobrado} /></span></div>
        <div><span className="etiqueta">Pedidos por hacer</span><span className="cifra num">{pendientes.length}</span></div>
        <div><span className="etiqueta">Impreso</span><span className="cifra num">{gramos(gImpresos)} · {Math.round(horas)} h</span></div>
      </motion.div>

      <section className="panel formulario">
        <h2>Precios</h2>
        <div className="campos-dos">
          <label className="campo"><span>Rollo sin precio propio (€)</span><input id="a-precio" className="num" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} /></label>
          <label className="campo"><span>Gramos por rollo</span><input id="a-peso" className="num" inputMode="numeric" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
          <label className="campo"><span>Luz y desgaste por hora (€)</span><input id="a-luz" className="num" inputMode="decimal" value={luz} onChange={(e) => setLuz(e.target.value)} /></label>
          <label className="campo"><span>Purga por cada color de más (%)</span><input id="a-merma" className="num" inputMode="decimal" value={merma} onChange={(e) => setMerma(e.target.value)} /></label>
          <label className="campo"><span>Gramos gratis por persona</span><input id="a-gratis" className="num" inputMode="numeric" value={gratisG} onChange={(e) => setGratisG(e.target.value)} placeholder="50" /></label>
          <label className="campo"><span>Teléfono para Bizum</span><input id="a-bizum" className="num" inputMode="tel" autoComplete="off" value={bizum} onChange={(e) => setBizum(e.target.value)} placeholder="600 000 000" maxLength={30} /></label>
        </div>
        <p className="pista num">Ejemplo: 100 g a {eur(num(precio))}/{gramos(num(peso) || 1000)} = {eur((100 * num(precio)) / Math.max(1, num(peso)))}</p>
        <button
          className="boton primario"
          disabled={ocupado}
          onClick={() => hacer(() => api.adminAjustes(clave!, { precio_defecto: num(precio) || 17.99, peso_defecto: Math.round(num(peso)) || 1000, luz_hora: num(luz), merma_pct: num(merma), bizum: bizum.trim(), gratis_g: Math.max(0, num(gratisG)) }), "Precios guardados")}
        >
          Guardar precios
        </button>
      </section>

      <Cuentas />

      {clave !== "" && (
        <section className="panel formulario">
          <h2>Clave del taller</h2>
          <label className="campo"><span>Clave nueva</span><ClaveInput id="a-nueva" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" minLength={4} /></label>
          <button
            className="boton"
            disabled={ocupado || nueva.trim().length < 4}
            onClick={() =>
              hacer(async () => {
                await api.adminCambiarClave(clave!, nueva.trim());
                salirTaller();
              }, "Clave cambiada; vuelve a entrar con la nueva")
            }
          >
            Cambiar clave
          </button>
        </section>
      )}
    </>
  );
}

/** quién se ha hecho cuenta y cuándo ha entrado (aunque no haya pedido nada) */
function Cuentas() {
  const { api, clave, datos } = useDatos();
  const [lista, setLista] = useState<Cuenta[] | null>(null);
  const [fallo, setFallo] = useState("");
  const [todas, setTodas] = useState(false);
  useEffect(() => {
    if (!api.adminCuentas || clave === null) return;
    api.adminCuentas(clave).then(setLista).catch((e) => setFallo(e instanceof Error ? e.message : "No se han podido leer"));
  }, [api, clave, datos.pedidos.length]);
  if (!api.adminCuentas) return null;
  const hoy = (lista || []).filter((c) => c.ultima && Date.now() - new Date(c.ultima).getTime() < 864e5).length;
  const visibles = todas ? lista || [] : (lista || []).slice(0, 8);
  return (
    <section className="panel cuentas">
      <div className="cuentas-cab">
        <h2>Cuentas</h2>
        {lista && <span className="etiqueta">{lista.length} en total · {hoy} hoy</span>}
      </div>
      {fallo && <p className="error-txt">{fallo}</p>}
      {!lista && !fallo && <div className="cuenta-fila esqueleto" />}
      <AnimatePresence initial={false}>
        {visibles.map((c, i) => (
          <motion.div key={c.id} className="cuenta-fila" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3), ease }}>
            <Avatar nombre={c.nombre} size={38} uid={c.id} />
            <div className="cuenta-txt">
              <strong>{c.nombre}</strong>
              <span>{c.email}</span>
            </div>
            <div className="cuenta-datos">
              <span className={c.ultima && Date.now() - new Date(c.ultima).getTime() < 864e5 ? "reciente" : ""}>{c.ultima ? hace(c.ultima) : c.confirmada ? "Sin entrar" : "Sin confirmar"}</span>
              <small>{c.veces} {c.veces === 1 ? "visita" : "visitas"} · {c.pedidos} {c.pedidos === 1 ? "pedido" : "pedidos"}</small>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {lista && lista.length > 8 && (
        <button className="boton" onClick={() => setTodas((v) => !v)}>{todas ? "Ver menos" : `Ver las ${lista.length}`}</button>
      )}
    </section>
  );
}
