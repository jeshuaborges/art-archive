import type { PreviewState } from "../types";
import { IPhotos } from "./Icons";

const TEXT: Record<PreviewState | "none", string> = {
  ready: "",
  pending: "Preview being made",
  unavailable: "No preview for this file",
  none: "No image yet",
};

/**
 * Stands in for an image that has no preview yet. The app never shows the
 * original in its place (originals live in Infrequent Access and are only
 * downloaded), so a missing preview is a neutral tile. Fills its parent.
 */
export function PreviewTile({ state, compact }: { state: PreviewState | null; compact?: boolean }) {
  const text = TEXT[state || "none"];
  return (
    <div role="img" aria-label={text} data-testid="preview-tile" data-preview={state || "none"} className={state === "pending" ? "skel" : undefined}
      style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 6, background: state === "pending" ? undefined : "#23201C", color: "var(--faint)", fontSize: compact ? 10 : 12.5, fontWeight: 600, textAlign: "center", lineHeight: 1.25 }}>
      {state && state !== "ready" && <IPhotos size={compact ? 16 : 24} />}
      {!compact && <span>{text}</span>}
    </div>
  );
}
