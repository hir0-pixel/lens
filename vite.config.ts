import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  if (mode === "production" && (environment.VITE_LENS_LAB_GATEWAY_URL || environment.VITE_LENS_LAB_GATEWAY_TOKEN || environment.VITE_LENS_SESSION_GATEWAY_URL)) {
    throw new Error("VITE_LENS_LAB_* and VITE_LENS_SESSION_GATEWAY_URL settings are test-only and cannot be included in a production build.");
  }

  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@xterm") || id.includes("xterm")) return "vendor-xterm";
          if (id.includes("monaco") || id.includes("@monaco-editor"))
            return "vendor-monaco";
          if (id.includes("react-markdown") || id.includes("remark"))
            return "vendor-markdown";
          if (id.includes("react-dom") || id.includes("/react/"))
            return "vendor-react";
          if (id.includes("@radix-ui") || id.includes("cmdk"))
            return "vendor-radix";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("zustand") || id.includes("sonner"))
            return "vendor-state";
        },
      },
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Bind IPv4 loopback explicitly. On Windows, Vite's default `localhost`
    // often listens on ::1 only, while Tauri's Rust readiness check resolves
    // localhost to 127.0.0.1 and waits forever.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/auth": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  };
});
