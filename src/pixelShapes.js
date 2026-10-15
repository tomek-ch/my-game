import { ART_SCALE } from './art.js';

// Shapes drawn in whole art pixels on the same grid as the sprites, so slashes and telegraphs match
// the pixel art instead of being smooth vector shapes. Set the fill style on the graphics first.
// Coordinates are in world pixels.

const TAU = Math.PI * 2;

// Fills every art pixel within `reach` of (cx, cy) whose center passes inside(x, y).
// Pixels are drawn as horizontal runs, so cost is one test per pixel and one rect per run.
export function fillPixels(g, cx, cy, reach, inside) {
  const s = ART_SCALE;
  const x0 = Math.floor((cx - reach) / s);
  const x1 = Math.ceil((cx + reach) / s);
  const y0 = Math.floor((cy - reach) / s);
  const y1 = Math.ceil((cy + reach) / s);
  for (let py = y0; py < y1; py++) {
    const wy = (py + 0.5) * s;
    let runStart = null;
    for (let px = x0; px <= x1; px++) {
      const isIn = px < x1 && inside((px + 0.5) * s, wy);
      if (isIn && runStart === null) {
        runStart = px;
      } else if (!isIn && runStart !== null) {
        g.fillRect(runStart * s, py * s, (px - runStart) * s, s);
        runStart = null;
      }
    }
  }
  return g;
}

export function pixelDisk(g, cx, cy, radius) {
  const r2 = radius * radius;
  return fillPixels(g, cx, cy, radius, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r2);
}

// A ring (or a disk segment) between two radii, limited to the angles from `from` across `span`
// radians. A negative span goes counterclockwise. Spans of a full turn or more cover the whole ring.
export function pixelSector(g, cx, cy, inner, outer, from = 0, span = TAU) {
  const in2 = inner * inner;
  const out2 = outer * outer;
  const dir = Math.sign(span) || 1;
  const width = Math.abs(span);
  return fillPixels(g, cx, cy, outer, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > out2 || d2 < in2) return false;
    if (width >= TAU) return true;
    const rel = ((((Math.atan2(dy, dx) - from) * dir) % TAU) + TAU) % TAU;
    return rel <= width;
  });
}

// A straight band `width` px wide from (x1, y1) to (x2, y2).
export function pixelLine(g, x1, y1, x2, y2, width) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const half = width / 2;
  return fillPixels(g, (x1 + x2) / 2, (y1 + y2) / 2, len / 2 + half, (x, y) => {
    const along = (x - x1) * ux + (y - y1) * uy;
    const across = Math.abs((x - x1) * uy - (y - y1) * ux);
    return along >= 0 && along <= len && across <= half;
  });
}
