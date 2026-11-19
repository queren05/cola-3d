import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// en GitHub Pages la web cuelga de /<repo>/
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/",
});
