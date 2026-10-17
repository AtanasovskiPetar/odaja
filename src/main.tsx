import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { platform } from "./platform";
import { useOdaja } from "./store";
import { captureView } from "./three/capture";
import { App } from "./ui/App";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./ui/styles.css";
import "./ui/themePref";

// Expose the store in development, for debugging from the browser console.
if (import.meta.env.DEV) Object.assign(window, { odaja: useOdaja });

// AI tools ask the open app for screenshots.
platform.onScreenshotRequest(captureView);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
