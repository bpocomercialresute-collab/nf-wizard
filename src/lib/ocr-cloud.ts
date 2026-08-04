// OCR em nuvem via OCR.space — muito mais preciso em fotos ruins de recibo.
// A imagem É ENVIADA ao serviço OCR.space para processamento.
// Chave grátis (ilimitada p/ uso normal): https://ocr.space/ocrapi/freekey

export type CloudResult = { text: string; previewUrl: string };

export const DEMO_KEY = "helloworld";
const ENDPOINT = "https://api.ocr.space/parse/image";
// Limite do plano grátis: 1 MB por arquivo. Comprimimos antes de enviar.
const MAX_BYTES = 1024 * 1024;

async function compressImage(
  file: Blob,
  maxDim: number,
  quality: number,
): Promise<{ blob: Blob; previewUrl: string }> {
  const bmp = await createImageBitmap(file);
  const longest = Math.max(bmp.width, bmp.height);
  const scale = Math.min(1, maxDim / longest);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob falhou"))), "image/jpeg", quality),
  );
  return { blob, previewUrl: canvas.toDataURL("image/jpeg", 0.85) };
}

// Comprime até caber no limite do serviço (tenta qualidades/dimensões menores).
async function fitUnderLimit(file: Blob): Promise<{ blob: Blob; previewUrl: string }> {
  const tries: [number, number][] = [
    [2200, 0.75],
    [1900, 0.65],
    [1600, 0.6],
    [1300, 0.5],
  ];
  let last = await compressImage(file, tries[0]![0], tries[0]![1]);
  for (const [dim, q] of tries) {
    const r = await compressImage(file, dim, q);
    last = r;
    if (r.blob.size <= MAX_BYTES) return r;
  }
  return last; // melhor esforço
}

export async function ocrCloud(
  file: Blob,
  apiKey: string,
  onProgress: (n: number) => void,
): Promise<CloudResult> {
  onProgress(8);
  const { blob, previewUrl } = await fitUnderLimit(file);
  onProgress(30);

  const form = new FormData();
  form.append("apikey", apiKey.trim() || DEMO_KEY);
  form.append("language", "por");
  form.append("OCREngine", "2");
  form.append("scale", "true");
  form.append("detectOrientation", "true");
  form.append("isTable", "true");
  form.append("file", blob, "nf.jpg");

  const resp = await fetch(ENDPOINT, { method: "POST", body: form });
  onProgress(85);
  if (!resp.ok) throw new Error(`OCR.space HTTP ${resp.status}`);

  const j = (await resp.json()) as {
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string | string[];
    ParsedResults?: { ParsedText?: string }[];
  };
  if (j.IsErroredOnProcessing) {
    const msg = Array.isArray(j.ErrorMessage) ? j.ErrorMessage.join(" ") : j.ErrorMessage;
    throw new Error(msg || "Falha no OCR em nuvem");
  }

  const text = (j.ParsedResults ?? [])
    .map((r) => r.ParsedText ?? "")
    .join("\n")
    .replace(/\t/g, " ");
  onProgress(100);
  return { text, previewUrl };
}
