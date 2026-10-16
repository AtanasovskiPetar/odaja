import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useOdaja } from "./store";
import { App } from "./ui/App";
import "./ui/styles.css";

// Expose the store in development, for debugging from the browser console.
if (import.meta.env.DEV) Object.assign(window, { odaja: useOdaja });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
