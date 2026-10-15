import { useRef } from "react";
import type { ImageKind } from "../types";
import { KIND_META } from "../util";
import { ICamera, IFile, IPhotos } from "./Icons";
import { Sheet } from "./Sheet";

export const ROLES: { label: string; kind: ImageKind; role: string }[] = [
  { label: "Study", kind: "study", role: "Study" },
  { label: "Progress", kind: "progress", role: "Progress" },
  { label: "Reference", kind: "reference", role: "Reference photo" },
  { label: "Finished", kind: "work", role: "Front" },
  { label: "Detail", kind: "work", role: "Detail" },
  { label: "Back", kind: "work", role: "Back" },
  { label: "Signature", kind: "work", role: "Signature" },
];

interface Props {
  open: boolean;
  mode: "photo" | "new";
  roleIdx: number;
  onRole: (i: number) => void;
  onClose: () => void;
  onFiles: (files: File[]) => void;
}

export function UploadSheet({ open, mode, roleIdx, onRole, onClose, onFiles }: Props) {
  const cam = useRef<HTMLInputElement>(null), lib = useRef<HTMLInputElement>(null), file = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (files.length) onFiles(files);
  };
  const sources = [
    { label: "Camera", ref: cam, icon: <ICamera />, tint: "#2A2547", fg: "#C9BEFF" },
    { label: "Photos", ref: lib, icon: <IPhotos />, tint: "#3A2216", fg: "#FFB28A" },
    { label: "Files", ref: file, icon: <IFile />, tint: "#1F3326", fg: "#A9DDB5" },
  ];
  return (
    <Sheet open={open} onClose={onClose} label={mode === "photo" ? "Add images" : "Add a new work"} testId="upload-sheet" maxHeight="80%"
      header={
        <>
          <h2 className="display" style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{mode === "photo" ? "Add images" : "Add a new work"}</h2>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)" }}>{mode === "photo" ? "Attach more views of this piece, or the studies and photos that led to it." : "Start with a photo of the finished piece — details come next."}</p>
        </>
      }>
      <div style={{ padding: "8px 20px calc(24px + env(safe-area-inset-bottom))" }}>
        {mode === "photo" && (
          <>
            <div className="lbl" style={{ marginTop: 8 }}>What is it?</div>
            <div role="radiogroup" aria-label="Image type" style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
              {ROLES.map((r, i) => (
                <button key={r.label} role="radio" aria-checked={i === roleIdx} className="chip press" style={{ height: 36 }} onClick={() => onRole(i)}>
                  <span className="dot" style={{ background: KIND_META[r.kind].color }} />{r.label}
                </button>
              ))}
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "#8A847A" }}>Pick several at once — each original is kept at full size.</p>
          </>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 18 }}>
          {sources.map((s) => (
            <button key={s.label} className="press" onClick={() => s.ref.current?.click()} data-testid={`source-${s.label.toLowerCase()}`}
              style={{ height: 104, borderRadius: 18, border: "1px solid rgba(255,255,255,.1)", background: "#221F1C", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--text)", fontSize: 13, fontWeight: 600 }}>
              <span style={{ width: 44, height: 44, borderRadius: 99, background: s.tint, color: s.fg, display: "grid", placeItems: "center" }}>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} data-testid="input-camera" />
        <input ref={lib} type="file" accept="image/*" multiple hidden onChange={pick} data-testid="input-photos" />
        <input ref={file} type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple hidden onChange={pick} data-testid="input-files" />
        <button className="press" onClick={onClose} style={{ width: "100%", height: 50, marginTop: 14, borderRadius: 16, border: 0, background: "transparent", color: "var(--muted)", fontSize: 15, fontWeight: 600 }}>Cancel</button>
      </div>
    </Sheet>
  );
}
