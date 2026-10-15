import { useEffect, useState } from "react";
import { layoutFor, type Layout } from "./layout";

const read = () => layoutFor(window.innerWidth, window.innerHeight);

/**
 * The current layout, following window size and orientation live. iOS can
 * report the old size on `orientationchange`, so it reads again on the next
 * frames as well as on `resize`.
 */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(read);
  useEffect(() => {
    let raf = 0, t: ReturnType<typeof setTimeout> | undefined;
    const update = () => setLayout((prev) => {
      const next = read();
      return prev.w === next.w && prev.h === next.h ? prev : next;
    });
    const later = () => { update(); cancelAnimationFrame(raf); raf = requestAnimationFrame(update); clearTimeout(t); t = setTimeout(update, 250); };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", later);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", later);
      cancelAnimationFrame(raf); clearTimeout(t);
    };
  }, []);
  return layout;
}
