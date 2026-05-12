import { StartClient } from "@tanstack/react-start-client";
import { Await, RouterProvider } from "@tanstack/react-router";
import { StrictMode, startTransition } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { getRouter } from "./router";

function isTauriDesktop() {
  return typeof window !== "undefined" && window.location.hostname === "tauri.localhost";
}

let tauriRouterPromise: ReturnType<typeof loadTauriRouter> | undefined;

async function loadTauriRouter() {
  const router = await Promise.resolve(getRouter());

  await router.load();

  return router;
}

function TauriStartClient() {
  if (!tauriRouterPromise) {
    tauriRouterPromise = loadTauriRouter();
  }

  return (
    <Await
      promise={tauriRouterPromise}
      children={(router) => <RouterProvider router={router} />}
    />
  );
}

function AppClient() {
  return isTauriDesktop() ? <TauriStartClient /> : <StartClient />;
}

const app = (
  <StrictMode>
    <AppClient />
  </StrictMode>
);

startTransition(() => {
  if (isTauriDesktop()) {
    const rootElement = document.getElementById("root");

    if (!rootElement) {
      throw new Error("Tauri desktop root element '#root' was not found.");
    }

    createRoot(rootElement).render(app);
    return;
  }

  hydrateRoot(document, app);
});
