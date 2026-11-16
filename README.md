# Flake Lab

Design a paper snowflake, watch it unfold live, then print a fold-and-cut template.
Plain HTML, CSS and JavaScript. No build step, no dependencies, no server.

Status: **phase 5 of 6** (geometry mode with worksheet and answer key, printable template and PDF, multi-select and groups, photo tracing, cut checks, auto bridges, complexity score, align tools, five presets, Build mode). See the roadmap below.

## Run it

Open `index.html` in a browser. That is all. (Or run `python3 -m http.server` in this folder
and visit http://localhost:8000.)

## Put it on GitHub Pages

1. Create a repo named `snowflakes` under your account and push this folder to it (the files
   should sit at the top of the repo, next to `index.html`).
2. Repo Settings, then Pages, then set the source to the `main` branch, folder `/ (root)`.
3. The site appears at `https://makermush.github.io/snowflakes/`.

That address is also what the printed QR code will point to. If the address changes, edit
`siteUrl` in `js/config.js`.

**Tip jar.** Set `tipUrl` in `js/config.js` to your Ko-fi page (for example `'https://ko-fi.com/yourname'`).
A "Support Flake Lab" link then appears in the **More** menu and a short tip line in the Print dialog. Leave it
empty to hide both. Kid mode never shows a tip link, and printed sheets never carry one.

**Offline.** After one visit over https, the app opens with no internet (`sw.js` keeps a copy). It always
fetches the newest version when online. If you add a script or stylesheet, add it to `FILES` in `sw.js`
(a test fails if you forget).

## How to use it

- First visit shows a short **welcome** (three steps). **More**, then **How it works** shows it again.
- The **arms and mode** button at the top left (for example "6 arms · Cut mode") opens the setup.
  Pick **4 arms** (45 degree wedge, 8 layers, easiest to cut) or **6 arms** (30 degree wedge, 12 layers).
- Click a shape in the library to drop it on the wedge. Drag it, drag a square handle to resize,
  drag the round handle to rotate (hold Shift for 15 degree steps).
- **Cut mode / Build mode** (same setup button). Cut mode is the classic: a full sheet of paper, and shapes are cut out of it.
  Build mode flips it: the wedge starts with nothing kept (only the protected center is paper) and every shape you
  add is paper that stays, so you build the flake outward. Anything that is not connected to the center falls out,
  so use **Add bridges** (or draw a shape that touches the center). A Cut shape in Build mode carves a hole back
  out of paper you have already added. Switching modes starts a fresh wedge (a toast offers Undo), and
  **Surprise me** in Build mode links its random shapes together for you.
- **Photo** tab: choose, drop or paste a picture (or try the sample) and it is traced into a shape right in your
  browser; nothing is uploaded. Sliders: **Threshold** (what counts as dark; Auto picks it for you), **Noise
  cleanup** (removes specks and pin holes), **Smoothing** (rounds the outline) and **Detail** (how many points
  follow the picture). Tick "Trace the light parts instead" for a light subject on a dark background. **Result**
  shows the shape that will be added; **Photo** shows the outline over your picture. **Add to wedge** drops it
  in like any other shape (Cut in Cut mode, Keep in Build mode), then the cut checks tell you whether it can
  really be cut. Dark subjects on plain backgrounds work best; big busy photos usually need more noise cleanup.
- **Several shapes at once.** Shift-click (or Ctrl/Cmd-click) adds or removes a shape from the selection. Drag on empty
  paper to draw a selection box (hold Shift to add to what is selected). Ctrl+A or **Select all** picks everything. A
  selection shows one box: drag inside it to move everything, drag a corner to resize (proportions are kept), drag the
  round handle to rotate (Shift snaps to 15 degrees). Arrow keys, Cut/Keep, Flip (mirrors the whole set about its middle),
  Duplicate, stacking order, Center and Delete all work on the whole selection, each as one undo step.
- **Group / Ungroup** (buttons in the selection bar, or Ctrl+G and Ctrl+Shift+G). A group is selected, moved, resized and
  rotated as one, and shows a chip like G1 in the layers list. Duplicating a group makes a new group. Ungroup, then click
  a single shape, to work on one piece. Groups are saved with the design.
- **Print template** (top bar, or Ctrl+P). A preview shows US Letter pages: the 7.5 inch paper disc with numbered fold
  lines (1, then 2, then 3), the cut lines drawn from the same raster the checks use, gray shading for paper that gets
  cut away, a 1 inch scale bar, the difficulty and best tool, and a QR code that points at `siteUrl` in `js/config.js`.
  Options: a second page with a step by step fold guide and cutting tips, the shading, and a Name line. **Print** uses
  the browser's print window (choose Actual size or 100%, not Fit to page); **Download PDF** saves a real vector PDF
  with selectable text. A warning appears if the design has loose pieces or details too fine for the chosen tool, and
  an empty design is not printed. The PDF and QR code are written by small modules in this folder, no libraries.
- Every shape is either **Cut** (paper is removed) or **Keep** (paper stays, even over cuts).
  Whatever is painted last wins, so Keep on top of Cut makes a bridge or an island of paper.
- **Protect center** (in the **More** menu) keeps a small solid hub so the arms do not fall apart at the middle.
- Keys: Ctrl+A selects all, Ctrl+G groups, Ctrl+Shift+G ungroups, Esc deselects, arrows nudge (Shift for bigger steps), K toggles cut/keep, F flips, `[` and `]` change
  stacking, Ctrl+D duplicates, Delete removes, Ctrl+Z / Ctrl+Shift+Z undo and redo.
- **Align** (button in the selection bar): **Center** moves the shape onto the middle line and sets rotation to 0.
  **Left edge** and **Right edge** swing the shape to the fold line and rotate it to that edge's angle
  (30 degrees for 6 arms, 22.5 for 4). Choose **On the fold** to center it on the fold line (the mirrored
  copy completes a symmetric shape) or **Inside** to keep it in the wedge with its side touching the fold.
  Pressing C also centers.
- **Presets** tab (left panel): five ready-made starting points, and every one **starts in Build mode** (the wedge is
  built from Keep shapes, with a few Cut shapes for holes and notches), so you can see how it is made and keep adding.
  **Photo medallion** is the "mostly done" one: a web frame with open windows. Loading it jumps to the Photo tab; add a
  picture (a pet, a logo, initials, the sample tree) and it repeats in all twelve windows. Drag or resize the picture until it
  touches the frame; anything that does not touch falls out, and the cut checks say so. The others are Feather star,
  Starburst, Leaf fern and Pine fern. Picking one replaces the wedge (a toast offers Undo) and switches to 6 arms. They are
  ordinary designs made only from library shapes, so you can keep editing.
- The design autosaves in your browser. **Clear the wedge** (in the **More** menu) clears it (and offers Undo). **Surprise me** makes a random one.

## Your name on the template

In the Print template dialog, with **Name line** on, you can type a name to print. It appears big and bold
at the top of every page in place of the blank line, and names the PDF file. Leave it blank for a line to
write on.

## Kid mode

Add `?kids` to the address (for example `index.html?kids`) for a first-grade version on tablets.
It locks the design to 4 arms, Cut mode and kid scissors, and hides the advanced controls (Build mode,
6 arms, Geometry mode, Photo/Presets, Reset, align and hub bars, grouping and layer order, Cut/Keep, the
layers list), and swaps the complexity and cut-check cards for one plain status line with a **Fix it** button. Shape tiles and buttons are bigger, shapes cannot shrink below about 11 mm, and kid scissors
flag anything under about 6 mm. The last step is **Save my PDF** (there are no print options): it adds
bridges first, warns in big text when a hole sits in the middle and needs a grown-up to poke it through,
and asks the student to type their name. Saving stays off until a name is entered; the name is printed
big on every page, stored in the PDF's author and title, and used for the file name
(`flake-lab-maya-lee-snowflake.pdf`). Kid mode saves its design separately (`flakelab.v1.kids`),
so it never overwrites a design made in the full app. Leave off `?kids` (or use `?kids=0`) for the full app.

## Geometry mode (phase 5)

The **Geometry mode** button in the top bar opens a dialog that works on whatever is on your wedge right now.
The numbers for the snowflake (arms, layers, wedge angle, mirror lines, smallest turn, symmetry group) sit under the picture.

- **Unfold**: Play, Next, Back or the slider open the wedge one sector at a time. Each new sector swings over the fold line it
  shares with its neighbor, so you can see that every fold line is a mirror. The caption counts the wedges and degrees.
  "Show the mirror lines" draws the n lines. The last frame is the same picture as the regular preview.
- **Symmetry**: **Turn** rotates the whole flake with a slider (or jumps to the next match). The flake lands on itself
  every 360/n degrees and the caption says when it does. **Flip** swings the flake over any of the n mirror lines. A blue
  flag on the rim shows where things moved. Animations are skipped when the computer asks for reduced motion.
- **Worksheet**: a two page student worksheet built around the student's own snowflake, plus an answer key (the same pages
  with the answers in blue, and a teacher notes page). Questions cover layers, wedge angle, creases and mirror lines, turns,
  counting symmetries (D4 or D6), counting holes made by a cutout in the wedge, a notch on a fold, following a point through
  all 2n sectors, and a prediction table for other arm counts. Everything is computed from the arm count and the design, so
  the key always matches. Download either as a PDF. Names and dates lines can be turned off.

