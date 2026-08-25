import { fileURLToPath } from "node:url";

// tsx starts a child process for watch mode. Make the Windows compatibility
// shim available to both the CLI and every child it starts.
if (process.platform === "win32") {
  const shim = fileURLToPath(new URL("./tsx-windows-shim.cjs", import.meta.url));
  process.geteuid = () => 0;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require=${shim}`]
    .filter(Boolean)
    .join(" ");
}

await import("../node_modules/tsx/dist/cli.mjs");
