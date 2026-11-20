import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { useInclinar } from "../lib/inclinar";

/** ficha que se inclina siguiendo el ratón, con brillo */
export function Ficha({ children, style, ...rest }: Omit<HTMLMotionProps<"div">, "children"> & { children?: ReactNode }) {
  const inc = useInclinar();
  return (
    <motion.div {...rest} onPointerMove={inc.onPointerMove} onPointerLeave={inc.onPointerLeave} style={{ ...(style as object), ...inc.estilo }}>
      <motion.span className="brillo" style={{ background: inc.brillo }} aria-hidden="true" />
      {children}
    </motion.div>
  );
}