## Checks and complexity (phase 2)

The design is rasterized at full-disc size using the same fold math as the preview, then analyzed:

- **Islands**: paper that would fall out (including a stranded center, or a flake that splits into
  separate pieces). Shown in coral on the canvas and preview. **Add bridges** links each island to the
  main paper with the shortest keep-bar(s) (one undo removes them all); **Remove bridges** deletes them.
- **Too thin**: paper bridges or tips, and cutouts, narrower than the chosen tool can handle.
  Pick **Kid scissors**, **Sharp scissors** or **Craft knife** under Cut checks. Thin paper is striped
  one way, thin cuts the other. Details finer than about 0.8 mm cannot be seen by the checker at all.
- **Complexity**: a 1 to 10 score (cut length, number of cutouts and notches, 12 layers versus 8, fine
  detail) with a plain label and a **recommended tool**. Designs with interior cutouts need at least a
  point to poke through, and details too fine for a knife are called out.

## How it works

The folded wedge is the only thing you edit. The unfolded flake is that wedge placed `2n`
times: even copies are rotations, odd copies are mirror images (the dihedral group D_n).

- `js/geometry.js` fold math, matrices, wedge shapes, polygon helpers (pure, tested)
- `js/shapes.js` the shape library, stored as normalized polygons
- `js/sampler.js` "is there paper at this point?", using the exact same fold math as the preview
- `js/state.js` the design document, undo/redo, validation, random flakes (pure, tested)
- `js/trace.js` photo tracing: threshold, cleanup, outline following, smoothing, simplification (pure, tested)
- `js/photo.js` the Photo tab: loading, live sliders, preview, adding the outline to the wedge
- `js/presets.js` the five preset layouts (plain data, loaded through the same sanitizer as saved designs)
- `js/analyze.js` islands, thin features, cut length, complexity score, tool recommendation, auto bridges
- `js/preview.js` draws the unfolded flake as an SVG mask, and as separate swinging sectors for geometry mode
- `js/worksheet.js` the symmetry worksheet and answer key as draw lists (same format and PDF writer as the print template)
- `js/geolab.js` the Geometry mode dialog: unfold animation, turn and flip demos, worksheet preview and download
- `js/editor.js` the wedge canvas: selection, drag, resize, rotate, keyboard
- `js/app.js` wires the page together; `js/config.js` holds the site address

