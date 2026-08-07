// Document scanning — pure canvas, zero external deps
// Enhancement: adaptive threshold for clean scan look (black text on white)

function boxBlur(gray: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    let sum = 0, count = 0;
    for (let x = 0; x < Math.min(r, w); x++) { sum += gray[y * w + x]!; count++; }
    for (let x = 0; x < w; x++) {
      if (x + r < w) { sum += gray[y * w + x + r]!; count++; }
      if (x - r - 1 >= 0) { sum -= gray[y * w + x - r - 1]!; count--; }
      tmp[y * w + x] = sum / count;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0, count = 0;
    for (let y = 0; y < Math.min(r, h); y++) { sum += tmp[y * w + x]!; count++; }
    for (let y = 0; y < h; y++) {
      if (y + r < h) { sum += tmp[(y + r) * w + x]!; count++; }
      if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]!; count--; }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

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

  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (data[i * 4] ?? 0) * 0.299 + (data[i * 4 + 1] ?? 0) * 0.587 + (data[i * 4 + 2] ?? 0) * 0.114;
  }

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

export async function scanDocument(src: HTMLCanvasElement): Promise<{
  canvas: HTMLCanvasElement;
}> {
  return { canvas: enhanceDocument(src) };
}

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
