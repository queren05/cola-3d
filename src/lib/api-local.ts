import { esMakerWorld } from "./perfiles";
import { AJUSTES_DEFECTO, aplicarGratis, calcularCoste, gratisRestante } from "./coste";
import type { Ajustes, Api, CambiosPedido, Datos, Filamento, Linea, NuevoPedido, Pedido } from "./types";

/** Modo prueba: todo se guarda en este navegador. Misma lógica que las funciones de supabase/schema.sql. */
const KEY = "cola3d-datos";
interface Guardado extends Datos {
  clave: string;
  tokens: Record<string, string>;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function leer(): Guardado {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const d = JSON.parse(s) as Guardado;
      return { ...d, ajustes: { ...AJUSTES_DEFECTO, ...d.ajustes } };
    }
  } catch {}
  return { ajustes: AJUSTES_DEFECTO, filamentos: [], pedidos: [], clave: "1234", tokens: {} };
}

let canal: BroadcastChannel | null = null;
try {
  canal = new BroadcastChannel("cola3d");
} catch {}
const oyentes = new Set<() => void>();
canal?.addEventListener("message", () => oyentes.forEach((f) => f()));

function guardar(d: Guardado) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
  oyentes.forEach((f) => f());
  canal?.postMessage("cambio");
}

function limpiarLineas(ls: Linea[]): Linea[] {
  return (ls || []).slice(0, 16).map((l) => ({
    filamento_id: l.filamento_id || null,
    nombre: String(l.nombre || "").slice(0, 40),
    color: String(l.color || "").slice(0, 9),
    gramos: Math.min(5000, Math.max(0, Number(l.gramos) || 0)),
  }));
}

function stock(d: Guardado, p: Pick<Pedido, "lineas" | "copias" | "coste_detalle">, signo: number) {
  const factor = signo * (1 + (p.coste_detalle?.merma_pct || 0) / 100);
  for (const l of p.lineas) {
    const f = d.filamentos.find((x) => x.id === l.filamento_id);
    if (f) f.stock_g = Math.max(0, Math.round((f.stock_g + factor * l.gramos * Math.max(1, p.copias)) * 10) / 10);
  }
}

const espera = () => new Promise((r) => setTimeout(r, 120));

