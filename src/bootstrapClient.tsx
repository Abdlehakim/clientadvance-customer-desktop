import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";

import { getRouter } from "./router";
import "./styles.css";

export function mountClientApp() {
  const rootElement = document.getElementById("root");

  if (!rootElement) {
    throw new Error("Application root element '#root' was not found.");
  }

  const router = getRouter();

  startTransition(() => {
    createRoot(rootElement).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  });
}
