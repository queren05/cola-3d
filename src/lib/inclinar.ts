import { useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import type React from "react";

/** la ficha se inclina siguiendo el ratón, con un brillo que va detrás del puntero (solo con ratón, no en el móvil) */
export function useInclinar(max = 6) {
  const reducir = useReducedMotion();
  const muelle = { stiffness: 260, damping: 24, mass: 0.6 };
  const rotateX = useSpring(0, muelle);
  const rotateY = useSpring(0, muelle);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const brillo = useMotionTemplate`radial-gradient(420px circle at ${gx}% ${gy}%, rgba(255,255,255,0.16), transparent 45%)`;
  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (reducir || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    rotateY.set((px - 0.5) * 2 * max);
    rotateX.set(-(py - 0.5) * 2 * max);
    gx.set(px * 100);
    gy.set(py * 100);
  }
  function onPointerLeave() {
    rotateX.set(0);
    rotateY.set(0);
  }
  return { estilo: { rotateX, rotateY, transformPerspective: 900 }, onPointerMove, onPointerLeave, brillo };
}
