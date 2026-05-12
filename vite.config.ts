import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  base: "./",
  envPrefix: ["VITE_", "DEFAULT_"],
  plugins: [
    tanstackRouter({
      target: "react",
    }),
    react(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    manifest: true,
  },
  resolve: {
    dedupe: ["@tanstack/react-router", "react", "react-dom"],
  },
});
