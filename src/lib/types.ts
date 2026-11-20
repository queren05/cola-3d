export type Estado = "pendiente" | "imprimiendo" | "impreso" | "entregado" | "cancelado";

export const ESTADOS: { id: Estado; label: string }[] = [
  { id: "pendiente", label: "Pendiente" },
  { id: "imprimiendo", label: "Imprimiendo" },
  { id: "impreso", label: "Impreso" },
  { id: "entregado", label: "Entregado" },
  { id: "cancelado", label: "Cancelado" },
];
export const estadoLabel = (e: Estado) => ESTADOS.find((x) => x.id === e)?.label ?? e;

export interface Filamento {
  id: string;
  nombre: string;
  material: string;
  /** #rrggbb */
  color: string;
  /** precio del rollo; null = el precio por defecto */
  precio: number | null;
  /** gramos que trae el rollo */
  peso: number;
  /** gramos que quedan */
  stock_g: number;
  activo: boolean;
  orden: number;
}

export interface Ajustes {
  precio_defecto: number;
  peso_defecto: number;
  luz_hora: number;
  /** % de filamento extra que se pierde purgando cuando hay varios colores */
  merma_pct: number;
  /** teléfono para pagar por Bizum */
  bizum: string;
  /** gramos gratis para cada persona, que se gastan entre sus pedidos */
  gratis_g: number;
  /** por debajo de esto no se pide pagar: se acumula (Bizum no deja menos de 0,50 €) */
  pago_minimo?: number;
}

export interface Linea {
  filamento_id: string | null;
  nombre: string;
  color: string;
  /** gramos por copia */
  gramos: number;
}

export interface LineaCoste {
  nombre: string;
  color: string;
  gramos: number;
  precio: number;
  peso: number;
  coste: number;
}

export interface CosteDetalle {
  filamento: number;
  merma: number;
  merma_pct: number;
  luz: number;
  gramos: number;
  total: number;
  lineas: LineaCoste[];
  /** gramos que han salido gratis en este pedido */
  gratis_g?: number;
  descuento?: number;
}

/** perfil de impresión de MakerWorld (gramos, tiempo y colores ya laminados) */
export interface Perfil {
  id: string;
  titulo: string;
  impresora: string;
  modelo: string;
  a1mini: boolean;
  minutos: number;
  gramos: number;
  placas: number;
  colores: { color: string; material: string; gramos: number }[];
  porDefecto: boolean;
}

export interface Cambio {
  estado: Estado;
  fecha: string;
}

export interface Pedido {
  id: string;
  creado: string;
  actualizado: string;
  nombre: string;
  url: string;
  titulo: string;
  imagen: string;
  lineas: Linea[];
  minutos: number;
  copias: number;
  notas: string;
  estado: Estado;
  pagado: boolean;
  coste: number;
  coste_detalle: CosteDetalle;
  historial: Cambio[];
  descontado: boolean;
  /** más alto = antes en la cola (solo lo cambia el taller) */
  prioridad?: number;
  /** fotos de cómo ha quedado (las sube el taller) */
  fotos?: string[];
  /** más de 4 colores: llega como petición y el taller decide */
  peticion?: boolean;
  /** cuenta que hizo el pedido */
  user_id?: string | null;
}

export interface Cuenta {
  id: string;
  nombre: string;
  email: string;
  alta: string;
  ultima: string | null;
  veces: number;
  confirmada: boolean;
  pedidos: number;
}

export interface NuevaPieza {
  titulo: string;
  /** para quién es (vacío = el taller) */
  nombre: string;
  /** su cuenta, si tiene */
  user_id?: string | null;
  url: string;
  lineas: Linea[];
  minutos: number;
  copias: number;
  notas: string;
  estado: "impreso" | "entregado";
  fotos: string[];
}

export interface NuevoPedido {
  nombre: string;
  url: string;
  titulo: string;
  imagen: string;
  lineas: Linea[];
  minutos: number;
  copias: number;
  notas: string;
}