The preview and the checks in later phases both come from the same model, so they cannot disagree.
A browser test renders the preview and compares thousands of sample points against the sampler.

## Tests

```
node --test tests/*.test.js
```

Needs Node 20 or newer. The tests cover the fold math (every point's 12 images, mirror and
rotation symmetry), the shape library, the document and undo logic (including align and bridges), the
sampler, the analyzer (islands, thin features, score and tool, bridge repair, speed), the presets (each
must load cleanly and come back cuttable with kid scissors), multi-select and groups (including move, scale and
rotate of a selection), the QR encoder (Reed-Solomon and format bits against published values, plus a decode check when
Python with OpenCV is installed), the PDF writer (valid cross-reference table, escaping, metrics) and the print layout
(true scale, margins, QR content, text safety), and geometry mode (the flap matrices land on the real unfold,
mirror lines, the point-following angles checked against the matrices, and the worksheet and key text, margins and PDFs).

## Safety notes

- Everything runs in the browser. There are no network requests, no third-party scripts and no tracking, and photos
  never leave the device.
- Names and labels are treated as text, never markup, when a design is loaded or drawn, and the page ships with a
  Content-Security-Policy that blocks inline scripts and network connections. A loaded design is also capped in size.
- The QR code on printed sheets points at `siteUrl`. Printed sheets outlive hosting, so before printing at scale put the
  site on an address you will keep (a custom domain is safest) and update `siteUrl`.

## Roadmap

1. Wedge editor, shape library, live preview (done)
2. Island, sliver and tiny-hole checks, auto bridges, complexity meter, align tools (done)
3. Photo upload and tracing (threshold, noise and smoothing sliders) (done)
4. Printable template: fold guide, cut lines, scale bar, QR code, PDF; multi-select and groups (done)
5. Geometry mode: symmetry group, angles, unfold animation, worksheet with answer key (done)
6. Polish: share link, text shapes, SVG export, accessibility pass
