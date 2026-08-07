// Document scanning utilities
// Perspective correction: jscanify (wraps OpenCV)
// Enhancement: adaptive threshold for clean scan look

// ---- OpenCV loader (required by jscanify) ----

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { cv: any; }
}

const OPENCV_CDN = "https://docs.opencv.org/4.10.0/opencv.js";
let _cvPromise: Promise<void> | null = null;

export function loadOpenCV(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.cv?.Mat) return Promise.resolve();
  if (_cvPromise) return _cvPromise;

  _cvPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = OPENCV_CDN;
    script.async = true;

    const poll = setInterval(() => {
      if (window.cv?.Mat) { clearInterval(poll); resolve(); }
    }, 150);

    script.onerror = () => {
      clearInterval(poll);
      _cvPromise = null;
      reject(new Error("Falha ao carregar OpenCV.js"));
    };

    setTimeout(() => {
      clearInterval(poll);
      if (!window.cv?.Mat) { _cvPromise = null; reject(new Error("Timeout OpenCV.js")); }
    }, 60_000);

    document.head.appendChild(script);
  });

  return _cvPromise;
}

// ---- jscanify scanner singleton ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _scanner: any | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getScanner(): Promise<any> {
  if (_scanner) return _scanner;
  await loadOpenCV();
  const mod = await import("jscanify");
  _scanner = new mod.default();
  return _scanner;
}

// ---- Box blur (for adaptive threshold) ----

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

// ---- Document enhancement — adaptive threshold ----
// Makes text crisp black on white background (clean scan look).

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

// ---- Main scan function ----
// Uses jscanify for automatic perspective correction + enhanceDocument for clean look.
// Returns { canvas, detected } — detected=false means no clear boundary found.

export async function scanDocument(src: HTMLCanvasElement): Promise<{
  canvas: HTMLCanvasElement;
  detected: boolean;
}> {
  try {
    const scanner = await getScanner();

    // Output dimensions: A4 ratio, portrait unless the photo is clearly landscape
    const isLandscape = src.width > src.height * 1.2;
    const outW = isLandscape ? 1754 : 1240;
    const outH = isLandscape ? 1240 : 1754;

    const extracted: HTMLCanvasElement | null = scanner.extractPaper(src, outW, outH);

    if (extracted) {
      return { canvas: enhanceDocument(extracted), detected: true };
    }
  } catch {
    // OpenCV/jscanify error — fall through to fallback
  }

  // Fallback: enhance full image (no perspective correction)
  return { canvas: enhanceDocument(src), detected: false };
}

// ---- Real-time detection check ----
// Returns true if a paper contour is found in the given video/canvas element.
// Used to give visual feedback in the camera viewfinder.

export async function detectPaper(el: HTMLVideoElement | HTMLCanvasElement): Promise<boolean> {
  try {
    const scanner = await getScanner();
    const cv = window.cv;
    if (!cv?.Mat) return false;

    // Snapshot at reduced size for performance
    const maxDim = 480;
    const ratio = Math.min(1, maxDim / Math.max(
      el instanceof HTMLVideoElement ? el.videoWidth  : el.width,
      el instanceof HTMLVideoElement ? el.videoHeight : el.height,
    ));
    const snap = document.createElement("canvas");
    snap.width  = Math.round((el instanceof HTMLVideoElement ? el.videoWidth  : el.width)  * ratio);
    snap.height = Math.round((el instanceof HTMLVideoElement ? el.videoHeight : el.height) * ratio);
    snap.getContext("2d")!.drawImage(el, 0, 0, snap.width, snap.height);

    const mat = cv.imread(snap);
    const contour = scanner.findPaperContour(mat);
    mat.delete();

    if (!contour || contour.empty()) { try { contour?.delete(); } catch { /* */ } return false; }
    contour.delete();
    return true;
  } catch {
    return false;
  }
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
