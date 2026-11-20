import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { vigilarVersion } from "./lib/version";
import App from "./App";
import { Proveedor } from "./lib/store";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Proveedor>
      <App />
    </Proveedor>
  </StrictMode>,
);
vigilarVersion();
