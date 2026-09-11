import { fileURLToPath, pathToFileURL } from "node:url";

export function appendNodeRequireOption(existingOptions, shimPath) {
  const quotedShim = JSON.stringify(shimPath);
  return [existingOptions, `--require=${quotedShim}`]
    .filter(Boolean)
    .join(" ");
}

// tsx starts a child process for watch mode. Make the Windows compatibility
// shim available to both the CLI and every child it starts.
export function configureWindowsTsxShim(env = process.env, platform = process.platform) {
  if (platform !== "win32") return false;
  const shim = fileURLToPath(new URL("./tsx-windows-shim.cjs", import.meta.url));
  process.geteuid = () => 0;
  env.NODE_OPTIONS = appendNodeRequireOption(env.NODE_OPTIONS, shim);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  configureWindowsTsxShim();
  await import("../node_modules/tsx/dist/cli.mjs");
}
