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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }

          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) {
            return "vendor-router";
          }

          if (
            /[\\/]node_modules[\\/](@radix-ui|@floating-ui|cmdk|embla-carousel-react|input-otp|react-remove-scroll|react-remove-scroll-bar|react-resizable-panels|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|vaul)[\\/]/.test(
              id,
            )
          ) {
            return "vendor-ui";
          }

          if (
            /[\\/]node_modules[\\/](class-variance-authority|clsx|date-fns|lucide-react|sonner|tailwind-merge|zod)[\\/]/.test(
              id,
            ) ||
            /[\\/]node_modules[\\/]@hookform[\\/]/.test(id)
          ) {
            return "vendor-utils";
          }

          return "vendor";
        },
      },
    },
  },
  resolve: {
    dedupe: ["@tanstack/react-router", "react", "react-dom"],
  },
});
