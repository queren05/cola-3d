/** si hay una versión nueva publicada, la web se recarga sola (al volver a la pestaña o cada 5 minutos) */
export function vigilarVersion() {
  const actual = [...document.scripts].map((s) => s.src).find((s) => /assets\/index-.*\.js/.test(s));
  if (!actual) return; // en desarrollo no hay versión
  const nombre = actual.split("/").pop();
  let ultima = 0;
  async function mirar() {
    if (Date.now() - ultima < 60_000) return;
    ultima = Date.now();
    try {
      const html = await (await fetch(location.pathname + "?v=" + Date.now(), { cache: "no-store" })).text();
      const nueva = html.match(/assets\/index-[^"']+\.js/)?.[0]?.split("/").pop();
      // no se recarga a mitad de escribir un pedido: espera a que la pestaña vuelva a estar delante
      if (nueva && nombre && nueva !== nombre && document.visibilityState === "visible" && !document.querySelector("input:focus, textarea:focus")) location.reload();
    } catch {
      /* sin conexión: ya mirará luego */
    }
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && mirar());
  setInterval(mirar, 5 * 60_000);
}
