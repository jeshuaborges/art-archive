import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, onSignedOut } from "./api";
import { prepareImage } from "./imageprep";
import type { Config, FieldDef, Filters, Summary } from "./types";
import { archivedChipLabel, countLabel, emptyFilters } from "./types";
import { paletteHas, save, STATUS_COLOR, store, SWATCHES, vibrate } from "./util";
import { TopBar } from "./components/TopBar";
import { Timeline } from "./components/Timeline";
import { Wall } from "./components/Wall";
import { FilterSheet } from "./components/FilterSheet";
import { PieceView, type PendingUpload } from "./components/PieceView";
import { ROLES, UploadSheet } from "./components/UploadSheet";
import { IArchive, ICheck, IClose, IPlus } from "./components/Icons";
import { SignedOut } from "./components/SignedOut";
import { shouldProbe } from "./session";
import { landscapeChrome, stripSpec } from "./layout";
import { useKeyboardInset, useLayout } from "./viewport";
import { defaultTimelineIndex, sortOldestFirst } from "./years";

type View = "timeline" | "wall";

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [items, setItems] = useState<Summary[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [view, setViewState] = useState<View>(() => store<View>("view", "wall"));
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Map<string, number> | null>(null);
  const [searching, setSearching] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [tlId, setTlId] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [editNew, setEditNew] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sheet, setSheet] = useState<null | "filters" | "upload">(null);
  const [upload, setUpload] = useState<{ mode: "photo" | "new"; artworkId?: string; roleIdx: number }>({ mode: "new", roleIdx: 0 });
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const [selected, setSelected] = useState<Set<string> | null>(null); // bulk unarchive, in the "only archived" wall
  const archived = filters.archived;
  const layout = useLayout();
  useKeyboardInset();
  const { landscape, compact, panel } = layout;

  const showToast = useCallback((m: string) => {
    setToast(m); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  const setView = (v: View) => { setViewState(v); save("view", v); };

  // the list follows the archived choice; only the latest request may land
  const listReq = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++listReq.current;
    try { const l = await api.list(archived); if (n === listReq.current) setItems(l); setFields(await api.fields()); }
    catch (e) { showToast(e instanceof Error ? e.message : "Couldn't refresh"); }
  }, [archived, showToast]);
  const firstArchived = useRef(true);
  useEffect(() => {
    if (firstArchived.current) { firstArchived.current = false; return; }
    setSelected(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived]);

  useEffect(() => {
    Promise.all([api.config(), api.fields(), api.list()])
      .then(([c, f, l]) => { setConfig(c); setFields(f); setItems(l); })
      .catch((e) => setBootError(e instanceof Error ? e.message : "Couldn't load the archive."));
  }, []);

  // An expired Access session: any request can notice it (api.ts), and coming
  // back to the app checks it at most once a minute, so the prompt shows up on
  // return rather than on the first tap.
  useEffect(() => onSignedOut(() => setSignedOut(true)), []);
  useEffect(() => {
    let last = Date.now(); // the boot requests above just checked
    const probe = () => {
      if (document.visibilityState !== "visible" || !shouldProbe(Date.now(), last)) return;
      last = Date.now();
      api.me().catch(() => { /* signed out → onSignedOut; offline → the next action says so */ });
    };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) probe(); };
    document.addEventListener("visibilitychange", probe);
    window.addEventListener("pageshow", onShow);
    return () => { document.removeEventListener("visibilitychange", probe); window.removeEventListener("pageshow", onShow); };
  }, []);

  // deep links: #/piece/<id>
  useEffect(() => {
    const apply = () => {
      const m = /^#\/piece\/(.+)$/.exec(location.hash);
      setDetail(m ? decodeURIComponent(m[1]) : null);
      if (!m) setEditNew(false);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const pushed = useRef(false);
  const openPiece = useCallback((id: string, edit = false) => {
    setEditNew(edit);
    const h = `#/piece/${encodeURIComponent(id)}`;
    if (location.hash.startsWith("#/piece/")) { history.replaceState(null, "", h); setDetail(id); }
    else { pushed.current = true; location.hash = h; }
  }, []);
  const closePiece = useCallback(() => {
    if (pushed.current) { pushed.current = false; history.back(); return; }
    history.replaceState(null, "", location.pathname + location.search);
    setDetail(null); setEditNew(false);
  }, []);

  // semantic + keyword search (debounced)
  useEffect(() => {
    const term = q.trim();
    if (!term) { setMatches(null); setSearching(false); return; }
    const ctl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      api.search(term, ctl.signal, archived)
        .then((r) => setMatches(new Map(r.results.map((x) => [x.id, x.match]))))
        .catch((e) => { if (e?.name !== "AbortError") showToast("Search isn't available right now"); })
        .finally(() => setSearching(false));
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, archived, showToast]);

  const bounds = useMemo<[number, number]>(() => {
    const ys = (items || []).map((a) => a.yearStart).filter((y): y is number => y != null);
    const now = new Date().getFullYear();
    return ys.length ? [Math.floor(Math.min(...ys) / 10) * 10, Math.max(now, ...ys)] : [1970, now];
  }, [items]);

  const passes = useCallback((a: Summary) => {
    for (const [key, sel] of Object.entries(filters.values)) {
      if (!sel.length) continue;
      const v = a.attrs[key];
      if (Array.isArray(v) ? !v.some((x) => sel.includes(x)) : !sel.includes(String(v ?? "").trim())) return false;
    }
    if (filters.status.length && !filters.status.includes(a.status)) return false;
    if (filters.color && !paletteHas(a.palette, filters.color)) return false;
    if (filters.years && (a.yearStart == null || a.yearStart < filters.years[0] || a.yearStart > filters.years[1])) return false;
    return true;
  }, [filters]);

  const filtered = useMemo(() => (items || []).filter((a) => passes(a) && (!matches || matches.has(a.id))), [items, passes, matches]);
  const byYear = useMemo(() => sortOldestFirst(filtered), [filtered]);
  const ranked = useMemo(() => (matches ? [...filtered].sort((a, b) => (matches.get(b.id) || 0) - (matches.get(a.id) || 0)) : filtered), [filtered, matches]);
  const tlIndex = (() => {
    const i = tlId ? byYear.findIndex((a) => a.id === tlId) : -1;
    if (i >= 0) return i;
    if (matches && ranked.length) return Math.max(0, byYear.findIndex((a) => a.id === ranked[0].id));
    return defaultTimelineIndex(byYear);
  })();

  const statusLabel = useCallback((s: string) => config?.statuses.find((x) => x.value === s)?.label || s, [config]);
  const chips: { label: string; dot?: string; remove: () => void }[] = [];
  Object.entries(filters.values).forEach(([key, sel]) => sel.forEach((v) => chips.push({ label: v, remove: () => setFilters((f) => ({ ...f, values: { ...f.values, [key]: (f.values[key] || []).filter((x) => x !== v) } })) })));
  filters.status.forEach((s) => chips.push({ label: statusLabel(s), dot: STATUS_COLOR[s], remove: () => setFilters((f) => ({ ...f, status: f.status.filter((x) => x !== s) })) }));
  if (filters.color) chips.push({ label: SWATCHES.find((w) => w[0] === filters.color)?.[1] || "Color", dot: filters.color, remove: () => setFilters((f) => ({ ...f, color: null })) });
  if (filters.years) chips.push({ label: `${filters.years[0]}–${filters.years[1]}`, remove: () => setFilters((f) => ({ ...f, years: null })) });
  const archivedChip = archivedChipLabel(archived);
  if (archivedChip) chips.push({ label: archivedChip, remove: () => setFilters((f) => ({ ...f, archived: "exclude" })) });

  // --------------------------------------------------------------- bulk unarchive
  const selecting = !!selected && archived === "only" && view === "wall";
  const toggleSelected = (id: string) => { vibrate(4); setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const unarchiveSelected = async () => {
    if (!selected?.size) return;
    try {
      const r = await api.unarchiveMany([...selected]);
      const n = r.changed.length;
      showToast(`${n === 1 ? "1 piece" : `${n} pieces`} back in the archive`); vibrate(10);
      setSelected(null); refresh();
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't unarchive"); }
  };

  // --------------------------------------------------------------- uploads
  const startUploads = useCallback(async (artworkId: string, files: File[], roleIdx: number, firstIsCover: boolean) => {
    const role = ROLES[roleIdx] || ROLES[3];
    const jobs = files.map((f, i) => ({ f, tempId: `up-${Date.now()}-${i}`, role: firstIsCover && i === 0 ? ROLES[3] : role }));
    setPending((p) => [...p, ...jobs.map((j) => ({ tempId: j.tempId, artworkId, previewUrl: URL.createObjectURL(j.f), kind: j.role.kind, role: j.role.role, progress: 0 }))]);
    let ok = 0, dupes = 0;
    for (const j of jobs) {
      try {
        const prepared = await prepareImage(j.f);
        setPending((p) => p.map((u) => (u.tempId === j.tempId ? { ...u, previewUrl: prepared.previewUrl } : u)));
        const r = await api.uploadImage(artworkId, prepared, { kind: j.role.kind, role: j.role.role, makeCover: firstIsCover && j === jobs[0] }, (frac) =>
          setPending((p) => p.map((u) => (u.tempId === j.tempId ? { ...u, progress: frac } : u))));
        if (r.duplicate) dupes++; else ok++;
        setPending((p) => p.filter((u) => u.tempId !== j.tempId));
        setReloadKey((k) => k + 1);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        setPending((p) => p.map((u) => (u.tempId === j.tempId ? { ...u, error: msg } : u)));
        showToast(msg.length > 60 ? "That file couldn't be added" : msg); vibrate([20, 40, 20]);
        setTimeout(() => setPending((p) => p.filter((u) => u.tempId !== j.tempId)), 5000);
      }
    }
    if (ok) { showToast(`${ok === 1 ? "Image" : `${ok} images`} uploaded · originals kept full size`); vibrate(10); }
    if (dupes) showToast(dupes === 1 ? "That image was already on this piece" : `${dupes} images were already on this piece`);
    refresh();
  }, [refresh, showToast]);

  const onFiles = async (files: File[]) => {
    setSheet(null);
    if (upload.mode === "photo" && upload.artworkId) { startUploads(upload.artworkId, files, upload.roleIdx, false); return; }
    try {
      const a = await api.create({ status: "in_studio" });
      await refresh();
      openPiece(a.id, true);
      startUploads(a.id, files, 3, true);
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't start a new work"); }
  };

  if (bootError) return <div className="app" style={{ display: "grid", placeItems: "center", padding: 32, textAlign: "center", color: "var(--muted)" }}>{signedOut ? <SignedOut /> : <div><div className="display" style={{ fontSize: 24, color: "var(--text)", marginBottom: 10 }}>Archive unavailable</div>{bootError}<div><button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={() => location.reload()}>Reload</button></div></div>}</div>;

  const cur = byYear[tlIndex];
  const glow = cur?.palette?.length ? cur.palette : ["#3A2F5C", "#5C3A2A"];
  const empty = items !== null && items.length === 0 && archived !== "only";
  const noneArchived = items !== null && items.length === 0 && archived === "only";
  const none = items !== null && items.length > 0 && filtered.length === 0;

  // where the floating controls go: centered at the bottom in portrait and on the
  // landscape wall; on the landscape timeline, in the label panel, level with the filmstrip
  const chrome = landscapeChrome(compact);
  const strip = stripSpec(compact);
  const stripBottom = "max(6px, var(--sab))";
  const tlLandscape = landscape && view === "timeline";
  const addH = compact ? 46 : 52;
  const floatPos: React.CSSProperties = tlLandscape
    ? { left: `calc(100% - var(--gr) - ${panel}px)`, bottom: `calc(${strip.height - strip.top - strip.thumb - (addH - strip.thumb) / 2}px + ${stripBottom})` }
    : { left: "50%", bottom: `calc(${landscape ? 16 : 26}px + var(--sab))`, transform: "translateX(-50%)" };
  const count = countLabel({ total: items ? items.length : null, shown: filtered.length, searching: !!matches, archived, filtered: chips.length > (archivedChip ? 1 : 0) });
  // the chips row only takes room when it has something to say; otherwise the views move up under the top bar
  const chipsRow = chips.length > 0 || count !== null;
  const viewTop = landscape ? 70 : chipsRow ? 118 : 72;
  const chipsPos: React.CSSProperties = !landscape
    ? { left: 0, right: 0, top: "calc(72px + var(--sat))", height: 44 }
    : view === "timeline"
      ? { right: "var(--gr)", width: panel, top: `calc(${chrome.chipsTop}px + var(--sat))`, height: 34 }
      : { left: "var(--gl)", right: `calc(var(--gr) + ${panel + 12}px)`, top: `calc(${chrome.barTop}px + var(--sat))`, height: 48 };

  return (
    <div className="app" data-testid="app" data-layout={landscape ? "landscape" : "portrait"} data-compact={compact ? "true" : undefined}>
      <div className="clip" style={{ position: "absolute", inset: 0, background: "var(--bg)", transform: detail ? "translateX(-28%)" : "none", filter: detail ? "brightness(.55)" : "none", transition: "transform .55s cubic-bezier(.2,.9,.25,1), filter .55s" }} aria-hidden={!!detail}>
        <div aria-hidden style={{ position: "absolute", left: landscape ? "8%" : -120, top: landscape ? -60 : 60, width: 360, height: 360, borderRadius: "50%", background: glow[0], filter: "blur(90px)", opacity: 0.45, transition: "background-color 1.1s ease" }} />
        <div aria-hidden style={{ position: "absolute", right: landscape ? "6%" : -140, top: landscape ? "38%" : 320, width: 380, height: 380, borderRadius: "50%", background: glow[1] || glow[0], filter: "blur(100px)", opacity: 0.32, transition: "background-color 1.1s ease" }} />

        <TopBar view={view} onView={setView} q={q} onQ={(v) => { setQ(v); setTlId(null); }} searching={searching} filterCount={chips.length} onOpenFilters={() => setSheet("filters")} layout={layout} />

        {chipsRow && <div className="scroll" style={{ position: "absolute", ...chipsPos, zIndex: 5, overflowX: "auto", overflowY: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: "100%", padding: landscape ? 0 : "0 16px", width: "max-content" }} data-testid="chips-row">
            {chips.map((c) => (
              <button key={c.label} className="popin press" onClick={c.remove} aria-label={`Remove filter ${c.label}`}
                style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 10px 0 12px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--glass)", color: "var(--text)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                {c.dot && <span style={{ width: 8, height: 8, borderRadius: 9, background: c.dot }} />}{c.label}<span style={{ color: "var(--muted)" }}><IClose /></span>
              </button>
            ))}
            {count && <span className="mono" style={{ fontSize: 11, letterSpacing: ".08em", color: "var(--muted)", whiteSpace: "nowrap", paddingLeft: landscape && !chips.length ? 0 : 4 }} data-testid="count-label">{count}</span>}
          </div>
        </div>}

        {items === null && <div style={landscape ? { position: "absolute", left: "calc(var(--gl) + 48px)", right: `calc(var(--gr) + ${panel + 72}px)`, top: "calc(28px + var(--sat))", bottom: `calc(${strip.height + 24}px + var(--sab))`, borderRadius: 8 } : { position: "absolute", left: 60, right: 60, top: 180, height: 300, borderRadius: 8 }} className="skel" />}
        {!empty && !none && items && view === "timeline" && (
          <Timeline key="tl" list={byYear} index={tlIndex} onIndex={(i) => setTlId(byYear[i]?.id ?? null)} onOpen={(id) => openPiece(id)} matchOf={matches ? (id) => matches.get(id) : undefined} statusLabel={statusLabel} layout={layout} top={viewTop} />
        )}
        {!empty && !none && items && view === "wall" && (
          <Wall key="wall" list={ranked} ranked={!!matches} matchOf={matches ? (id) => matches.get(id) : undefined} onOpen={(id) => openPiece(id)}
            selected={selecting ? selected! : undefined} onToggle={toggleSelected} layout={layout} top={viewTop} />
        )}
        {none && (
          <div className="inup" style={{ position: "absolute", left: "calc(var(--gl) + 16px)", right: "calc(var(--gr) + 16px)", top: "34%", textAlign: "center" }} data-testid="no-matches">
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Nothing matches yet</div>
            <p style={{ margin: "10px 0 22px", fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>Try fewer filters or describe the painting differently.</p>
            <button className="btn btn-light press" onClick={() => { setQ(""); setFilters(emptyFilters()); }}>Clear search &amp; filters</button>
          </div>
        )}
        {noneArchived && (
          <div className="inup" style={{ position: "absolute", left: "calc(var(--gl) + 16px)", right: "calc(var(--gr) + 16px)", top: "30%", textAlign: "center" }} data-testid="none-archived">
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Nothing is archived</div>
            <p style={{ margin: "10px 0 22px", fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>Archive a piece from its page to put it out of sight without removing it.</p>
            <button className="btn btn-light press" onClick={() => setFilters((f) => ({ ...f, archived: "exclude" }))}>Back to the archive</button>
          </div>
        )}
        {empty && (
          <div className="inup" style={{ position: "absolute", left: "calc(var(--gl) + 16px)", right: "calc(var(--gr) + 16px)", top: "30%", textAlign: "center" }}>
            <div className="display" style={{ fontSize: 28, fontWeight: 700 }}>Start the archive</div>
            <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.5, color: "var(--muted)" }}>Photograph a painting and it becomes the first piece. Add studies, progress shots and details whenever you like.</p>
          </div>
        )}

        {archived !== "only" && (
          <button className="press" onClick={() => { setUpload({ mode: "new", roleIdx: 3 }); setSheet("upload"); }} data-testid="add-work"
            style={{ position: "absolute", ...floatPos, zIndex: 8, height: addH, padding: "0 22px 0 18px", borderRadius: 999, border: 0, background: "var(--lupine)", color: "#16122B", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 14px 34px rgba(167,150,255,.34)" }}>
            <IPlus />Add work
          </button>
        )}
        {archived === "only" && !!items?.length && !selecting && (
          <button className="press" onClick={() => { setView("wall"); setSelected(new Set()); vibrate(5); }} data-testid="select-archived"
            style={{ position: "absolute", ...floatPos, zIndex: 8, height: addH, padding: "0 22px 0 18px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--glass)", backdropFilter: "blur(14px)", color: "var(--text)", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", boxShadow: "0 14px 34px rgba(0,0,0,.45)" }}>
            <IArchive />Select to unarchive
          </button>
        )}
        {selecting && (
          <div className="inup" data-testid="select-bar"
            style={{ position: "absolute", left: "var(--gl)", right: "var(--gr)", ...(landscape ? { width: "min(560px, calc(100% - 32px))", margin: "0 auto" } : {}), bottom: `calc(${landscape ? 14 : 20}px + var(--sab))`, zIndex: 8, display: "flex", gap: 10 }}>
            <button className="btn btn-ghost press" style={{ background: "var(--bg-2)" }} onClick={() => setSelected(null)}>Cancel</button>
            {selected!.size < filtered.length
              ? <button className="btn btn-ghost press" style={{ background: "var(--bg-2)" }} onClick={() => setSelected(new Set(filtered.map((a) => a.id)))}>All</button>
              : <button className="btn btn-ghost press" style={{ background: "var(--bg-2)" }} onClick={() => setSelected(new Set())}>None</button>}
            <button className="btn press" disabled={!selected!.size} onClick={unarchiveSelected} data-testid="unarchive-selected"
              style={{ flex: 1, background: selected!.size ? "var(--accent)" : "#8A847A", color: "var(--on-accent)", transition: "background .3s" }}>
              {selected!.size ? `Unarchive ${selected!.size}` : "Tap pieces to select"}
            </button>
          </div>
        )}
      </div>

      <PieceView layout={layout} id={detail} reloadKey={reloadKey} startEditing={editNew} fields={fields} statuses={config?.statuses || []} summaries={items || []} pending={pending}
        onClose={closePiece} onOpen={(id) => openPiece(id)} onChanged={refresh} toast={showToast}
        onAddImages={(artworkId, roleIdx) => { setUpload({ mode: "photo", artworkId, roleIdx: roleIdx < 0 ? 0 : roleIdx }); setSheet("upload"); }} />

      <FilterSheet open={sheet === "filters"} onClose={() => setSheet(null)} fields={fields} items={items || []} statuses={config?.statuses || []}
        filters={filters} onChange={(f) => { setFilters(f); setTlId(null); }} resultCount={filtered.length} bounds={bounds} />
      <UploadSheet open={sheet === "upload"} mode={upload.mode} roleIdx={upload.roleIdx} onRole={(i) => setUpload((u) => ({ ...u, roleIdx: i }))} onClose={() => setSheet(null)} onFiles={onFiles} />

      <div aria-live="polite" role="status" data-testid="toast" style={{ position: "absolute", left: "50%", bottom: tlLandscape ? `calc(${strip.height + 10}px + ${stripBottom})` : `calc(${landscape ? 76 : 96}px + var(--sab))`, zIndex: 60, transform: `translate(-50%, ${toast ? 0 : 16}px)`, opacity: toast ? 1 : 0, transition: "transform .45s cubic-bezier(.2,.9,.25,1), opacity .3s", pointerEvents: "none", display: "flex", alignItems: "center", gap: 8, height: 42, padding: "0 16px", borderRadius: 999, background: "var(--text)", color: "#12110F", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", boxShadow: "0 14px 34px rgba(0,0,0,.45)" }}>
        <ICheck />{toast}
      </div>

      {signedOut && <SignedOut />}
    </div>
  );
}
