"""
End-to-end tests in a real Chromium at phone size (390x844, touch, 2x DPR)
against a freshly seeded `wrangler dev` (see tests/run-e2e.sh).
Every step saves a screenshot to tests/shots/ as evidence.
"""
import os, re, sys, io, struct, zlib
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("E2E_BASE", "http://localhost:8791")
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)
results = []

def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

def step(name):
    def wrap(fn):
        def run(page):
            try:
                fn(page)
                results.append((name, "PASS", ""))
                print(f"PASS  {name}")
            except Exception as e:
                results.append((name, "FAIL", str(e).splitlines()[0][:300]))
                print(f"FAIL  {name}\n      {e}")
            finally:
                safe = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60]
                page.screenshot(path=os.path.join(SHOTS, f"{len(results):02d}-{safe}.png"))
        run.__name__ = name
        return run
    return wrap

def count_label(page): return page.get_by_test_id("count-label").inner_text()
def hero_title(page): return page.get_by_test_id("hero-title").inner_text()

def drag(page, locator, dx, dy=0, steps=12):
    b = locator.bounding_box()
    x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    page.mouse.move(x, y); page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(x + dx * i / steps, y + dy * i / steps)
        page.wait_for_timeout(16)
    page.mouse.up()

@step("timeline loads with the latest piece and 14 works")
def t_load(page):
    page.goto(BASE + "/", wait_until="networkidle")
    expect(page.get_by_test_id("timeline")).to_be_visible()
    expect(page.get_by_test_id("count-label")).to_have_text("14 WORKS")
    expect(page.get_by_test_id("hero-title")).to_contain_text("Prismatic Sunset at Soda Lake")
    page.wait_for_timeout(600)

@step("scrubbing the strip moves back through the years")
def t_scrub(page):
    strip = page.get_by_test_id("strip")
    before = int(strip.get_attribute("aria-valuenow"))
    drag(page, strip, 240)
    page.wait_for_timeout(700)
    after = int(strip.get_attribute("aria-valuenow"))
    assert after <= before - 2, f"expected to move back at least 2, {before} -> {after}"
    assert "Prismatic" not in hero_title(page)

@step("tapping a decade jumps to it")
def t_decade(page):
    page.get_by_role("navigation", name="Jump to decade").get_by_role("button", name="'90s").click()
    page.wait_for_timeout(700)
    expect(page.get_by_test_id("hero-title")).to_contain_text("John Day River")
    expect(page.get_by_test_id("hero-title")).to_contain_text("1993")

@step("swiping the hero goes to the next piece; arrow keys work on the strip")
def t_swipe(page):
    drag(page, page.get_by_test_id("hero"), -140)
    page.wait_for_timeout(700)
    expect(page.get_by_test_id("hero-title")).to_contain_text("Templeton Feed Grain")
    page.get_by_test_id("strip").focus()
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(600)
    expect(page.get_by_test_id("hero-title")).to_contain_text("Adelaida Hilltop View")

@step("wall view shows every work grouped by decade and the rail jumps")
def t_wall(page):
    page.get_by_role("tab", name="Wall").click()
    expect(page.get_by_test_id("wall")).to_be_visible()
    page.wait_for_timeout(700)
    expect(page.get_by_test_id("wall-tile")).to_have_count(14)
    wall = page.get_by_test_id("wall")
    page.get_by_role("button", name="Jump to 1980s").click()
    page.wait_for_timeout(900)
    assert wall.evaluate("e => e.scrollTop") > 400, "rail jump did not scroll"
    expect(page.locator("[data-dec='1980'] h3")).to_be_in_viewport()

@step("search expands in the row, suggests, and finds by meaning")
def t_search(page):
    page.get_by_role("button", name="Search the archive").click()
    page.wait_for_timeout(500)
    expect(page.get_by_role("tab", name="Wall")).to_be_hidden()  # toggle folded
    expect(page.get_by_role("dialog", name="Search suggestions")).to_be_visible()
    page.get_by_role("button", name="warm sunsets over water").click()
    expect(page.get_by_test_id("count-label")).to_have_text(re.compile(r"\d+ CLOSE MATCH"), timeout=5000)
    page.wait_for_timeout(700)
    first = page.get_by_test_id("wall-tile").first.get_attribute("aria-label")
    assert re.search(r"Sunset|Soda Lake", first), f"top result was {first}"
    expect(page.get_by_text("Best matches")).to_be_visible()

