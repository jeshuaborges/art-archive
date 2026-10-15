import { useEffect, useRef } from "react";

/**
 * Shown when the Cloudflare Access session has expired. Signing in needs a
 * top-level navigation (Access redirects the page to its login and back), so
 * the button reloads the page.
 */
export function SignedOut() {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus({ preventScroll: true }); }, []);
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: "calc(24px + var(--sat)) calc(var(--gr) + 8px) calc(24px + var(--sab)) calc(var(--gl) + 8px)", background: "rgba(6,5,4,.72)" }} data-testid="signed-out">
      <div role="alertdialog" aria-modal="true" aria-labelledby="signed-out-title" aria-describedby="signed-out-text" className="inup"
        style={{ width: "min(360px, 100%)", padding: "26px 22px 20px", borderRadius: 24, background: "var(--surface)", border: "1px solid var(--line-2)", boxShadow: "0 24px 60px rgba(0,0,0,.55)", textAlign: "center" }}>
        <div id="signed-out-title" className="display" style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>You've been signed out</div>
        <p id="signed-out-text" style={{ margin: "10px 0 20px", fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>Sign in again to keep working. Everything you saved is safe.</p>
        <button ref={btn} className="btn btn-primary press" style={{ width: "100%" }} onClick={() => location.reload()} data-testid="sign-in">Sign in</button>
      </div>
    </div>
  );
}
