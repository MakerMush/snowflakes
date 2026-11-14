# Flake Lab

Design a paper snowflake, watch it unfold live, then print a fold-and-cut template.
Plain HTML, CSS and JavaScript. No build step, no dependencies, no server.

Status: **phase 2 of 6** (cut checks, auto bridges, complexity score, align tools). See the roadmap below.

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

## How to use it

- Pick **4 arms** (45 degree wedge, 8 layers, easiest to cut) or **6 arms** (30 degree wedge, 12 layers).
- Click a shape in the library to drop it on the wedge. Drag it, drag a square handle to resize,
  drag the round handle to rotate (hold Shift for 15 degree steps).
- Every shape is either **Cut** (paper is removed) or **Keep** (paper stays, even over cuts).
  Whatever is painted last wins, so Keep on top of Cut makes a bridge or an island of paper.
- **Protect center** keeps a small solid hub so the arms do not fall apart at the middle.
- Keys: arrows nudge (Shift for bigger steps), K toggles cut/keep, F flips, `[` and `]` change
  stacking, Ctrl+D duplicates, Delete removes, Ctrl+Z / Ctrl+Shift+Z undo and redo.
- **Align** (bar under the canvas): **Center** moves the shape onto the middle line and sets rotation to 0.
  **Left edge** and **Right edge** swing the shape to the fold line and rotate it to that edge's angle
  (30 degrees for 6 arms, 22.5 for 4). Choose **On the fold** to center it on the fold line (the mirrored
  copy completes a symmetric shape) or **Inside** to keep it in the wedge with its side touching the fold.
  Pressing C also centers.
- The design autosaves in your browser. **Reset** clears it (and offers Undo). **Surprise me** makes a random one.

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
- `js/analyze.js` islands, thin features, cut length, complexity score, tool recommendation, auto bridges
- `js/preview.js` draws the unfolded flake as an SVG mask
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
sampler, and the analyzer (islands, thin features, score and tool, bridge repair, speed).

## Roadmap

1. Wedge editor, shape library, live preview (done)
2. Island, sliver and tiny-hole checks, auto bridges, complexity meter, align tools (done)
3. Photo upload and tracing (threshold, noise and smoothing sliders)
4. Printable template: fold guide, cut lines, scale bar, QR code, PDF
5. Geometry mode (symmetry group, angles, unfold animation, worksheet with answer key)
6. Polish: share link, text shapes, SVG export, accessibility pass
