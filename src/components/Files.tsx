import { useState } from "react";
import type { Artwork, ImageDTO, Tech } from "../types";
import { fmtBytes, fmtDate, GRADE_META, KIND_META } from "../util";
import { IDownload, IExpand, IShield } from "./Icons";
import { PreviewTile } from "./PreviewTile";

/**
 * "Originals & prints": every file kept for this piece, what it is, what it can
 * be reprinted at, whether its checksum still matches, and the original itself.
 */
export function Files({ art, onView }: { art: Artwork; onView: (imageId: string) => void }) {
  const files = art.images;
  const best = art.print;
  const total = files.reduce((s, f) => s + f.bytes, 0);
  return (
    <div style={{ padding: "30px 20px 0" }} data-testid="files">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span className="display" style={{ fontSize: 20, fontWeight: 700 }}>Originals &amp; prints</span>
        <span className="mono" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--muted)", whiteSpace: "nowrap" }}>{files.length} {files.length === 1 ? "FILE" : "FILES"} · {fmtBytes(total)}</span>
      </div>
      <Verdict art={art} />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {files.map((f) => <FileRow key={f.id} f={f} best={best?.imageId === f.id} onView={() => onView(f.id)} />)}
      </div>
    </div>
  );
}

/** The piece in one line: is there a file good enough to reprint it? */
function Verdict({ art }: { art: Artwork }) {
  const p = art.print;
  const g = p ? GRADE_META[p.grade] : null;
  return (
    <div data-testid="print-verdict" style={{ marginTop: 12, padding: "14px 16px", borderRadius: 18, background: "var(--surface)", border: `1px solid ${g ? g.color + "55" : "var(--line-2)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: g?.color ?? "var(--faint)", flex: "none" }} />
        <span style={{ fontWeight: 700, fontSize: 15.5 }}>{g ? g.label : "No image of the finished work"}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 13.5, lineHeight: 1.45, color: "var(--text-2)" }}>
        {p ? p.summary : "Add a photo or scan of the finished piece to keep a print master."}
      </div>
      {p && !p.sizeKnown && <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.4, color: "var(--muted)" }}>Add the painting's size (Edit → Size) to check full-size prints.</div>}
    </div>
  );
}

function FileRow({ f, best, onView }: { f: ImageDTO; best: boolean; onView: () => void }) {
  const [open, setOpen] = useState(false);
  const t = f.tech;
  const g = f.print ? GRADE_META[f.print.grade] : null;
  const name = f.originalName || f.original?.split("/").pop() || "original";
  const mp = f.width && f.height ? `${Math.round((f.width * f.height) / 1e5) / 10} MP` : null;
  const facts = [t?.format || f.contentType.replace("image/", "").toUpperCase(), f.width && f.height ? `${f.width} × ${f.height}` : null, mp, fmtBytes(f.bytes)].filter(Boolean);
  return (
    <div data-testid="file-row" style={{ borderRadius: 16, background: "var(--bg-3, rgba(255,255,255,.03))", border: "1px solid var(--line-2)", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 12, padding: 12 }}>
        <button className="press" aria-label={`View ${name} full screen`} onClick={onView}
          style={{ position: "relative", width: 64, height: 64, flex: "none", padding: 0, border: 0, borderRadius: 10, overflow: "hidden", background: "#23201C" }}>
          {f.thumb ? <img src={f.thumb} alt="" loading="lazy" decoding="async" className="art-img" draggable={false} /> : <PreviewTile state={f.preview} compact />}
          <span style={{ position: "absolute", right: 4, bottom: 4, width: 20, height: 20, borderRadius: 6, background: "rgba(18,17,15,.75)", display: "grid", placeItems: "center", color: "var(--text)" }}><IExpand size={12} /></span>
        </button>
        <button onClick={() => setOpen(!open)} aria-expanded={open} style={{ flex: 1, minWidth: 0, padding: 0, border: 0, background: "transparent", color: "var(--text)", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 9, background: KIND_META[f.kind].color, flex: "none" }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          </div>
          <div className="mono" style={{ marginTop: 4, fontSize: 11, color: "var(--muted)" }}>{facts.join(" · ")}</div>
          {!f.print && <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)" }}>{KIND_META[f.kind].label}{f.role ? ` · ${f.role}` : ""}</div>}
          {g && f.print && (
            <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.35 }}>
              <span style={{ color: g.color, fontWeight: 700 }}>{g.short}{best ? " · best" : ""}</span>
              <span style={{ color: "var(--text-2)" }}> · {f.print.summary}</span>
            </div>
          )}
          <Fixity f={f} />
        </button>
      </div>
      {open && <Details f={f} t={t} />}
      <a href={f.download} download data-testid="download-original" className="press"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderTop: "1px solid var(--line-2)", color: "var(--text)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
        <IDownload size={16} />Download original <span className="mono" style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{fmtBytes(f.bytes)}</span>
      </a>
    </div>
  );
}

function Fixity({ f }: { f: ImageDTO }) {
  const { state, checkedAt } = f.fixity;
  const text = state === "verified" ? `Checksum verified ${fmtDate(checkedAt!)}`
    : state === "failed" ? "Checksum mismatch: this copy may be damaged"
    : state === "due" ? `Checksum last verified ${fmtDate(checkedAt!)}, due again`
    : "Checksum check pending";
  const color = state === "verified" ? "#8FD3A0" : state === "failed" ? "#FF9C8F" : "var(--muted)";
  return <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color }}><IShield size={13} />{text}</div>;
}

function Details({ f, t }: { f: ImageDTO; t: Tech | null }) {
  const rows: [string, string | null][] = t ? [
    ["Colour", [t.colorMode, t.bitsPerChannel ? `${t.bitsPerChannel}-bit` : null, t.hasAlpha ? "with alpha" : null].filter(Boolean).join(", ") || null],
    ["Colour profile", t.iccProfile ?? "None embedded"],
    ["Compression", t.compression ? `${t.compression}${t.lossy ? " (lossy)" : t.lossy === false ? " (lossless)" : ""}${t.jpegQuality ? `, quality ≈${t.jpegQuality}` : ""}` : null],
    ["Tagged resolution", t.dpi ? `${t.dpi} dpi` : null],
    ["Layers", t.layers == null ? null : t.layers ? `${t.layers} (layered master)` : "Flattened"],
    ["Captured with", t.camera],
    ["Captured", t.capturedAt ? fmtDate(t.capturedAt) : null],
    ["Software", t.software],
  ] : [["File details", "Not read yet: they appear after the next archive check"]];
  rows.push(["Largest 300 ppi print", f.print ? `${f.print.maxAt300.w} × ${f.print.maxAt300.h} in` : null]);
  rows.push(["Uploaded", fmtDate(f.createdAt)]);
  rows.push(["SHA-256", f.sha256]);
  return (
    <div style={{ padding: "0 14px 12px" }}>
      {f.print && [...f.print.notes.map((n) => ["✓", n, "var(--text-2)"]), ...f.print.warnings.map((w) => ["!", w, "#FFD678"])].map(([m, s, c], i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.4, color: c, marginTop: 4 }}><span style={{ width: 12, flex: "none", textAlign: "center" }}>{m}</span>{s}</div>
      ))}
      <dl style={{ margin: "8px 0 0" }}>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 12, padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.06)", fontSize: 12.5 }}>
            <dt style={{ width: 128, flex: "none", color: "var(--muted)" }}>{k}</dt>
            <dd className={k === "SHA-256" ? "mono" : undefined} style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere", fontSize: k === "SHA-256" ? 11 : undefined }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
