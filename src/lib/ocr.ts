// OCR robusto para fotos de canhoto/NF: imagens pequenas, baixo contraste e
// giradas. Faz pré-processamento (cinza + contraste + upscale) e testa as 4
// orientações, escolhendo a de maior confiança + riqueza de campos.

import type { Worker } from "tesseract.js";

export type OcrOutput = {
  text: string;
  confidence: number;
  angle: number;
  previewUrl: string;
};

// ---- Worker reutilizável (carregar modelo 1x) ----

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("por+eng");
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      return worker;
    })();
  }
  return workerPromise;
}

// ---- Canvas helpers ----

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas;
}

// Cinza + esticamento de contraste (percentis 2/98) + upscale controlado.
function preprocess(src: HTMLCanvasElement): HTMLCanvasElement {
  const longest = Math.max(src.width, src.height);
  const target = 2600;
  const scale = Math.min(3.5, Math.max(0.5, target / longest));

  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Luminância + histograma
  const gray = new Uint8ClampedArray(d.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) | 0;
    gray[j] = g;
    hist[g]!++;
  }

  // Percentis 1% e 99% para esticar contraste ignorando outliers
  const total = gray.length;
  const loCut = total * 0.01;
  const hiCut = total * 0.99;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= loCut) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= hiCut) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((gray[j]! - lo) * 255) / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function rotate(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  if (deg % 360 === 0) return src;
  const rad = (deg * Math.PI) / 180;
  const swap = deg === 90 || deg === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? src.height : src.width;
  canvas.height = swap ? src.width : src.height;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

// ---- Pontuação: quão "correta" está a leitura ----

function scoreText(text: string): number {
  const t = text.toUpperCase();
  let s = 0;
  if (/\d{2}\.?\d{3}\.?\d{3}[/\\]?\d{4}-?\d{2}/.test(t)) s += 3; // CNPJ
  if (/\d{2}[/-]\d{2}[/-]\d{2,4}/.test(t)) s += 2; // data
  if (/\d[\d.]*,\d{2}/.test(t)) s += 2; // valor monetário
  for (const kw of [
    "RECEBEMOS",
    "NOTA FISCAL",
    "VALOR TOTAL",
    "EMISSAO",
    "DESTINATARIO",
    "SERIE",
    "NF-E",
    "CNPJ",
  ]) {
    if (t.includes(kw)) s += 1;
  }
  // legibilidade: proporção de caracteres alfanuméricos
  const alnum = (t.match(/[A-Z0-9]/g) || []).length;
  if (t.length > 0) s += (alnum / t.length) * 3;
  return s;
}

// ---- API principal ----

// Reconhece testando orientações. `deskew=true` procura a rotação certa.
export async function recognizeCanvas(
  source: HTMLCanvasElement,
  onProgress: (n: number) => void,
  deskew = true,
): Promise<OcrOutput> {
  const worker = await getWorker();
  const { PSM } = await import("tesseract.js");
  const pre = preprocess(source);

  const angles = deskew ? [0, 270, 90, 180] : [0];
  let best: { text: string; confidence: number; angle: number; canvas: HTMLCanvasElement } | null =
    null;

  // Fase 1: descobrir a orientação (PSM AUTO em cada rotação)
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  for (let idx = 0; idx < angles.length; idx++) {
    const angle = angles[idx]!;
    const rotated = rotate(pre, angle);
    const { data } = await worker.recognize(rotated);
    const combined = data.confidence + scoreText(data.text) * 6;
    const bestCombined = best ? best.confidence + scoreText(best.text) * 6 : -1;
    if (!best || combined > bestCombined) {
      best = { text: data.text, confidence: data.confidence, angle, canvas: rotated };
    }
    onProgress(Math.round(((idx + 1) / angles.length) * 85));
    if (data.confidence >= 68 && scoreText(data.text) >= 6) {
      best = { text: data.text, confidence: data.confidence, angle, canvas: rotated };
      break;
    }
  }

  const chosen = best!;

  // Fase 2: passes extras na orientação vencedora. Cada modo de segmentação
  // captura regiões diferentes do documento; mesclar recupera mais campos.
  let mergedText = chosen.text;
  for (const psm of [PSM.SPARSE_TEXT, PSM.SINGLE_BLOCK]) {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const alt = await worker.recognize(chosen.canvas);
      mergedText += "\n" + alt.data.text;
    } catch {
      // ignora falha de um modo específico
    }
  }
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  onProgress(100);

  return {
    text: mergedText,
    confidence: Math.round(chosen.confidence),
    angle: chosen.angle,
    previewUrl: chosen.canvas.toDataURL("image/jpeg", 0.85),
  };
}

export async function ocrImageBlob(
  blob: Blob,
  onProgress: (n: number) => void,
): Promise<OcrOutput> {
  const canvas = await blobToCanvas(blob);
  return recognizeCanvas(canvas, onProgress, true);
}

export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
