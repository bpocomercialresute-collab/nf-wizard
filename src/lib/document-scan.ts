// Perspective warp + document enhancement (clean scan look)
// Pure canvas — no external libs

export type Point = [number, number];
export type Quad = [Point, Point, Point, Point]; // tl, tr, br, bl

// ---- Affine triangle draw ----

function drawAffineTriangle(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  // source vertices
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  // destination vertices
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number,
): void {
  // Compute affine transform T such that T * [sx_i, sy_i, 1] = [dx_i, dy_i]
  // Using 3x3 linear system solution
  const D = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(D) < 1e-8) return;
  const iD = 1 / D;

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * iD;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * iD;
  const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) * iD;

  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * iD;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * iD;
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) * iD;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

// ---- Bilinear interpolation of a quad at (s, t) in [0,1]² ----

function bilerp(tl: Point, tr: Point, br: Point, bl: Point, s: number, t: number): Point {
  return [
    (1 - s) * (1 - t) * tl[0] + s * (1 - t) * tr[0] + s * t * br[0] + (1 - s) * t * bl[0],
    (1 - s) * (1 - t) * tl[1] + s * (1 - t) * tr[1] + s * t * br[1] + (1 - s) * t * bl[1],
  ];
}

// ---- Perspective warp via grid of affine triangles ----

export function perspectiveWarp(
  src: HTMLCanvasElement,
  srcQuad: Quad,          // [tl, tr, br, bl] in source pixel space
  outW: number,
  outH: number,
  GRID = 28,
): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = outW;
  dst.height = outH;
  const ctx = dst.getContext("2d")!;

  const [tl, tr, br, bl] = srcQuad;

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const t0 = row / GRID,      t1 = (row + 1) / GRID;
      const s0 = col / GRID,      s1 = (col + 1) / GRID;

      const [sx00, sy00] = bilerp(tl, tr, br, bl, s0, t0);
      const [sx10, sy10] = bilerp(tl, tr, br, bl, s1, t0);
      const [sx01, sy01] = bilerp(tl, tr, br, bl, s0, t1);
      const [sx11, sy11] = bilerp(tl, tr, br, bl, s1, t1);

      const dx0 = s0 * outW, dx1 = s1 * outW;
      const dy0 = t0 * outH, dy1 = t1 * outH;

      // Upper-left triangle
      drawAffineTriangle(ctx, src,
        sx00, sy00, sx10, sy10, sx01, sy01,
        dx0, dy0, dx1, dy0, dx0, dy1,
      );
      // Lower-right triangle
      drawAffineTriangle(ctx, src,
        sx10, sy10, sx11, sy11, sx01, sy01,
        dx1, dy0, dx1, dy1, dx0, dy1,
      );
    }
  }

  return dst;
}

// ---- Box blur (for adaptive threshold local mean) ----

function boxBlur(gray: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);

  // Horizontal pass using integral sum
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) { sum += gray[y * w + x]!; count++; }
    for (let x = 0; x < w; x++) {
      if (x + r < w) { sum += gray[y * w + x + r]!; count++; }
      if (x - r - 1 >= 0) { sum -= gray[y * w + x - r - 1]!; count--; }
      tmp[y * w + x] = sum / count;
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < Math.min(r, h); y++) { sum += tmp[y * w + x]!; count++; }
    for (let y = 0; y < h; y++) {
      if (y + r < h) { sum += tmp[(y + r) * w + x]!; count++; }
      if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]!; count--; }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

// ---- Document enhancement — adaptive threshold ----
// Produces a clean scan: crisp black text on white background.
// C = brightness bias below local mean to be considered "ink"

export function enhanceDocument(src: HTMLCanvasElement, C = 18): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = src.width;
  dst.height = src.height;
  const ctx = dst.getContext("2d")!;
  ctx.drawImage(src, 0, 0);

  const { width: w, height: h } = src;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const n = w * h;

  // Convert to grayscale
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (data[i * 4] ?? 0) * 0.299 + (data[i * 4 + 1] ?? 0) * 0.587 + (data[i * 4 + 2] ?? 0) * 0.114;
  }

  // Adaptive threshold: block radius = ~4% of larger dimension
  const radius = Math.max(15, Math.round(Math.max(w, h) * 0.04));
  const mean = boxBlur(gray, w, h, radius);

  for (let i = 0; i < n; i++) {
    const v = (gray[i] ?? 0) >= (mean[i] ?? 0) - C ? 255 : 0;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return dst;
}

// ---- Output size from source quad ----
// Estimates the natural width/height of the document based on the quad side lengths.

export function estimateOutputSize(quad: Quad): { w: number; h: number } {
  const [tl, tr, br, bl] = quad;
  const wTop  = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const wBot  = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const hLeft = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const hRight = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  const rawW = Math.round((wTop + wBot) / 2);
  const rawH = Math.round((hLeft + hRight) / 2);

  // Cap at reasonable max (A4-like proportions, max 1800px on longer side)
  const MAX = 1800;
  const scale = Math.min(1, MAX / Math.max(rawW, rawH));
  return { w: Math.round(rawW * scale), h: Math.round(rawH * scale) };
}

// ---- Canvas → File ----

export async function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error("toBlob falhou")); return; }
        resolve(new File([blob], name, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  });
}
