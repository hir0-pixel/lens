import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";
import { logger } from "./shared/diagnostics/logger";
import { perf } from "./shared/diagnostics/perf";
import { initNetworkMonitor } from "./shared/diagnostics/network";

perf.mark("app-boot");
initNetworkMonitor();

window.addEventListener("error", (event) => {
  logger.captureException(event.error ?? event.message, {
    source: "window.error",
  });
});

window.addEventListener("unhandledrejection", (event) => {
  logger.captureException(event.reason, { source: "unhandledrejection" });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Workbench failed to load">
      <TooltipProvider delayDuration={400}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

requestAnimationFrame(() => {
  perf.measure("app-boot");
  perf.reportStartup();
  logger.info("app.ready", { version: "0.1.0" });
});