@step("the folded view toggle still switches views while searching")
def t_flip(page):
    page.get_by_role("button", name="Switch to Timeline view").click()
    page.wait_for_timeout(700)
    expect(page.get_by_test_id("timeline")).to_be_visible()
    expect(page.locator("text=/\\d+% match/")).to_be_visible()

@step("closing search restores everything")
def t_close_search(page):
    page.get_by_role("button", name="Clear and close search").click()
    page.wait_for_timeout(700)
    expect(page.get_by_test_id("count-label")).to_have_text("14 WORKS")
    expect(page.get_by_role("tab", name="Timeline")).to_be_visible()

@step("filters: medium + where-it-is narrow results live with chips")
def t_filters(page):
    page.get_by_role("button", name=re.compile(r"^Filters")).click()
    sheet = page.get_by_test_id("filter-sheet")
    expect(sheet).to_be_visible()
    page.wait_for_timeout(400)
    sheet.get_by_role("button", name=re.compile(r"^Pastel")).click()
    expect(page.get_by_test_id("show-results")).to_have_text("Show 4 works")
    sheet.get_by_role("button", name=re.compile(r"^In studio")).click()
    expect(page.get_by_test_id("show-results")).to_have_text("Show 2 works")
    page.get_by_test_id("show-results").click()
    page.wait_for_timeout(600)
    expect(page.get_by_test_id("count-label")).to_have_text("2 OF 14 WORKS")
    expect(page.get_by_role("button", name="Remove filter Pastel")).to_be_visible()
    expect(page.get_by_role("button", name="Filters, 2 active")).to_be_visible()

@step("removing a chip and colour + year filters work")
def t_filters2(page):
    page.get_by_role("button", name="Remove filter Pastel").click()
    page.get_by_role("button", name="Remove filter In studio").click()
    expect(page.get_by_test_id("count-label")).to_have_text("14 WORKS")
    page.get_by_role("button", name=re.compile(r"^Filters")).click()
    sheet = page.get_by_test_id("filter-sheet")
    page.wait_for_timeout(400)
    sheet.get_by_role("button", name="Purple").click()
    n_purple = int(re.search(r"\d+", page.get_by_test_id("show-results").inner_text()).group())
    assert 1 <= n_purple < 14, f"purple matched {n_purple}"
    sheet.get_by_role("button", name="Purple").click()
    sheet.get_by_role("button", name=re.compile(r"^Private collection")).click()
    expect(page.get_by_test_id("show-results")).to_have_text("Show 3 works")
    sheet.get_by_role("button", name=re.compile(r"^Private collection")).click()
    frm = page.get_by_test_id("year-from")
    frm.focus()
    for _ in range(30): page.keyboard.press("ArrowRight")  # 1970 -> 2000
    expect(page.get_by_test_id("year-label")).to_contain_text("2000 –")
    expect(page.get_by_test_id("show-results")).to_have_text("Show 10 works")
    sheet.get_by_role("button", name="Reset").click()
    expect(page.get_by_test_id("show-results")).to_have_text("Show 14 works")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    expect(sheet).to_be_hidden()

@step("opening a piece shows its images, kinds and journey")
def t_piece(page):
    page.get_by_role("tab", name="Wall").click()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Open Prismatic Sunset at Soda Lake").click()
    piece = page.get_by_test_id("piece")
    page.wait_for_timeout(800)
    expect(piece.get_by_role("heading", name="Prismatic Sunset at Soda Lake")).to_be_visible()
    expect(piece.get_by_text("1 / 8 IMAGES")).to_be_visible()
    expect(piece.get_by_role("tab", name=re.compile(r"Studies 2"))).to_be_visible()
    expect(piece.get_by_test_id("journey").get_by_role("button", name=re.compile(r"^Step"))).to_have_count(6)
    assert "#/piece/" in page.url

@step("swiping the carousel and filtering by image kind")
def t_carousel(page):
    piece = page.get_by_test_id("piece")
    drag(page, piece.get_by_test_id("carousel"), -160)
    page.wait_for_timeout(700)
    expect(piece.get_by_text("2 / 8 IMAGES")).to_be_visible()
    piece.get_by_role("tab", name=re.compile(r"Studies")).click()
    page.wait_for_timeout(500)
    expect(piece.get_by_text("1 / 2 STUDIES")).to_be_visible()
    expect(piece.get_by_role("img", name=re.compile(r"STUDY · Thumbnail sketch"))).to_be_visible()

