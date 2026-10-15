import { useEffect, useState } from "react";
import { api } from "../api";
import type { AssetReport, PrintGrade } from "../types";
import { fmtBytes, fmtDate, GRADE_META } from "../util";
import { IShield } from "./Icons";
import { PreviewTile } from "./PreviewTile";
import { Sheet } from "./Sheet";

const GRADES: PrintGrade[] = ["master", "print", "small", "reference"];
const PAGE = 40;

/**
 * The archive as a set of print masters: how many pieces could be reprinted
 * from what's kept, whether the originals are intact, and what most needs a
 * better scan.
 */
export function ReadinessSheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const [r, setR] = useState<AssetReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    if (!open) return;
    setErr(null); setShown(PAGE);
    api.assetReport().then(setR).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the report"));
  }, [open]);

  const printable = r ? r.grades.master + r.grades.print : 0;
  return (
    <Sheet open={open} onClose={onClose} label="Print readiness" testId="readiness-sheet" maxHeight="92%"
      header={<h2 className="display" style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Print readiness</h2>}>
      <div style={{ padding: "4px 20px calc(28px + var(--sab))" }}>
        {err && <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>{err}</div>}
        {!r && !err && <div className="skel" style={{ height: 180, borderRadius: 18 }} />}
        {r && (
          <>
            <p style={{ margin: "2px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--text-2)" }} data-testid="readiness-lede">
              <b style={{ color: "var(--text)" }}>{printable} of {r.pieces}</b> pieces have a file good enough to reprint at full size or large.
              {r.grades.master > 0 && <> {r.grades.master} of those are archival masters (300 ppi at the painting's own size).</>}
            </p>

            {/* grades */}
            <div style={{ marginTop: 16, display: "flex", height: 10, borderRadius: 9, overflow: "hidden", background: "#34312C" }} aria-hidden>
              {GRADES.map((g) => <div key={g} style={{ width: `${(r.grades[g] / Math.max(1, r.pieces)) * 100}%`, background: GRADE_META[g].color }} />)}
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {GRADES.map((g) => (
                <div key={g} style={{ padding: "10px 12px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-2)" }}><span style={{ width: 8, height: 8, borderRadius: 9, background: GRADE_META[g].color }} />{GRADE_META[g].label}</div>
                  <div className="display" style={{ marginTop: 2, fontSize: 24, fontWeight: 700 }}>{r.grades[g]}</div>
                </div>
              ))}
            </div>
            {r.grades.none > 0 && <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>{r.grades.none} pieces have no image of the finished work.</p>}
            {r.missingSize > 0 && <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--muted)" }}>{r.missingSize} pieces have no size recorded, so they're judged by pixels alone. Adding a size shows whether a file prints at full size.</p>}

            {/* safekeeping */}
            <div style={{ marginTop: 22 }} className="lbl">How the originals are kept</div>
            <div data-testid="readiness-fixity" style={{ marginTop: 10, padding: "14px 16px", borderRadius: 18, background: "var(--surface)", border: `1px solid ${r.fixity.failed ? "#FF9C8F88" : "var(--line-2)"}`, fontSize: 13.5, lineHeight: 1.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: r.fixity.failed ? "#FF9C8F" : "#8FD3A0" }}>
                <IShield />{r.fixity.failed ? `${r.fixity.failed} file${r.fixity.failed === 1 ? "" : "s"} failed a checksum check` : `${r.fixity.verified} of ${r.files} originals verified`}
              </div>
              <div style={{ marginTop: 6, color: "var(--text-2)" }}>
                {r.files} original files, {fmtBytes(r.bytes)}, kept byte-for-byte in Cloudflare R2, which stores each object redundantly. Each file's SHA-256 was recorded when it arrived; every original is read back and checked again about every 90 days.
              </div>
              <div className="mono" style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                {r.formats.map((f) => `${f.count} ${f.type.replace("image/", "").toUpperCase()}`).join(" · ")}
                {r.fixity.unchecked > 0 && ` · ${r.fixity.unchecked} awaiting first check`}
                {r.fixity.due > 0 && ` · ${r.fixity.due} due`}
                {r.fixity.oldestCheck && ` · oldest check ${fmtDate(r.fixity.oldestCheck)}`}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>A full export of every record is also written nightly.</div>
            </div>

            {/* what needs work */}
            {r.needsAttention.length > 0 && (
              <>
                <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="lbl">Worth rescanning</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{r.needsAttention.length}</span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--muted)" }}>Weakest first. A new photo or scan of the finished piece raises its grade.</p>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }} data-testid="readiness-list">
                  {r.needsAttention.slice(0, shown).map((p) => (
                    <button key={p.id} className="press" onClick={() => { onClose(); onOpen(p.id); }}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", border: 0, borderRadius: 12, background: "transparent", color: "var(--text)", textAlign: "left" }}>
                      <div style={{ position: "relative", width: 48, height: 48, flex: "none", borderRadius: 8, overflow: "hidden", background: "#23201C" }}>
                        {p.thumb ? <img src={p.thumb} alt="" loading="lazy" decoding="async" className="art-img" /> : <PreviewTile state="unavailable" compact />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title || "Untitled"}</div>
                        <div style={{ marginTop: 2, fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ color: p.grade ? GRADE_META[p.grade].color : "var(--faint)", fontWeight: 600 }}>{p.grade ? GRADE_META[p.grade].short : "No finished image"}</span> · {p.summary}
                        </div>
                      </div>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", flex: "none" }}>{p.catalogId}</span>
                    </button>
                  ))}
                </div>
                {shown < r.needsAttention.length && (
                  <button className="btn btn-ghost press" style={{ width: "100%", marginTop: 10, height: 44 }} onClick={() => setShown(shown + PAGE)}>Show more</button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
