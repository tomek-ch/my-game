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

// One strand of a swoosh pointing along `angle`. It starts at a needle point `tipAhead` px ahead of
// (cx, cy), curves out like the side of a spearhead until, `length` px behind the point, it's `offset`
// px off the center line (negative for the other side), then trails `tail` px further back, spreading
// out by `flare` of its offset on the way. It's `halfWidth` px each side at its thickest, thinning to
// nothing at both ends. Fills the pixels for which pick(t) is true, t from 0 at the point to 1 at the
// end of the tail.
export function pixelStrand(g, cx, cy, angle, { tipAhead, length, offset, tail, flare, halfWidth }, pick) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const total = length + tail;
  const spread = Math.abs(offset) * (1 + flare);
  const mid = tipAhead - total / 2;
  return fillPixels(g, cx + ux * mid, cy + uy * mid, total / 2 + spread + halfWidth, (x, y) => {
    const s = tipAhead - ((x - cx) * ux + (y - cy) * uy); // how far behind the point
    if (s < 0 || s > total) return false;
    const across = (x - cx) * -uy + (y - cy) * ux;
    const center = s < length
      ? offset * Math.sin((Math.PI / 2) * s / length) ** 1.6
      : offset * (1 + flare * (s - length) / tail);
    const t = s / total;
    const half = halfWidth * Math.min(1, 0.25 + s / 12) * (1 - t) ** 0.7;
    return Math.abs(across - center) <= half && pick(t);
  });
}
