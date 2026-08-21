import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";

import { getRouter } from "./router";
import {
  initializeStorageDriver,
  logout,
  SQLITE_STORAGE_REQUIRED_MESSAGE,
} from "./services/appServices";
import "./styles.css";

async function clearSessionOnAppStart() {
  await initializeStorageDriver();
  await Promise.resolve(logout());
}

function getStartupErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : SQLITE_STORAGE_REQUIRED_MESSAGE;
}

function StorageStartupError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Stockage SQLite requis</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
      </section>
    </main>
  );
}

export function mountClientApp() {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Application root element '#root' was not found.");
  }

  const router = getRouter();
  const root = createRoot(rootElement);

  void clearSessionOnAppStart()
    .then(() => {
      startTransition(() => {
        root.render(
          <StrictMode>
            <RouterProvider router={router} />
          </StrictMode>,
        );
      });
    })
    .catch((error) => {
      console.error("Storage initialization failed.", error);
      root.render(
        <StrictMode>
          <StorageStartupError message={getStartupErrorMessage(error)} />
        </StrictMode>,
      );
    });
}
