import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { cpSync, existsSync, mkdirSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

/**
 * pdf.js needs its character maps, standard fonts, colour profiles and
 * image decoders (wasm) to render every PDF offline. Copy them from the
 * package into public/pdfjs/ (git-ignored) so they ship with the app and
 * always match the installed pdf.js version.
 */
function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    buildStart() {
      const from = "node_modules/pdfjs-dist";
      const to = "public/pdfjs";
      mkdirSync(to, { recursive: true });
      for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
        if (existsSync(`${from}/${dir}`)) cpSync(`${from}/${dir}`, `${to}/${dir}`, { recursive: true });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
