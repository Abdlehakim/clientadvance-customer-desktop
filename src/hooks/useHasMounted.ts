import { useEffect, useState } from "react";

let hasHydratedOnce = false;

export function useHasMounted() {
  const [mounted, setMounted] = useState(hasHydratedOnce);

  useEffect(() => {
    if (!hasHydratedOnce) {
      hasHydratedOnce = true;
    }
    setMounted(true);
  }, []);

  return mounted;
}
