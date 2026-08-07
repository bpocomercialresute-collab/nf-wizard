// Document scanning — jscanify (OpenCV.js) + canvas enhancement

// ---- OpenCV loader ----

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
    }, 200);

    script.onerror = () => {
      clearInterval(poll);
      _cvPromise = null;
      reject(new Error("Falha ao carregar OpenCV"));
    };

    setTimeout(() => {
      clearInterval(poll);
      if (!window.cv?.Mat) { _cvPromise = null; reject(new Error("Timeout OpenCV")); }
    }, 90_000);

    document.head.appendChild(script);
  });

  return _cvPromise;
}

export function isOpenCVReady(): boolean {
  return !!window.cv?.Mat;
}

// ---- jscanify singleton ----

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

// ---- Enhancement — grayscale + contrast/brightness via canvas filter ----
// Uses CSS filter API: no binary threshold, no risk of all-black output.

export function enhanceDocument(src: HTMLCanvasElement): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width  = src.width;
  dst.height = src.height;
  const ctx  = dst.getContext("2d")!;

  // Grayscale + contrast boost — clean document look, never all-black
  ctx.filter = "grayscale(1) contrast(1.7) brightness(1.08)";
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";

  return dst;
}

// ---- Main scan — jscanify perspective warp + enhancement ----

export async function scanDocument(src: HTMLCanvasElement): Promise<{
  canvas: HTMLCanvasElement;
  detected: boolean;
}> {
  try {
    const scanner = await getScanner();

    const isLandscape = src.width > src.height * 1.2;
    const outW = isLandscape ? 1754 : 1240;
    const outH = isLandscape ? 1240 : 1754;

    const extracted: HTMLCanvasElement | null = scanner.extractPaper(src, outW, outH);

    if (extracted) {
      return { canvas: enhanceDocument(extracted), detected: true };
    }
  } catch {
    // OpenCV/jscanify failed — use fallback
  }

  // Fallback: enhance full image without perspective correction
  return { canvas: enhanceDocument(src), detected: false };
}

// ---- Real-time paper detection (for viewfinder feedback) ----

export async function detectPaper(el: HTMLVideoElement | HTMLCanvasElement): Promise<boolean> {
  if (!isOpenCVReady()) return false;
  try {
    const scanner = await getScanner();

    const maxDim = 480;
    const srcW = el instanceof HTMLVideoElement ? el.videoWidth  : el.width;
    const srcH = el instanceof HTMLVideoElement ? el.videoHeight : el.height;
    const ratio = Math.min(1, maxDim / Math.max(srcW, srcH));

    const snap = document.createElement("canvas");
    snap.width  = Math.round(srcW * ratio);
    snap.height = Math.round(srcH * ratio);
    snap.getContext("2d")!.drawImage(el, 0, 0, snap.width, snap.height);

    const mat     = window.cv.imread(snap);
    const contour = scanner.findPaperContour(mat);
    mat.delete();

    if (!contour || contour.empty()) {
      try { contour?.delete(); } catch { /* */ }
      return false;
    }
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
