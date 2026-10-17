// A compact form of a Phaser Graphics command buffer for sending, mostly for the pixel shapes (see
// pixelShapes.js), which draw a fillRect per row of pixels: thousands of numbers for a big telegraph.
//
// The buffer is opcode, args, opcode, args... A run of fillRects with whole-number args becomes one
// string: each rect as the change in x, y, width and height from the rect two before (from 0 for the
// first two), as variable-length numbers in a URL-safe base-64 alphabet. Two back rather than one
// because a ring or a hollow shape draws two rects a row, left and right: two back is the same side a
// row up, and for a solid shape it's two rows up, close either way. Most rects take 4 to 5 characters
// instead of the ~17 of plain JSON. Every other number stays a number, rounded to 3 decimals.

const FILL_RECT = 3;
// How many args follow each opcode (see Phaser's Graphics and its renderers).
const ARG_COUNTS = {
  0: 7, // ARC
  1: 0, // BEGIN_PATH
  2: 0, // CLOSE_PATH
  3: 4, // FILL_RECT
  4: 2, // LINE_TO
  5: 2, // MOVE_TO
  6: 3, // LINE_STYLE
  7: 2, // FILL_STYLE
  8: 0, // FILL_PATH
  9: 0, // STROKE_PATH
  10: 6, // FILL_TRIANGLE
  11: 6, // STROKE_TRIANGLE
  14: 0, // SAVE
  15: 0, // RESTORE
  16: 2, // TRANSLATE
  17: 2, // SCALE
  18: 1, // ROTATE
  21: 8, // GRADIENT_FILL_STYLE
  22: 6, // GRADIENT_LINE_STYLE
};

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUES = Object.fromEntries([...DIGITS].map((c, i) => [c, i]));
const MORE = 32; // a digit's top bit: another digit follows; the low 5 bits are data

const round = (v) => Math.round(v * 1000) / 1000;

// An integer as digits: zigzag (0, -1, 1, -2... to 0, 1, 2, 3...) so small negatives stay short.
function writeInt(n) {
  let z = n >= 0 ? n * 2 : -n * 2 - 1;
  let out = '';
  do {
    let digit = z % MORE;
    z = Math.floor(z / MORE);
    if (z > 0) digit += MORE;
    out += DIGITS[digit];
  } while (z > 0);
  return out;
}

export function packCommands(buffer) {
  const out = [];
  let run = null; // the rects so far: { text, back: [[x, y, w, h] two back, one back] }
  const endRun = () => {
    if (run) out.push(run.text);
    run = null;
  };
  let i = 0;
  while (i < buffer.length) {
    const op = buffer[i];
    const count = ARG_COUNTS[op];
    if (count === undefined) {
      // Not an opcode we know: send the rest as it is rather than misread it.
      endRun();
      for (; i < buffer.length; i++) out.push(typeof buffer[i] === 'number' ? round(buffer[i]) : buffer[i]);
      break;
    }
    const args = buffer.slice(i + 1, i + 1 + count);
    i += 1 + count;
    if (op === FILL_RECT && args.every(Number.isInteger)) {
      run ??= { text: '', back: [[0, 0, 0, 0], [0, 0, 0, 0]] };
      const base = run.back[0];
      for (let k = 0; k < 4; k++) run.text += writeInt(args[k] - base[k]);
      run.back = [run.back[1], args];
      continue;
    }
    endRun();
    out.push(op, ...args.map((a) => (typeof a === 'number' ? round(a) : a)));
  }
  endRun();
  return out;
}

export function unpackCommands(packed) {
  const buffer = [];
  for (const item of packed) {
    if (typeof item !== 'string') {
      buffer.push(item);
      continue;
    }
    let back = [[0, 0, 0, 0], [0, 0, 0, 0]];
    const rect = [];
    let k = 0;
    let z = 0;
    let scale = 1;
    for (const c of item) {
      const digit = VALUES[c];
      z += (digit % MORE) * scale;
      if (digit >= MORE) {
        scale *= MORE;
        continue;
      }
      rect[k] = back[0][k] + (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
      z = 0;
      scale = 1;
      if (++k === 4) {
        buffer.push(FILL_RECT, ...rect);
        back = [back[1], rect.slice()];
        k = 0;
      }
    }
  }
  return buffer;
}