export type CambiosPedido = Partial<Pick<Pedido, "estado" | "pagado" | "lineas" | "minutos" | "copias" | "titulo" | "imagen" | "notas" | "prioridad" | "fotos" | "peticion">>;

export interface Datos {
  ajustes: Ajustes;
  filamentos: Filamento[];
  pedidos: Pedido[];
  /** me gusta de la vitrina: quién (cuenta) y qué pieza */
  votos?: { pedido_id: string; user_id: string }[];
  /** piezas que tú has guardado (en cualquier lista) */
  guardados?: string[];
  /** tus listas de guardados: qué pieza en qué lista */
  listas?: { pedido_id: string; lista: string }[];
  /** foto y nombre de cada cuenta */
  perfiles?: Record<string, { nombre: string; avatar: string }>;
}

export interface Sesion {
  id: string;
  nombre: string;
  email: string;
}

export interface Api {
  modo: "local" | "supabase";
  cuentas: boolean;
  cargar(): Promise<Datos>;
  /** avisa cuando cambia algo (aquí o en otro dispositivo) */
  escuchar(cb: () => void): () => void;
  crearPedido(p: NuevoPedido): Promise<{ id: string; token: string }>;
  cancelarPedido(id: string, token: string): Promise<void>;
  comprobarClave(clave: string): Promise<boolean>;
  adminPedido(clave: string, id: string, cambios: CambiosPedido): Promise<void>;
  adminBorrarPedido(clave: string, id: string): Promise<void>;
  /** me gusta / quitar el me gusta; devuelve cómo queda */
  votar?(id: string): Promise<boolean>;
  /** guardar / quitar de guardados; devuelve cómo queda */
  guardar?(id: string): Promise<boolean>;
  /** mete o saca una pieza de una lista; devuelve si ahora está */
  guardarEn?(id: string, lista: string): Promise<boolean>;
  renombrarLista?(lista: string, nueva: string): Promise<void>;
  borrarLista?(lista: string): Promise<void>;
  /** cambia tu nombre y tu foto */
  guardarPerfil?(nombre: string, avatar: string): Promise<void>;
  /** sube tu foto de perfil y devuelve su dirección */
  subirAvatar?(foto: Blob): Promise<string>;
  /** pide una pieza de la vitrina tal cual */
  pedirIgual?(id: string, nombre: string, copias: number, notas: string): Promise<{ id: string; token: string }>;
  /** cuentas creadas y cuándo han entrado (solo el taller) */
  adminCuentas?(clave: string): Promise<Cuenta[]>;
  /** apunta que has entrado (con la sesión iniciada) */
  marcarVisita?(): Promise<void>;
  /** el taller sube a la vitrina algo impreso por su cuenta (sin enlace ni cobro) */
  adminCrearPieza(clave: string, p: NuevaPieza): Promise<string>;
  adminFilamento(clave: string, f: Partial<Filamento>): Promise<void>;
  adminBorrarFilamento(clave: string, id: string): Promise<void>;
  adminAjustes(clave: string, a: Ajustes): Promise<void>;
  adminCambiarClave(clave: string, nueva: string): Promise<void>;
  vistaPrevia?(url: string): Promise<{ titulo?: string; imagen?: string; perfiles?: Perfil[] } | null>;
  // cuentas (solo con Supabase y VITE_CUENTAS=1)
  sesion?(): Promise<Sesion | null>;
  entrar?(email: string, clave: string): Promise<void>;
  registrar?(nombre: string, email: string, clave: string): Promise<void>;
  salir?(): Promise<void>;
  recuperar?(email: string): Promise<void>;
  nuevaClave?(clave: string): Promise<void>;
  /** avisa cuando se entra desde el correo de «he olvidado la contraseña» */
  alRecuperar?(cb: () => void): () => void;
  soyAdmin?(): Promise<boolean>;
  /** sube una foto (ya reducida) y devuelve su dirección pública */
  subirFoto?(pedidoId: string, foto: Blob): Promise<string>;
  borrarFoto?(url: string): Promise<void>;
}
