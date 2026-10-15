import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type { Artwork, FieldDef, ImageDTO, ImageKind, Summary } from "../types";
import { clamp, KIND_META, pct, STATUS_COLOR, vibrate, yearLabel } from "../util";
import { IBack, IDownload, IMore, IPlus, ISpark, IStar, ITag, ITrash, ICheck } from "./Icons";
import { ROLES } from "./UploadSheet";

export interface PendingUpload { tempId: string; artworkId: string; previewUrl: string; kind: ImageKind; role: string; progress: number; error?: string }

interface Props {
  id: string | null;
  reloadKey: number;
  startEditing: boolean;
  fields: FieldDef[];
  statuses: { value: string; label: string }[];
  summaries: Summary[];
  pending: PendingUpload[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onChanged: () => void;
  onAddImages: (artworkId: string, roleIdx: number) => void;
  toast: (msg: string) => void;
}

type Draft = { title: string; yearStart: string; yearEnd: string; circa: boolean; status: string; attrs: Record<string, unknown> };
const KIND_TABS: ("all" | ImageKind)[] = ["all", "work", "progress", "study", "reference"];

function toDraft(a: Artwork): Draft {
  return { title: a.title, yearStart: a.yearStart?.toString() ?? "", yearEnd: a.yearEnd?.toString() ?? "", circa: a.circa, status: a.status, attrs: JSON.parse(JSON.stringify(a.attrs)) };
}
const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

export function PieceView(p: Props) {
  const { id } = p;
  const [art, setArt] = useState<Artwork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | ImageKind>("all");
  const [idx, setIdx] = useState(0);
  const [cdx, setCdx] = useState(0);
  const [cDrag, setCDrag] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<{ id: string; match: number }[]>([]);
  const [menu, setMenu] = useState<null | "main" | "kind" | "label" | "delete">(null);
  const [labelText, setLabelText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const cg = useRef({ x: 0, y: 0, sc: 1, lock: null as null | "x" | "y", lt: 0, lx: 0, v: 0 });
  const lastId = useRef<string | null>(null);

  const load = useCallback(async (aid: string, keepView = false) => {
    try {
      const a = await api.get(aid);
      setArt(a); setError(null);
      if (!keepView) { setKind("all"); setIdx(Math.max(0, a.images.findIndex((i) => i.id === a.coverImageId))); }
      return a;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this piece.");
      return null;
    }
  }, []);

  // open / switch piece
  useEffect(() => {
    if (!id) return;
    const switching = lastId.current !== id;
    lastId.current = id;
    if (switching) {
      setArt(null); setEditing(false); setDraft(null); setIssues({}); setMenu(null); setConfirmDelete(false); setSimilar([]);
      scroller.current?.scrollTo({ top: 0 });
    }
    load(id, !switching).then((a) => {
      if (a && switching && p.startEditing) { setEditing(true); setDraft(toDraft(a)); }
    });
    api.similar(id).then(setSimilar).catch(() => setSimilar([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, p.reloadKey]);

  // Escape closes (when not editing)
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing && !menu && !document.querySelector(".sheet[aria-hidden='false']")) p.onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, editing, menu, p]);

  const pending = p.pending.filter((u) => u.artworkId === art?.id);
  const images = useMemo(() => (art ? art.images.filter((i) => kind === "all" || i.kind === kind) : []), [art, kind]);
  const pend = pending.filter((u) => kind === "all" || u.kind === kind);
  const slideCount = images.length + pend.length + 1; // + "add" slide
  const safeIdx = clamp(idx, 0, slideCount - 1);
  const curImage: ImageDTO | undefined = images[safeIdx];

  // jump to newest pending upload when it appears
  const pendCount = pending.length;
  const prevPend = useRef(0);
  useEffect(() => {
    if (pendCount > prevPend.current) {
      // bring the upload into view, wherever it was started from
      setKind("all"); setIdx((art?.images.length || 0) + pendCount - 1);
      scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else if (pendCount < prevPend.current) {
      // an upload finished or failed: don't leave the carousel on an empty slot
      setIdx((i) => Math.min(i, Math.max(0, (art?.images.length || 1) - 1 + pendCount)));
    }
    prevPend.current = pendCount;
  }, [pendCount, art?.images.length]);

  if (!id && !art) return <section aria-hidden style={{ position: "absolute", inset: 0, zIndex: 20, transform: "translateX(104%)" }} />;

  const kindCounts: Record<string, number> = { all: art?.images.length || 0 };
  art?.images.forEach((i) => (kindCounts[i.kind] = (kindCounts[i.kind] || 0) + 1));

  // --------------------------------------------------- carousel gestures
  const cDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    cg.current = { x: e.clientX, y: e.clientY, sc: r.width / e.currentTarget.offsetWidth || 1, lock: null, lt: performance.now(), lx: e.clientX, v: 0 };
    setCDrag(true); setCdx(0);
  };
  const cMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cDrag) return;
    const g = cg.current;
    let dx = (e.clientX - g.x) / g.sc; const dy = (e.clientY - g.y) / g.sc;
    if (!g.lock && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      g.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.lock === "x") { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ } }
    }
    if (g.lock !== "x") return;
    const t = performance.now(); g.v = 0.7 * g.v + 0.3 * (((e.clientX - g.lx) / g.sc) / Math.max(1, t - g.lt)); g.lt = t; g.lx = e.clientX;
    if ((safeIdx === 0 && dx > 0) || (safeIdx === slideCount - 1 && dx < 0)) dx *= 0.35;
    setCdx(dx);
  };
  const cUp = () => {
    if (!cDrag) return;
    let i = safeIdx; const v = cg.current.v;
    if ((cdx < -70 || v < -0.45) && i < slideCount - 1) i++;
    else if ((cdx > 70 || v > 0.45) && i > 0) i--;
    setCDrag(false); setCdx(0); setIdx(i);
  };

  // --------------------------------------------------- editing
  const startEdit = () => { if (!art) return; setDraft(toDraft(art)); setIssues({}); setEditing(true); vibrate(5); };
  const cancelEdit = () => { setEditing(false); setDraft(null); setIssues({}); };
  const changes = (() => {
    if (!art || !draft) return 0;
    const base = toDraft(art);
    let n = 0;
    if (draft.title !== base.title) n++;
    if (draft.yearStart.trim() !== base.yearStart) n++;
    if (draft.yearEnd.trim() !== base.yearEnd) n++;
    if (draft.circa !== base.circa) n++;
    if (draft.status !== base.status) n++;
    const keys = new Set([...Object.keys(base.attrs), ...Object.keys(draft.attrs)]);
    keys.forEach((k) => { if (!(blank(base.attrs[k]) && blank(draft.attrs[k])) && !same(base.attrs[k], draft.attrs[k])) n++; });
    return n;
  })();
  const setAttr = (k: string, v: unknown) => setDraft((d) => (d ? { ...d, attrs: { ...d.attrs, [k]: v } } : d));

  const save = async () => {
    if (!art || !draft) return;
    const base = toDraft(art);
    const body: Record<string, unknown> = { version: art.version };
    const errs: Record<string, string> = {};
    const yr = (s: string, key: string) => {
      const t = s.trim(); if (!t) return null;
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1800 || n > 2100) { errs[key] = "Enter a year like 1987"; return undefined; }
      return n;
    };
    if (draft.title !== base.title) body.title = draft.title;
    if (draft.yearStart.trim() !== base.yearStart) body.yearStart = yr(draft.yearStart, "yearStart");
    if (draft.yearEnd.trim() !== base.yearEnd) body.yearEnd = yr(draft.yearEnd, "yearEnd");
    if (draft.circa !== base.circa) body.circa = draft.circa;
    if (draft.status !== base.status) body.status = draft.status;
    const attrs: Record<string, unknown> = {};
    for (const f of p.fields) {
      const nv = draft.attrs[f.key], ov = base.attrs[f.key];
      if (blank(nv) && blank(ov)) continue;
      if (!same(nv, ov)) attrs[f.key] = blank(nv) ? null : f.type === "number" ? Number(nv) : nv;
    }
    if (Object.keys(attrs).length) body.attrs = attrs;
    if (Object.keys(errs).length) { setIssues(errs); vibrate([20, 40, 20]); return; }
    if (Object.keys(body).length === 1) { cancelEdit(); p.toast("Nothing changed"); return; }
    setSaving(true);
    try {
      const a = await api.update(art.id, body);
      setArt(a); setEditing(false); setDraft(null); setIssues({});
      p.toast(`Saved ${changes} ${changes === 1 ? "change" : "changes"}`); vibrate(10);
      p.onChanged();
      api.similar(a.id).then(setSimilar).catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && Array.isArray(e.details)) {
        const m: Record<string, string> = {};
        (e.details as { key: string; message: string }[]).forEach((i) => (m[i.key.replace(/^attrs\./, "")] = i.message));
        setIssues(m); vibrate([20, 40, 20]);
      } else if (e instanceof ApiError && e.status === 409) {
        p.toast("Changed on another device — showing the latest");
        await load(art.id, true); setEditing(false); setDraft(null);
      } else p.toast(e instanceof Error ? e.message : "Couldn't save");
    } finally { setSaving(false); }
  };

  const removeArtwork = async () => {
    if (!art) return;
    try { await api.remove(art.id); p.toast("Removed from the archive"); p.onChanged(); p.onClose(); }
    catch (e) { p.toast(e instanceof Error ? e.message : "Couldn't remove"); }
  };

  // --------------------------------------------------- image actions
  const imageAction = async (fn: () => Promise<Artwork>, msg: string) => {
    try { const a = await fn(); setArt(a); setMenu(null); p.toast(msg); p.onChanged(); }
    catch (e) { p.toast(e instanceof Error ? e.message : "Couldn't update the image"); }
  };

  const journey = art ? [...art.images].filter((i) => i.kind !== "work" || i.id === art.coverImageId)
    .sort((a, b) => KIND_META[a.kind].order - KIND_META[b.kind].order || a.sortOrder - b.sortOrder) : [];
  const statusLabel = (s: string) => p.statuses.find((x) => x.value === s)?.label || s;
  const byId = new Map(p.summaries.map((s) => [s.id, s]));
  const similarItems = similar.map((s) => ({ ...s, a: byId.get(s.id) })).filter((s) => s.a) as { id: string; match: number; a: Summary }[];
  const asp = curImage?.width && curImage?.height ? curImage.width / curImage.height : (art?.cover?.width && art?.cover?.height ? art.cover.width / art.cover.height : 0.8);

  return (
    <section role="dialog" aria-modal="true" aria-label={art?.title || "Artwork"} data-testid="piece"
      style={{ position: "absolute", inset: 0, zIndex: 20, background: "var(--bg-2)", transform: id ? "none" : "translateX(104%)", transition: "transform .55s cubic-bezier(.2,.9,.25,1)", boxShadow: "-30px 0 60px rgba(0,0,0,.5)" }}>
      <div ref={scroller} className="scroll" style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ height: "calc(68px + env(safe-area-inset-top))" }} />
        {!art && !error && <div className="skel" style={{ height: 330, margin: "0 40px", borderRadius: 12 }} />}
        {error && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>{error}<div><button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => id && load(id)}>Try again</button></div></div>}
        {art && (
          <>
            {/* carousel */}
            <div onPointerDown={cDown} onPointerMove={cMove} onPointerUp={cUp} onPointerCancel={cUp} data-testid="carousel"
              style={{ position: "relative", height: 330, overflow: "hidden", touchAction: "pan-y" }}>
              <div style={{ display: "flex", height: "100%", transform: `translateX(calc(${-safeIdx * 100}% + ${cdx}px))`, transition: cDrag ? "none" : "transform .5s var(--ease-out)" }}>
                {images.map((im) => <Slide key={im.id} src={im.display} aspect={im.width && im.height ? im.width / im.height : asp} label={`${KIND_META[im.kind].short} · ${im.role || KIND_META[im.kind].label}`} color={KIND_META[im.kind].color} cover={im.id === art.coverImageId} />)}
                {pend.map((u) => <Slide key={u.tempId} src={u.previewUrl} aspect={asp} label={`${KIND_META[u.kind].short} · ${u.role}`} color={KIND_META[u.kind].color} progress={u.progress} error={u.error} />)}
                <div style={{ flex: "none", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
                  <button className="press" onClick={() => p.onAddImages(art.id, kind === "all" || kind === "work" ? 4 : ROLES.findIndex((r) => r.kind === kind))} data-testid="add-image-slide"
                    style={{ width: 220, height: 260, borderRadius: 22, border: "2px dashed rgba(243,239,232,.25)", background: "rgba(255,255,255,.02)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text)" }}>
                    <span style={{ width: 56, height: 56, borderRadius: 99, background: "var(--lupine-deep)", color: "var(--lupine-soft)", display: "grid", placeItems: "center" }}><IPlus size={24} /></span>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Add images</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "0 20px", lineHeight: 1.4 }}>Studies, progress, references, details — originals stay full size</span>
                  </button>
                </div>
              </div>
              {curImage && (
                <button className="icon-btn press" aria-label="Image options" onClick={() => setMenu("main")} data-testid="image-menu"
                  style={{ position: "absolute", right: 20, bottom: 12, width: 40, height: 40, background: "rgba(18,17,15,.78)", backdropFilter: "blur(10px)" }}><IMore /></button>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "12px 0 4px" }}>
              {Array.from({ length: slideCount }).map((_, i) => (
                <button key={i} aria-label={i < slideCount - 1 ? `Image ${i + 1}` : "Add images"} onClick={() => setIdx(i)}
                  style={{ width: i === safeIdx ? 22 : 7, height: 7, padding: 0, border: 0, borderRadius: 9, background: i === safeIdx ? "var(--text)" : "rgba(243,239,232,.3)", transition: "width .35s cubic-bezier(.3,1.3,.5,1), background .3s" }} />
              ))}
            </div>
            <div className="scroll" style={{ marginTop: 10, overflowX: "auto" }}>
              <div role="tablist" aria-label="Image type" style={{ display: "flex", gap: 7, padding: "0 20px", width: "max-content" }}>
                {KIND_TABS.filter((k) => k === "all" || kindCounts[k]).map((k) => (
                  <button key={k} role="tab" aria-selected={kind === k} className="chip press" style={{ height: 36 }} onClick={() => { setKind(k); setIdx(0); }}>
                    {k !== "all" && <span className="dot" style={{ background: KIND_META[k].color, width: 7, height: 7 }} />}{k === "all" ? "All" : KIND_META[k].plural}<span className="n">{kindCounts[k] || 0}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* details */}
            <div style={{ padding: "18px 20px 0" }}>
              <div className="mono" style={{ fontSize: 11, letterSpacing: ".14em", color: "#FF9A5C" }}>NO. {art.catalogId}</div>
              {!editing && (
                <div className="fadein">
                  <h2 className="display" style={{ margin: "6px 0 0", fontSize: 28, lineHeight: 1.08, fontWeight: 700 }}>{art.title || "Untitled"}</h2>
                  <div className="mono" style={{ marginTop: 8, fontSize: 12, letterSpacing: ".08em", color: "var(--muted)", textTransform: "uppercase" }}>
                    {[yearLabel(art), art.attrs.medium as string, art.attrs.dimensions as string].filter(Boolean).join(" · ")}
                  </div>
                  <dl style={{ margin: "20px 0 0", borderTop: "1px solid rgba(255,255,255,.08)" }} data-testid="facts">
                    <Row k="Where it is" v={statusLabel(art.status)} dot={STATUS_COLOR[art.status]} />
                    {p.fields.filter((f) => !f.archived).map((f) => {
                      const v = art.attrs[f.key];
                      const text = blank(v) ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "object" ? (v as { year?: number }).year?.toString() || "" : String(v);
                      return <Row key={f.key} k={f.label} v={text || (f.key === "notes" ? "[Add the story behind it]" : "—")} multiline={f.type === "long_text"} faint={!text} />;
                    })}
                    <Row k="Year" v={yearLabel(art)} />
                    <Row k="Images" v={`${art.images.length}`} />
                  </dl>
                  {art.aiDescription && <p style={{ margin: "16px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)" }}><ISpark size={12} /> {art.aiDescription}</p>}
                </div>
              )}
              {editing && draft && (
                <div className="inup" style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 10 }} data-testid="edit-form">
                  <div>
                    <label className="lbl" htmlFor="f-title">Title</label>
                    <input id="f-title" className="field display" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="[Title]" style={{ marginTop: 7, fontSize: 19, fontWeight: 700 }} />
                    {issues.title && <div className="field-error">{issues.title}</div>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
                    <div><label className="lbl" htmlFor="f-ys">Year</label><input id="f-ys" className="field" inputMode="numeric" value={draft.yearStart} onChange={(e) => setDraft({ ...draft, yearStart: e.target.value })} placeholder="1987" style={{ marginTop: 7 }} /></div>
                    <div><label className="lbl" htmlFor="f-ye">To (optional)</label><input id="f-ye" className="field" inputMode="numeric" value={draft.yearEnd} onChange={(e) => setDraft({ ...draft, yearEnd: e.target.value })} placeholder="—" style={{ marginTop: 7 }} /></div>
                    <button className="chip press" aria-pressed={draft.circa} onClick={() => setDraft({ ...draft, circa: !draft.circa })} style={{ height: 46 }}>c.</button>
                  </div>
                  {(issues.yearStart || issues.yearEnd) && <div className="field-error" style={{ marginTop: -10 }}>{issues.yearStart || issues.yearEnd}</div>}
                  <div>
                    <div className="lbl">Where it is</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
                      {p.statuses.map((s) => (
                        <button key={s.value} className="chip press" aria-pressed={draft.status === s.value} onClick={() => setDraft({ ...draft, status: s.value })}>
                          <span className="dot" style={{ background: STATUS_COLOR[s.value] }} />{s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {p.fields.filter((f) => !f.archived).map((f) => (
                    <FieldEditor key={f.key} f={f} value={draft.attrs[f.key]} onChange={(v) => setAttr(f.key, v)} error={issues[f.key]} />
                  ))}
                  <div style={{ marginTop: 6, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,.08)" }}>
                    {!confirmDelete
                      ? <button className="btn btn-danger press" style={{ width: "100%", height: 48 }} onClick={() => setConfirmDelete(true)}><ITrash />Remove from archive</button>
                      : <div className="inup" style={{ display: "flex", gap: 10 }}>
                          <button className="btn btn-ghost press" style={{ flex: 1, height: 48 }} onClick={() => setConfirmDelete(false)}>Keep it</button>
                          <button className="btn press" style={{ flex: 1, height: 48, background: "#C2412D", color: "#fff" }} onClick={removeArtwork} data-testid="confirm-remove">Yes, remove</button>
                        </div>}
                  </div>
                </div>
              )}
            </div>

            {/* how it came together */}
            {!editing && (
              <div style={{ padding: "30px 0 0" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "0 20px" }}>
                  <span className="display" style={{ fontSize: 20, fontWeight: 700 }}>How it came together</span>
                  <span className="mono" style={{ fontSize: 10.5, letterSpacing: ".08em", color: "var(--muted)", whiteSpace: "nowrap" }}>{journey.length} STEPS · {art.images.length} IMAGES</span>
                </div>
                <div className="scroll" style={{ marginTop: 14, overflowX: "auto" }}>
                  <div style={{ position: "relative", display: "flex", gap: 14, padding: "0 20px 4px", width: "max-content" }} data-testid="journey">
                    {journey.length > 1 && <div aria-hidden style={{ position: "absolute", left: 30, right: 130, top: 46, height: 2, background: "linear-gradient(90deg,#A9DDB5,#C9BEFF 35%,#FFD678 65%,#FF9A5C)" }} />}
                    {journey.map((im, j) => {
                      const on = im.id === curImage?.id;
                      return (
                        <button key={im.id} className="press" aria-label={`Step ${j + 1}, ${KIND_META[im.kind].label}: ${im.role}`}
                          onClick={() => { setKind("all"); setIdx(art.images.findIndex((x) => x.id === im.id)); scroller.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
                          style={{ position: "relative", width: 100, padding: 0, border: 0, background: "transparent", textAlign: "left", color: "var(--text)" }}>
                          <div style={{ width: 100, height: 92, borderRadius: 12, overflow: "hidden", background: "#23201C", boxShadow: on ? `0 0 0 2px var(--bg-2),0 0 0 4px ${KIND_META[im.kind].color}` : "0 6px 16px rgba(0,0,0,.35)", transition: "box-shadow .3s" }}>
                            <img src={im.thumb} alt="" loading="lazy" className="art-img" draggable={false} />
                          </div>
                          <span style={{ position: "absolute", left: 6, top: 6, width: 22, height: 22, borderRadius: 99, background: "rgba(18,17,15,.8)", display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 600 }}>{j + 1}</span>
                          <span className="mono" style={{ display: "block", marginTop: 9, fontSize: 9.5, letterSpacing: ".12em", color: KIND_META[im.kind].color }}>{KIND_META[im.kind].short}</span>
                          <span className="clamp2" style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{im.role || KIND_META[im.kind].label}</span>
                        </button>
                      );
                    })}
                    <button className="press" onClick={() => p.onAddImages(art.id, 0)} data-testid="add-step"
                      style={{ width: 100, height: 92, borderRadius: 12, border: "2px dashed rgba(243,239,232,.22)", background: "var(--bg-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}>
                      <IPlus size={18} />Add a step
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* more like this */}
            {!editing && similarItems.length > 0 && (
              <div style={{ padding: "30px 0 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 20px", color: "var(--lupine-soft)" }}>
                  <ISpark size={15} /><span className="display" style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>More like this</span>
                </div>
                <div className="scroll" style={{ marginTop: 12, overflowX: "auto" }}>
                  <div style={{ display: "flex", gap: 12, padding: "0 20px", width: "max-content" }} data-testid="similar">
                    {similarItems.map((s) => (
                      <button key={s.id} className="press" onClick={() => p.onOpen(s.id)} aria-label={`Open ${s.a.title || "Untitled"}, ${pct(s.match)} similar`}
                        style={{ width: 132, padding: 0, border: 0, background: "transparent", textAlign: "left", color: "var(--text)" }}>
                        <div style={{ position: "relative", width: 132, height: 132, borderRadius: 14, overflow: "hidden", background: "#23201C" }}>
                          {s.a.thumb && <img src={s.a.thumb} alt="" loading="lazy" className="art-img" draggable={false} />}
                          <span style={{ position: "absolute", left: 7, top: 7, height: 22, padding: "0 7px", display: "flex", alignItems: "center", borderRadius: 99, background: "rgba(42,37,71,.92)", color: "var(--lupine-soft)", fontSize: 11, fontWeight: 700 }}>{pct(s.match)}</span>
                        </div>
                        <span className="clamp2" style={{ marginTop: 7, fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{s.a.title || "Untitled"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div style={{ height: "calc(140px + env(safe-area-inset-bottom))" }} />
          </>
        )}
      </div>

      {/* top bar */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(14px + env(safe-area-inset-top)) 12px 10px", background: "linear-gradient(180deg,var(--bg-2) 55%,rgba(18,17,15,0))" }}>
        <button className="icon-btn press" aria-label="Back" onClick={() => { if (editing && changes && !confirm("Discard your changes?")) return; cancelEdit(); p.onClose(); }} data-testid="back"><IBack /></button>
        <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", color: "var(--muted)" }}>
          {art ? (safeIdx < images.length + pend.length ? `${safeIdx + 1} / ${images.length + pend.length} ${kind === "all" ? "IMAGES" : KIND_META[kind].plural.toUpperCase()}` : "ADD IMAGES") : ""}
        </span>
        <button className="press" onClick={editing ? save : startEdit} disabled={!art || saving} data-testid="edit-toggle"
          style={{ height: 44, minWidth: 72, padding: "0 16px", borderRadius: 999, border: 0, background: editing ? "var(--lupine)" : "rgba(36,33,30,.8)", color: editing ? "#15121F" : "var(--text)", fontSize: 14, fontWeight: 700, transition: "background .3s, color .3s" }}>
          {editing ? (saving ? "Saving…" : "Done") : "Edit"}
        </button>
      </div>

      {/* save bar */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 4, padding: "12px 16px calc(24px + env(safe-area-inset-bottom))", display: "flex", gap: 10, background: "linear-gradient(180deg,rgba(18,17,15,0),var(--bg-2) 32%)", transform: `translateY(${editing ? "0" : "120%"})`, transition: "transform .45s cubic-bezier(.2,.9,.25,1)" }}>
        <button className="btn btn-ghost press" style={{ background: "var(--bg-2)" }} onClick={cancelEdit} tabIndex={editing ? 0 : -1}>Cancel</button>
        <button className="btn press" style={{ flex: 1, background: changes ? "var(--poppy)" : "#8A847A", color: "#1A110A", transition: "background .3s" }} onClick={save} disabled={saving} tabIndex={editing ? 0 : -1} data-testid="save">
          {saving ? "Saving…" : changes ? `Save ${changes} ${changes === 1 ? "change" : "changes"}` : "Save"}
        </button>
      </div>

      {/* image options */}
      {menu && curImage && art && (
        <>
          <div className="scrim" style={{ opacity: 1, zIndex: 40 }} onClick={() => setMenu(null)} aria-hidden />
          <div className="inup" role="dialog" aria-label="Image options" data-testid="image-options"
            style={{ position: "absolute", left: 12, right: 12, bottom: "calc(12px + env(safe-area-inset-bottom))", zIndex: 41, borderRadius: 24, background: "var(--surface)", border: "1px solid var(--line)", padding: 10 }}>
            {menu === "main" && (
              <>
                <div style={{ padding: "8px 10px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                  <img src={curImage.thumb} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} />
                  <div><div style={{ fontWeight: 600 }}>{curImage.role || KIND_META[curImage.kind].label}</div><div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{KIND_META[curImage.kind].short} · {curImage.width && curImage.height ? `${curImage.width}×${curImage.height}` : ""} · {(curImage.bytes / 1e6).toFixed(1)} MB</div></div>
                </div>
                {curImage.id !== art.coverImageId && <MenuItem icon={<IStar />} label="Make this the main image" onClick={() => imageAction(() => api.updateImage(curImage.id, { makeCover: true }), "Main image updated")} />}
                <MenuItem icon={<ITag />} label="Change what it is" onClick={() => setMenu("kind")} />
                <MenuItem icon={<ITag />} label="Rename label" onClick={() => { setLabelText(curImage.role); setMenu("label"); }} />
                <a href={`${curImage.original}?download=1`} style={{ textDecoration: "none" }}><MenuItem icon={<IDownload />} label="Download original" onClick={() => setMenu(null)} /></a>
                <MenuItem icon={<ITrash />} label="Remove image" danger onClick={() => setMenu("delete")} />
              </>
            )}
            {menu === "kind" && (
              <div style={{ padding: 10 }}>
                <div className="lbl">What is this image?</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                  {ROLES.map((r) => (
                    <button key={r.label} className="chip press" aria-pressed={curImage.kind === r.kind && curImage.role === r.role}
                      onClick={() => imageAction(() => api.updateImage(curImage.id, { kind: r.kind, role: r.role }), `Marked as ${r.label.toLowerCase()}`)}>
                      <span className="dot" style={{ background: KIND_META[r.kind].color }} />{r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {menu === "label" && (
              <form style={{ padding: 10, display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); imageAction(() => api.updateImage(curImage.id, { role: labelText }), "Label updated"); }}>
                <input className="field" autoFocus value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="e.g. Color study, morning" aria-label="Image label" />
                <button className="btn btn-light press" style={{ height: 46 }} type="submit"><ICheck /></button>
              </form>
            )}
            {menu === "delete" && (
              <div style={{ padding: 10 }}>
                <div style={{ fontWeight: 600 }}>Remove this image?</div>
                <p style={{ margin: "6px 0 14px", fontSize: 14, color: "var(--muted)" }}>It disappears from this piece. The original file stays in storage.</p>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn btn-ghost press" style={{ flex: 1, height: 48 }} onClick={() => setMenu(null)}>Keep</button>
                  <button className="btn press" style={{ flex: 1, height: 48, background: "#C2412D", color: "#fff" }} data-testid="confirm-remove-image"
                    onClick={() => imageAction(() => api.deleteImage(curImage.id), "Image removed").then(() => setIdx((i) => Math.max(0, i - 1)))}>Remove</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Slide({ src, aspect, label, color, cover, progress, error }: { src: string; aspect: number; label: string; color: string; cover?: boolean; progress?: number; error?: string }) {
  let w = Math.min(320, 290 * aspect), h = w / aspect;
  if (h > 290) { h = 290; w = h * aspect; }
  return (
    <div style={{ flex: "none", width: "100%", height: "100%", display: "grid", placeItems: "center", position: "relative" }}>
      <div style={{ position: "relative", width: Math.round(w), height: Math.round(h), borderRadius: 4, overflow: "hidden", background: "#23201C", boxShadow: "0 26px 54px rgba(0,0,0,.6)" }}>
        <img src={src} alt={label} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {progress !== undefined && (
          <div className="fadein" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(10,9,8,.55)" }} data-testid="upload-progress">
            {error ? <div style={{ padding: 16, textAlign: "center", fontSize: 13, color: "#FFB0A3" }}>{error}</div> : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(243,239,232,.2)" strokeWidth="5" /><circle cx="32" cy="32" r="26" fill="none" stroke="#F3EFE8" strokeWidth="5" strokeLinecap="round" strokeDasharray="163.4" strokeDashoffset={163.4 * (1 - progress)} transform="rotate(-90 32 32)" style={{ transition: "stroke-dashoffset .2s" }} /></svg>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{progress >= 1 ? "Saving…" : `${Math.round(progress * 100)}%`}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <span style={{ position: "absolute", left: 24, bottom: 12, height: 28, padding: "0 11px", display: "flex", alignItems: "center", gap: 7, borderRadius: 99, background: "rgba(18,17,15,.78)", backdropFilter: "blur(10px)", fontSize: 11.5, fontWeight: 600, letterSpacing: ".02em" }}>
        <span style={{ width: 7, height: 7, borderRadius: 9, background: color }} />{label}{cover && <span style={{ color: "var(--muted)" }}>· main</span>}
      </span>
    </div>
  );
}

function Row({ k, v, dot, multiline, faint }: { k: string; v: string; dot?: string; multiline?: boolean; faint?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: "1px solid rgba(255,255,255,.08)", flexDirection: multiline && !faint ? "column" : "row" }}>
      <dt style={{ fontSize: 14, color: "var(--muted)", flex: "none" }}>{k}</dt>
      <dd style={{ margin: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 500, textAlign: multiline && !faint ? "left" : "right", color: faint ? "var(--faint)" : "var(--text)", whiteSpace: multiline ? "pre-wrap" : undefined, lineHeight: 1.45, userSelect: "text" }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: 9, background: dot, flex: "none" }} />}{v}
      </dd>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className="press" onClick={onClick} style={{ width: "100%", height: 52, padding: "0 12px", display: "flex", alignItems: "center", gap: 12, border: 0, borderRadius: 14, background: "transparent", color: danger ? "#FF9C8F" : "var(--text)", fontSize: 15, fontWeight: 500, textAlign: "left" }}>
      <span style={{ color: danger ? "#FF9C8F" : "var(--muted)" }}>{icon}</span>{label}
    </button>
  );
}

function FieldEditor({ f, value, onChange, error }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const id = `f-${f.key}`;
  const label = <label className="lbl" htmlFor={id}>{f.label}{f.required && <span style={{ color: "var(--poppy-soft)" }}> · needed</span>}</label>;
  const err = error ? <div className="field-error">{error}</div> : null;
  if (f.type === "select" || f.type === "multi_select") {
    const multi = f.type === "multi_select";
    const sel: string[] = multi ? (Array.isArray(value) ? (value as string[]) : []) : value ? [String(value)] : [];
    const choices = [...(f.options.choices || [])];
    sel.forEach((s) => { if (!choices.includes(s)) choices.push(s); });
    const toggle = (c: string) => {
      if (multi) onChange(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]);
      else onChange(sel[0] === c ? null : c);
    };
    const add = () => { const v = newVal.trim(); if (v) { if (!sel.includes(v)) toggle(v); } setNewVal(""); setAdding(false); };
    return (
      <div>
        <div className="lbl" id={id}>{f.label}{f.required && <span style={{ color: "var(--poppy-soft)" }}> · needed</span>}</div>
        <div role={multi ? "group" : "radiogroup"} aria-labelledby={id} style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
          {choices.map((c) => <button key={c} className="chip press" aria-pressed={sel.includes(c)} onClick={() => toggle(c)} style={{ height: 36 }}>{c}</button>)}
          {f.options.allowNew !== false && !adding && <button className="chip press" onClick={() => setAdding(true)} style={{ height: 36, borderStyle: "dashed" }}><IPlus size={14} />New</button>}
          {adding && (
            <form onSubmit={(e) => { e.preventDefault(); add(); }} style={{ display: "flex", gap: 6 }}>
              <input autoFocus className="field" value={newVal} onChange={(e) => setNewVal(e.target.value)} onBlur={add} placeholder={`New ${f.label.toLowerCase()}`} aria-label={`New ${f.label}`} style={{ height: 36, width: 170, fontSize: 14 }} />
            </form>
          )}
        </div>
        {err}
      </div>
    );
  }
  if (f.type === "long_text") return <div>{label}<textarea id={id} className="field" rows={4} value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} placeholder={f.helpText || ""} style={{ marginTop: 7 }} />{err}</div>;
  if (f.type === "boolean") return <div><div className="lbl">{f.label}</div><div style={{ display: "flex", gap: 7, marginTop: 8 }}>{[true, false].map((b) => <button key={String(b)} className="chip press" aria-pressed={value === b} onClick={() => onChange(value === b ? null : b)}>{b ? "Yes" : "No"}</button>)}</div>{err}</div>;
  if (f.type === "fuzzy_date") {
    const y = (value as { year?: number } | null)?.year ?? "";
    return <div>{label}<input id={id} className="field" inputMode="numeric" value={y} onChange={(e) => { const n = parseInt(e.target.value, 10); onChange(isNaN(n) ? null : { year: n }); }} placeholder="Year" style={{ marginTop: 7 }} />{err}</div>;
  }
  return (
    <div>{label}
      <input id={id} className="field" inputMode={f.type === "number" ? "decimal" : f.type === "url" ? "url" : undefined} value={(value as string | number | undefined) ?? ""}
        onChange={(e) => onChange(e.target.value)} placeholder={f.helpText || ""} style={{ marginTop: 7 }} />
      {err}
    </div>
  );
}