export function apiLocal(): Api {
  const admin = async (clave: string) => {
    await espera();
    const d = leer();
    if (clave !== d.clave) throw new Error("Clave incorrecta");
    return d;
  };
  return {
    modo: "local",
    cuentas: false,
    async cargar() {
      const d = leer();
      return { ajustes: d.ajustes, filamentos: d.filamentos, pedidos: d.pedidos };
    },
    escuchar(cb) {
      oyentes.add(cb);
      const onStorage = (e: StorageEvent) => e.key === KEY && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        oyentes.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    async crearPedido(p: NuevoPedido) {
      await espera();
      const d = leer();
      const nombre = p.nombre.trim().slice(0, 40);
      if (!nombre) throw new Error("Falta tu nombre");
      if (!esMakerWorld(p.url)) throw new Error("Solo modelos de MakerWorld con perfil de impresión");
      const lineas = limpiarLineas(p.lineas);
      const copias = Math.min(50, Math.max(1, Math.round(p.copias || 1)));
      const minutos = Math.min(10000, Math.max(0, Math.round(p.minutos || 0)));
      const bruto = calcularCoste(lineas, minutos, copias, d.filamentos, d.ajustes);
      if (bruto.gramos <= 0) throw new Error("Faltan los gramos");
      const det = aplicarGratis(bruto, gratisRestante(d.pedidos, { ...AJUSTES_DEFECTO, ...d.ajustes }, null, nombre));
      const ahora = new Date().toISOString();
      const id = uid(), token = uid();
      d.pedidos.push({
        id, creado: ahora, actualizado: ahora, nombre, url: p.url, titulo: p.titulo.slice(0, 120), imagen: p.imagen.slice(0, 600),
        lineas, minutos, copias, notas: p.notas.slice(0, 600), estado: "pendiente", pagado: false, coste: det.total, coste_detalle: det,
        historial: [{ estado: "pendiente", fecha: ahora }], descontado: false,
      });
      d.tokens[id] = token;
      guardar(d);
      return { id, token };
    },
    async cancelarPedido(id, token) {
      await espera();
      const d = leer();
      const p = d.pedidos.find((x) => x.id === id);
      if (!p || p.estado !== "pendiente" || d.tokens[id] !== token) throw new Error("Ya no se puede cancelar");
      p.estado = "cancelado";
      p.actualizado = new Date().toISOString();
      p.historial = [...p.historial, { estado: "cancelado", fecha: p.actualizado }];
      guardar(d);
    },
    async comprobarClave(clave) {
      await espera();
      return clave === leer().clave;
    },
    async subirFoto(_id, foto) {
      return await new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => mal(new Error("No se ha podido leer la foto")); r.readAsDataURL(foto); });
    },
    async borrarFoto() {},
    async adminPedido(clave, id, c: CambiosPedido) {
      const d = await admin(clave);
      const p = d.pedidos.find((x) => x.id === id);
      if (!p) throw new Error("Ese pedido ya no existe");
      const cambiaCantidad = c.lineas !== undefined || c.copias !== undefined || c.minutos !== undefined;
      if (cambiaCantidad && p.descontado) stock(d, p, 1);
      if (c.lineas) p.lineas = limpiarLineas(c.lineas);
      if (c.copias !== undefined) p.copias = Math.min(50, Math.max(1, Math.round(c.copias)));
      if (c.minutos !== undefined) p.minutos = Math.max(0, Math.round(c.minutos));
      if (c.titulo !== undefined) p.titulo = c.titulo.slice(0, 120);
      if (c.imagen !== undefined) p.imagen = c.imagen.slice(0, 600);
      if (c.notas !== undefined) p.notas = c.notas.slice(0, 600);
      if (c.pagado !== undefined) p.pagado = c.pagado;
      if (c.fotos !== undefined) p.fotos = c.fotos.slice(0, 12);
      if (c.prioridad !== undefined) p.prioridad = Math.max(0, Math.round(c.prioridad));
      if (cambiaCantidad) {
        p.coste_detalle = aplicarGratis(calcularCoste(p.lineas, p.minutos, p.copias, d.filamentos, d.ajustes), gratisRestante(d.pedidos, { ...AJUSTES_DEFECTO, ...d.ajustes }, p.user_id, p.nombre, p.id));
        p.coste = p.coste_detalle.total;
        if (p.descontado) stock(d, p, -1);
      }
      p.actualizado = new Date().toISOString();
      if (c.estado && c.estado !== p.estado) {
        const hecho = c.estado === "impreso" || c.estado === "entregado";
        if (hecho && !p.descontado) { stock(d, p, -1); p.descontado = true; }
        if (!hecho && p.descontado) { stock(d, p, 1); p.descontado = false; }
        p.estado = c.estado;
        p.historial = [...p.historial, { estado: c.estado, fecha: p.actualizado }];
      }
      guardar(d);
    },
    async adminBorrarPedido(clave, id) {
      const d = await admin(clave);
      d.pedidos = d.pedidos.filter((x) => x.id !== id);
      delete d.tokens[id];
      guardar(d);
    },
    async adminFilamento(clave, f: Partial<Filamento>) {
      const d = await admin(clave);
      const base: Filamento = { id: uid(), nombre: "", material: "PLA", color: "#cccccc", precio: null, peso: d.ajustes.peso_defecto, stock_g: d.ajustes.peso_defecto, activo: true, orden: d.filamentos.length };
      const i = f.id ? d.filamentos.findIndex((x) => x.id === f.id) : -1;
      if (i >= 0) d.filamentos[i] = { ...d.filamentos[i], ...f } as Filamento;
      else d.filamentos.push({ ...base, ...f, id: base.id });
      guardar(d);
    },
    async adminBorrarFilamento(clave, id) {
      const d = await admin(clave);
      d.filamentos = d.filamentos.filter((x) => x.id !== id);
      guardar(d);
    },
    async adminAjustes(clave, a: Ajustes) {
      const d = await admin(clave);
      d.ajustes = a;
      guardar(d);
    },
    async adminCambiarClave(clave, nueva) {
      const d = await admin(clave);
      if (nueva.trim().length < 4) throw new Error("La clave necesita al menos 4 caracteres");
      d.clave = nueva.trim();
      guardar(d);
    },
  };
}
