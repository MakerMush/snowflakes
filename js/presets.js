/*
 * presets.js - ready-made starting layouts, modeled on classic fold-and-cut paper snowflakes.
 *
 * Each preset is a normal design (the same object list the editor uses), so after loading one
 * you can drag, resize, delete or add anything. All of them are 6-arm Build mode designs: the arm runs along the
 * left fold line of the wedge and the gap between neighbouring arms is the right fold line.
 * They are built only from the shape library and were tuned so the cut checks come back clean
 * for kid scissors (a test keeps it that way).
 */
(function (root, factory) {
  var S, ST;
  if (typeof module === 'object' && module.exports) { ST = require('./state'); }
  else { ST = root.SF.state; }
  var api = factory(ST);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.SF.presets = api; }
})(typeof self !== 'undefined' ? self : this, function (ST) {
  'use strict';

  /*
   * All presets start in Build mode: nothing is kept except the protected center, and each keep shape is paper
   * that stays, so you can see how the flake is built and keep adding to it. A few cut shapes carve holes and
   * notches back out. Positions are in wedge units (see geometry.js); the arm runs along the left fold line.
   */
  var list = [
    {
      id: 'medallion', name: 'Photo medallion', needsImage: true,
      blurb: 'Mostly built: a web frame with open windows. Add a picture in the Photo tab and it repeats in every window.',
      mode: 'build', arms: 6, hub: true, hubR: 18,
      objects: [
      { shapeId: 'circle', x: 0, y: 0, sx: 144, sy: 144, rot: 0, role: 'keep', label: 'Outer ring' },
      { shapeId: 'circle', x: 0, y: 0, sx: 132, sy: 132, rot: 0, role: 'cut', label: 'Outer ring hole' },
      { shapeId: 'circle', x: 0, y: 0, sx: 90, sy: 90, rot: 0, role: 'keep', label: 'Inner ring' },
      { shapeId: 'circle', x: 0, y: 0, sx: 72, sy: 72, rot: 0, role: 'cut', label: 'Inner ring hole' },
      { shapeId: 'capsule', x: -9.58, y: -35.74, sx: 6, sy: 66, rot: 345, role: 'keep', label: 'Spoke' },
      { shapeId: 'capsule', x: 9.58, y: -35.74, sx: 6, sy: 66, rot: 15, role: 'keep', label: 'Spoke' }
      ]
    },
    {
      id: 'feather', name: 'Feather star', blurb: 'Hollow hexagon in the middle, feathery arms. The easiest to cut.',
      mode: 'build', arms: 6, hub: false, hubR: 7,
      objects: [
      { shapeId: 'hexagon', x: 0, y: 0, sx: 70, sy: 60.6, rot: 75, role: 'keep', label: 'Center ring' },
      { shapeId: 'hexagon', x: 0, y: 0, sx: 56, sy: 48.5, rot: 75, role: 'cut', label: 'Hex hole' },
      { shapeId: 'capsule', x: -17.08, y: -63.75, sx: 6, sy: 76, rot: 345, role: 'keep', label: 'Arm' },
      { shapeId: 'capsule', x: -2.12, y: -47.37, sx: 5.6, sy: 22, rot: 40, role: 'keep', label: 'Feather' },
      { shapeId: 'capsule', x: -5.49, y: -59.93, sx: 5.6, sy: 22, rot: 40, role: 'keep', label: 'Feather' },
      { shapeId: 'capsule', x: -8.85, y: -72.49, sx: 5.6, sy: 22, rot: 40, role: 'keep', label: 'Feather' },
      { shapeId: 'capsule', x: -12.22, y: -85.05, sx: 5.6, sy: 22, rot: 40, role: 'keep', label: 'Feather' }
      ]
    },
    {
      id: 'starburst', name: 'Starburst', blurb: 'Spear-shaped arms with nibbled notches and a ray at the center.',
      mode: 'build', arms: 6, hub: true, hubR: 5,
      objects: [
      { shapeId: 'circle', x: 0, y: 0, sx: 70, sy: 70, rot: 0, role: 'keep', label: 'Center' },
      { shapeId: 'diamond', x: -16.05, y: -59.89, sx: 28, sy: 72, rot: 345, role: 'keep', label: 'Spear arm' },
      { shapeId: 'square', x: 7.38, y: -63.71, sx: 4, sy: 43.9, rot: 43, role: 'cut', label: 'Notch' },
      { shapeId: 'square', x: 8.63, y: -79.98, sx: 4, sy: 56.68, rot: 43, role: 'cut', label: 'Notch' },
      { shapeId: 'square', x: 9.88, y: -96.24, sx: 4, sy: 69.46, rot: 43, role: 'cut', label: 'Notch' },
      { shapeId: 'capsule', x: 5.69, y: -21.25, sx: 4.2, sy: 16, rot: 15, role: 'cut', label: 'Center ray' }
      ]
    },
    {
      id: 'leafy', name: 'Leaf fern', blurb: 'Leafy arms around a petal flower in the center.',
      mode: 'build', arms: 6, hub: true, hubR: 6,
      objects: [
      { shapeId: 'circle', x: 0, y: 0, sx: 58, sy: 58, rot: 0, role: 'keep', label: 'Center' },
      { shapeId: 'petal', x: 6.21, y: -23.18, sx: 9, sy: 30, rot: 15, role: 'cut', label: 'Center petal' },
      { shapeId: 'capsule', x: -16.05, y: -59.89, sx: 6.8, sy: 84, rot: 345, role: 'keep', label: 'Arm' },
      { shapeId: 'petal', x: -4.31, y: -53.4, sx: 8.5, sy: 26, rot: 33, role: 'keep', label: 'Leaf' },
      { shapeId: 'petal', x: -8.71, y: -69.82, sx: 8.5, sy: 26, rot: 33, role: 'keep', label: 'Leaf' },
      { shapeId: 'petal', x: -13.11, y: -86.24, sx: 8.5, sy: 26, rot: 33, role: 'keep', label: 'Leaf' },
      { shapeId: 'diamond', x: -22.78, y: -85, sx: 9, sy: 24, rot: 345, role: 'keep', label: 'Leaf tip' }
      ]
    },
    {
      id: 'pine', name: 'Pine fern', blurb: 'Long needles that taper toward the tips, plus a small petal center.',
      mode: 'build', arms: 6, hub: true, hubR: 6,
      objects: [
      { shapeId: 'circle', x: 0, y: 0, sx: 54, sy: 54, rot: 0, role: 'keep', label: 'Center' },
      { shapeId: 'petal', x: 4.66, y: -17.39, sx: 6, sy: 20, rot: 15, role: 'cut', label: 'Center petal' },
      { shapeId: 'capsule', x: -16.05, y: -59.89, sx: 5.2, sy: 84, rot: 345, role: 'keep', label: 'Arm' },
      { shapeId: 'capsule', x: -0.85, y: -45.4, sx: 4.8, sy: 28, rot: 29, role: 'keep', label: 'Needle' },
      { shapeId: 'capsule', x: -5.2, y: -57.61, sx: 4.8, sy: 25, rot: 29, role: 'keep', label: 'Needle' },
      { shapeId: 'capsule', x: -9.8, y: -69.38, sx: 4.8, sy: 21, rot: 29, role: 'keep', label: 'Needle' },
      { shapeId: 'capsule', x: -14.39, y: -81.16, sx: 4.8, sy: 17, rot: 29, role: 'keep', label: 'Needle' }
      ]
    }
  ];

  function get(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** A full design document for a preset (validated by the same sanitizer the editor uses). */
  function toDoc(preset) {
    var p = typeof preset === 'string' ? get(preset) : preset;
    if (!p) return null;
    return ST.sanitize({
      mode: p.mode || 'build', arms: p.arms, hub: p.hub, hubR: p.hubR,
      objects: p.objects.map(function (o, i) {
        return { id: 'o' + (i + 1), type: 'shape', shapeId: o.shapeId, x: o.x, y: o.y, sx: o.sx, sy: o.sy,
          rot: o.rot, flip: false, role: o.role, label: o.label };
      })
    });
  }

  return { list: list, get: get, toDoc: toDoc };
});