@step("tapping a journey step shows that image")
def t_journey(page):
    piece = page.get_by_test_id("piece")
    piece.get_by_role("button", name=re.compile(r"Step 1, Reference")).click()
    page.wait_for_timeout(800)
    expect(piece.get_by_role("tab", name=re.compile(r"^All"))).to_have_attribute("aria-selected", "true")
    expect(piece.get_by_text(re.compile(r"/ 8 IMAGES"))).to_be_visible()
    lbl = piece.get_by_text(re.compile(r"^\d / 8 IMAGES$")).inner_text()
    assert lbl.startswith("8 /"), lbl

@step("image options: make main image and re-label")
def t_image_menu(page):
    piece = page.get_by_test_id("piece")
    piece.get_by_test_id("image-menu").click()
    opts = page.get_by_test_id("image-options")
    expect(opts).to_be_visible()
    opts.get_by_role("button", name="Make this the main image").click()
    expect(page.get_by_test_id("toast")).to_contain_text("Main image updated")
    page.wait_for_timeout(400)
    piece.get_by_test_id("image-menu").click()
    page.get_by_test_id("image-options").get_by_role("button", name="Rename label").click()
    page.get_by_label("Image label").fill("Site photo, March")
    page.get_by_label("Image label").press("Enter")
    expect(page.get_by_test_id("toast")).to_contain_text("Label updated")
    expect(piece.get_by_role("img", name="REFERENCE · Site photo, March")).to_be_visible()

@step("editing: validation, then save several fields")
def t_edit(page):
    piece = page.get_by_test_id("piece")
    piece.get_by_test_id("edit-toggle").click()
    expect(piece.get_by_test_id("edit-form")).to_be_visible()
    piece.get_by_label("Year", exact=True).fill("abc")
    piece.get_by_test_id("save").click()
    expect(piece.get_by_text("Enter a year like 1987")).to_be_visible()
    piece.get_by_label("Year", exact=True).fill("2024")
    piece.get_by_label("Title").fill("Prismatic Sunset at Soda Lake (studio copy)")
    form = piece.get_by_test_id("edit-form")
    form.get_by_role("button", name="On show").click()
    form.get_by_role("group", name="Subjects").get_by_role("button", name="Flowers").click()
    form.get_by_role("radiogroup", name="Series").get_by_role("button", name="New").click()
    page.get_by_label("New Series").fill("Carrizo Light")
    page.get_by_label("New Series").press("Enter")
    piece.get_by_label("Story & notes").fill("Finished the week the plains bloomed.")
    expect(piece.get_by_test_id("save")).to_have_text("Save 5 changes")
    piece.get_by_test_id("save").click()
    expect(page.get_by_test_id("toast")).to_contain_text("Saved 5 changes")
    expect(piece.get_by_role("heading", name="Prismatic Sunset at Soda Lake (studio copy)")).to_be_visible()
    facts = piece.get_by_test_id("facts")
    expect(facts).to_contain_text("On show")
    expect(facts).to_contain_text("Landscape, Water, Flowers")
    expect(facts).to_contain_text("Carrizo Light")

@step("edits persist across a reload via the deep link")
def t_persist(page):
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(800)
    piece = page.get_by_test_id("piece")
    expect(piece.get_by_role("heading", name="Prismatic Sunset at Soda Lake (studio copy)")).to_be_visible()
    expect(piece.get_by_test_id("facts")).to_contain_text("Finished the week the plains bloomed.")
    expect(piece.get_by_text("REFERENCE · Site photo, March").first).to_be_attached()

@step("uploading a study from the phone shows progress and adds it")
def t_upload(page, tmp=os.path.join(SHOTS, "_study.png")):
    open(tmp, "wb").write(png(640, 480, (110, 90, 160)))
    piece = page.get_by_test_id("piece")
    piece.get_by_test_id("add-step").scroll_into_view_if_needed()
    piece.get_by_test_id("add-step").click()
    sheet = page.get_by_test_id("upload-sheet")
    expect(sheet).to_be_visible()
    expect(sheet.get_by_role("radio", name="Study")).to_have_attribute("aria-checked", "true")
    page.get_by_test_id("input-photos").set_input_files(tmp)
    expect(page.get_by_test_id("toast")).to_contain_text("uploaded", timeout=15000)
    page.wait_for_timeout(800)
    expect(piece.get_by_text(re.compile(r"/ 9 IMAGES"))).to_be_visible()
    expect(piece.get_by_role("tab", name=re.compile(r"Studies 3"))).to_be_visible()

