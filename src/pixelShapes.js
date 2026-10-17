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

// A spearhead pointing along `angle`: a needle tip that widens into rounded shoulders, which sweep
// back into short points, hollowed out from behind so only the tip is solid and the sides are walls.
// shape, all in px: the shoulders are `back` ahead of (cx, cy) and `halfWidth` to each side, the tip
// `length` ahead of them, and their points `sweep` behind them. The hollow is pointed like the head,
// reaches `hollow` ahead of the shoulders, and leaves walls `wall` thick at the shoulders.
// Fills the pixels for which pick(f, rim) is true: f runs from 0 at the shoulders to 1 at the tip, and
// rim is true within `rim` px of the outer edge.
export function pixelSpearhead(g, cx, cy, angle, shape, pick) {
  const { back, length, halfWidth: w, sweep, rim } = shape;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  return fillPixels(g, cx, cy, back + length + w, (x, y) => {
    const u = (x - cx) * ux + (y - cy) * uy - back; // ahead of the shoulders
    const v = Math.abs((x - cx) * uy - (y - cy) * ux);
    if (u > length || u < -sweep || v > w || v < hollowWidth(shape, u)) return false;
    // Ahead of the shoulders a sine profile: zero width at the tip, round where it meets them.
    // Behind them, the back edge curves back to the points.
    if (u < 0) return v / w >= Math.sqrt(-u / sweep) && pick(0, true);
    const outer = w * Math.sin((Math.PI / 2) * (length - u) / length) ** 1.6;
    return v <= outer && pick(u / length, v > outer - rim);
  });
}

// Half the hollow's width at `u` px ahead of the shoulders (0 past its point).
function hollowWidth({ halfWidth, wall, hollow }, u) {
  if (u >= hollow) return 0;
  if (u <= 0) return halfWidth - wall;
  return (halfWidth - wall) * Math.sin((Math.PI / 2) * (hollow - u) / hollow) ** 1.6;
}

// Where a spearhead's back edge is `v` px off its center line: px ahead of the shoulders (negative
// behind them, out on the points). Inside the hollow that's the hollow's edge.
export function spearheadBackEdge({ halfWidth, wall, hollow, sweep }, v) {
  const inner = halfWidth - wall;
  if (v < inner) return hollow * (1 - (2 / Math.PI) * Math.asin((v / inner) ** (1 / 1.6)));
  const t = Math.min(v / halfWidth, 1);
  return -sweep * t * t;
}

// A spike from (x, y) along `angle`: `halfWidth` px each side at its base, tapering to a point `length`
// px away. Fills the pixels for which pick(f) is true, f running from 0 at the base to 1 at the point.
export function pixelSpike(g, x, y, angle, length, halfWidth, pick) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const mx = x + ux * length / 2;
  const my = y + uy * length / 2;
  return fillPixels(g, mx, my, length / 2 + halfWidth, (px, py) => {
    const f = ((px - x) * ux + (py - y) * uy) / length;
    if (f < 0 || f > 1) return false;
    return Math.abs((px - x) * uy - (py - y) * ux) <= halfWidth * (1 - f) && pick(f);
  });
}
