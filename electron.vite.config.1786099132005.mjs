// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
var __electron_vite_injected_dirname = "D:\\ef-tools-dev\\mgmt\\silver-vision";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: { index: resolve(__electron_vite_injected_dirname, "src/main/index.js") }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
          extension: resolve(__electron_vite_injected_dirname, "src/preload/extension.js"),
          keeper: resolve(__electron_vite_injected_dirname, "src/preload/keeper.js")
        }
      }
    }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    server: {
      fs: { allow: [resolve(__electron_vite_injected_dirname)] }
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__electron_vite_injected_dirname, "dist/renderer"),
      rollupOptions: {
        input: {
          menu: resolve(__electron_vite_injected_dirname, "src/renderer/menu/index.html"),
          appstore: resolve(__electron_vite_injected_dirname, "src/renderer/appstore/index.html"),
          settings: resolve(__electron_vite_injected_dirname, "src/renderer/settings/index.html"),
          window: resolve(__electron_vite_injected_dirname, "src/renderer/window/index.html"),
          settingsPanel: resolve(__electron_vite_injected_dirname, "src/renderer/settingsPanel/index.html")
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