@step("a file that isn't a photo is refused with a clear message")
def t_bad_upload(page, tmp=os.path.join(SHOTS, "_not-a-photo.jpg")):
    open(tmp, "w").write("this is a text file pretending to be a jpeg")
    piece = page.get_by_test_id("piece")
    piece.get_by_test_id("add-step").click()
    page.get_by_test_id("input-files").set_input_files(tmp)
    expect(piece.get_by_text("doesn't look like a photo")).to_be_in_viewport(timeout=10000)
    expect(page.get_by_test_id("toast")).to_contain_text("couldn't be added")
    page.wait_for_timeout(5500)
    expect(piece.get_by_text("doesn't look like a photo")).to_have_count(0)
    expect(piece.get_by_text("9 / 9 IMAGES")).to_be_visible()

@step("more like this navigates to a similar piece; back returns to browsing")
def t_similar(page):
    piece = page.get_by_test_id("piece")
    sim = piece.get_by_test_id("similar")
    sim.scroll_into_view_if_needed()
    expect(sim.get_by_role("button")).not_to_have_count(0)
    first = sim.get_by_role("button").first
    title = re.sub(r", \d+% similar$", "", first.get_attribute("aria-label").replace("Open ", ""))
    first.click()
    page.wait_for_timeout(900)
    expect(piece.get_by_role("heading", name=title)).to_be_visible()
    piece.get_by_test_id("back").click()
    page.wait_for_timeout(800)
    assert "#/piece/" not in page.url
    expect(page.get_by_test_id("wall")).to_be_visible()

@step("adding a new work from a photo opens it ready to fill in")
def t_new(page, tmp=os.path.join(SHOTS, "_new.png")):
    open(tmp, "wb").write(png(900, 700, (230, 140, 70)))
    page.get_by_test_id("add-work").click()
    expect(page.get_by_test_id("upload-sheet")).to_be_visible()
    page.get_by_test_id("input-camera").set_input_files(tmp)
    piece = page.get_by_test_id("piece")
    expect(piece.get_by_test_id("edit-form")).to_be_visible(timeout=10000)
    expect(page.get_by_test_id("toast")).to_contain_text("uploaded", timeout=15000)
    piece.get_by_label("Title").fill("Morning at Dip Creek")
    piece.get_by_label("Year", exact=True).fill("2026")
    piece.get_by_test_id("edit-form").get_by_role("radiogroup", name="Medium").get_by_role("button", name="Oil").click()
    piece.get_by_test_id("save").click()
    expect(page.get_by_test_id("toast")).to_contain_text("Saved")
    expect(piece.get_by_role("heading", name="Morning at Dip Creek")).to_be_visible()
    expect(piece.get_by_text("1 / 1 IMAGES")).to_be_visible()
    piece.get_by_test_id("back").click()
    page.wait_for_timeout(800)
    expect(page.get_by_test_id("count-label")).to_have_text("15 WORKS")
    expect(page.get_by_role("button", name="Open Morning at Dip Creek")).to_be_visible()

@step("removing a work asks first and then takes it out of the archive")
def t_remove(page):
    page.get_by_role("button", name="Open Morning at Dip Creek").click()
    piece = page.get_by_test_id("piece")
    page.wait_for_timeout(700)
    piece.get_by_test_id("edit-toggle").click()
    piece.get_by_role("button", name="Remove from archive").click()
    piece.get_by_test_id("confirm-remove").click()
    expect(page.get_by_test_id("toast")).to_contain_text("Removed from the archive")
    page.wait_for_timeout(800)
    expect(page.get_by_test_id("count-label")).to_have_text("14 WORKS")

@step("no matches shows a friendly empty state with a way out")
def t_empty(page):
    page.get_by_role("button", name="Search the archive").click()
    page.keyboard.type("qqqzzxx")
    expect(page.get_by_test_id("no-matches")).to_be_visible(timeout=5000)
    page.get_by_role("button", name="Clear search & filters").click()
    expect(page.get_by_test_id("count-label")).to_have_text("14 WORKS")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True,
                                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and not re.search(r"status of 4\d\d", m.text) else None)
        page.on("response", lambda r: errors.append(f"HTTP {r.status} {r.url}") if r.status >= 500 else None)
        for t in [t_load, t_scrub, t_decade, t_swipe, t_wall, t_search, t_flip, t_close_search, t_filters, t_filters2,
                  t_piece, t_carousel, t_journey, t_image_menu, t_edit, t_persist, t_upload, t_bad_upload, t_similar, t_new, t_remove, t_empty]:
            t(page)
        browser.close()
    print("\nconsole/page errors:", errors or "none")
    failed = [r for r in results if r[1] == "FAIL"]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed or errors: sys.exit(1)

if __name__ == "__main__":
    main()
