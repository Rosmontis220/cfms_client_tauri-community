import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), sveltekit()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1909,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1910,
        }
      : undefined,
    watch: {
      // 3. Rust build output must never be watched. This is a cargo workspace,
      // so the compiler writes to `target/` at the repository root, not under
      // `src-tauri/`. Watching it makes Vite race the compiler for object files
      // and crash with EBUSY partway through a `tauri dev` build.
      ignored: ["**/src-tauri/**", "**/target/**", "**/dist-plugins/**"],
    },
  },
  build: {
    // Production source maps expose implementation details and are not shipped.
    sourcemap: false
  },
}));
