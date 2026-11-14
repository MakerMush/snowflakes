# Flake Lab

Design a paper snowflake, watch it unfold live, then print a fold-and-cut template.
Plain HTML, CSS and JavaScript. No build step, no dependencies, no server.

Status: **phase 1 of 6** (wedge editor, shape library, live unfolded preview). See the roadmap below.

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
- The design autosaves in your browser. **Reset** clears it (and offers Undo). **Surprise me** makes a random one.

## How it works

The folded wedge is the only thing you edit. The unfolded flake is that wedge placed `2n`
times: even copies are rotations, odd copies are mirror images (the dihedral group D_n).

- `js/geometry.js` fold math, matrices, wedge shapes, polygon helpers (pure, tested)
- `js/shapes.js` the shape library, stored as normalized polygons
- `js/sampler.js` "is there paper at this point?", using the exact same fold math as the preview
- `js/state.js` the design document, undo/redo, validation, random flakes (pure, tested)
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
rotation symmetry), the shape library, the document and undo logic, and the sampler.

## Roadmap

1. Wedge editor, shape library, live preview (done)
2. Island, sliver and tiny-hole checks, auto bridges, complexity meter
3. Photo upload and tracing (threshold, noise and smoothing sliders)
4. Printable template: fold guide, cut lines, scale bar, QR code, PDF
5. Geometry mode (symmetry group, angles, unfold animation, worksheet with answer key)
6. Polish: share link, text shapes, SVG export, accessibility pass
