import { useEffect, useState } from "react";
import { keyboardInset, layoutFor, revealDelta, type Layout } from "./layout";

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

/** Text fields that bring up the on-screen keyboard. */
const FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]), textarea, select";

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Follows the on-screen keyboard. iOS lays the keyboard over the page, so this
 * reads the visual viewport and publishes the covered height as the CSS
 * variable `--kb` on <html>; scroll areas with fields pad their bottom by it.
 * When a field gets focus (or the keyboard appears under it), its scroll area
 * is scrolled so the field sits above the keyboard.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let kb = 0, raf = 0, t: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el?.matches?.(FIELD)) return;
      const box = scrollParent(el);
      if (!box) return;
      const c = box.getBoundingClientRect();
      const d = revealDelta(el.getBoundingClientRect(), { top: Math.max(c.top, vv.offsetTop), bottom: Math.min(c.bottom, vv.offsetTop + vv.height) });
      if (d) box.scrollBy({ top: d, behavior: "smooth" });
    };
    const update = () => {
      const next = keyboardInset(window.innerHeight, vv);
      if (next === kb) return;
      const closed = kb > 0 && next === 0;
      kb = next;
      root.style.setProperty("--kb", `${next}px`);
      // reveal once the padding for the keyboard has been laid out
      if (next > 0) { cancelAnimationFrame(raf); raf = requestAnimationFrame(reveal); }
      // iOS can leave the layout viewport scrolled after the keyboard goes away
      else if (closed && (window.scrollY || vv.offsetTop)) window.scrollTo(0, 0);
    };
    // moving between fields keeps the keyboard up, so no resize follows: reveal on focus too
    const onFocus = (e: FocusEvent) => {
      if (!(e.target as HTMLElement | null)?.matches?.(FIELD)) return;
      clearTimeout(t); t = setTimeout(reveal, 320);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocus);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocus);
      cancelAnimationFrame(raf); clearTimeout(t);
      root.style.removeProperty("--kb");
    };
  }, []);
}
