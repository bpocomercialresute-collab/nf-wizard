import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { type NFRecord, storageUrl, fmtDate } from "./nf-storage";

const SUPABASE_URL = "https://itaqcedhozbvrlqydlof.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0YXFjZWRob3pidnJscXlkbG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTM2NzcsImV4cCI6MjEwMTQ4OTY3N30.r76d7SiXEngiznK1lh_aciGcskdK-A99xeTGVGMvsvc";

// ---- Semanas ----

export type WeekOption = {
  label: string;
  start: Date;
  end: Date;
};

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function fmt(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function getWeekOptions(count = 8): WeekOption[] {
  const options: WeekOption[] = [];
  const thisMonday = mondayOf(new Date());
  for (let i = 0; i < count; i++) {
    const start = new Date(thisMonday);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const label = i === 0
      ? `Semana atual (${fmt(start)} – ${fmt(new Date(end.getTime() - 86400_000))})`
      : `${fmt(start)} – ${fmt(new Date(end.getTime() - 86400_000))}`;
    options.push({ label, start, end });
  }
  return options;
}

// ---- Busca NFs da semana ----

export async function fetchWeekNFs(start: Date, end: Date): Promise<NFRecord[]> {
  const from = start.toISOString();
  const to = end.toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_uploads?created_at=gte.${from}&created_at=lt.${to}&select=*&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) return [];
  return (await res.json()) as NFRecord[];
}

// ---- Geração do PDF ----

const BRAND = rgb(0.075, 0.655, 0.616); // teal Varremaster
const WHITE = rgb(1, 1, 1);
const DARK  = rgb(0.1, 0.1, 0.1);
const GRAY  = rgb(0.45, 0.45, 0.45);
const LINE  = rgb(0.88, 0.88, 0.88);

export async function generateWeeklyPDF(
  nfs: NFRecord[],
  weekLabel: string,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`NF Wizard — ${weekLabel}`);
  doc.setAuthor("Varremaster NF Wizard");
  doc.setCreator("NF Wizard");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28; // A4 width  (pt)
  const H = 841.89; // A4 height (pt)
  const MARGIN = 32;
  const CONTENT_W = W - MARGIN * 2;

  // ---- Capa ----
  const cover = doc.addPage([W, H]);

  cover.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: BRAND });
  cover.drawText("NF Wizard", {
    x: MARGIN, y: H - 60, size: 32, font: bold, color: WHITE,
  });
  cover.drawText("Varremaster", {
    x: MARGIN, y: H - 84, size: 14, font: regular, color: rgb(0.8, 1, 0.97),
  });

  cover.drawText("Relatório Semanal de Notas Fiscais", {
    x: MARGIN, y: H - 160, size: 20, font: bold, color: DARK,
  });
  cover.drawText(weekLabel.replace("Semana atual — ", "").replace("Semana atual (", "").replace(")", ""), {
    x: MARGIN, y: H - 190, size: 13, font: regular, color: GRAY,
  });

  cover.drawLine({
    start: { x: MARGIN, y: H - 210 },
    end: { x: W - MARGIN, y: H - 210 },
    thickness: 1, color: LINE,
  });

  // Resumo na capa
  cover.drawText(`Total de notas: ${nfs.length}`, {
    x: MARGIN, y: H - 240, size: 11, font: bold, color: DARK,
  });
  const totalValor = nfs
    .filter((n) => n.nf_valor)
    .map((n) => {
      const clean = (n.nf_valor ?? "").replace(/R\$\s?/, "").replace(/\./g, "").replace(",", ".");
      return parseFloat(clean) || 0;
    })
    .reduce((a, b) => a + b, 0);
  if (totalValor > 0) {
    cover.drawText(
      `Valor total: R$ ${totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      { x: MARGIN, y: H - 260, size: 11, font: bold, color: DARK },
    );
  }

  // Índice na capa
  let idxY = H - 300;
  cover.drawText("Notas neste relatório:", {
    x: MARGIN, y: idxY, size: 10, font: bold, color: GRAY,
  });
  idxY -= 18;
  for (const nf of nfs.slice(0, 30)) {
    if (idxY < MARGIN + 20) break;
    cover.drawText(
      `• NF ${nf.nf_numero ?? "—"}  ${nf.nf_destinatario ? `— ${nf.nf_destinatario}` : ""}  ${nf.nf_valor ?? ""}`,
      { x: MARGIN + 8, y: idxY, size: 9, font: regular, color: DARK, maxWidth: CONTENT_W - 8 },
    );
    idxY -= 14;
  }

  // Rodapé da capa
  cover.drawText(`Gerado em ${new Date().toLocaleString("pt-BR")}`, {
    x: MARGIN, y: 20, size: 8, font: regular, color: GRAY,
  });

  // ---- Uma página por NF ----
  for (let i = 0; i < nfs.length; i++) {
    const nf = nfs[i]!;
    onProgress?.(Math.round(((i + 1) / nfs.length) * 90));

    const page = doc.addPage([W, H]);

    // Header stripe
    page.drawRectangle({ x: 0, y: H - 44, width: W, height: 44, color: BRAND });
    page.drawText("NF Wizard — Relatório Semanal", {
      x: MARGIN, y: H - 28, size: 11, font: bold, color: WHITE,
    });
    page.drawText(`${i + 1} / ${nfs.length}`, {
      x: W - MARGIN - 30, y: H - 28, size: 9, font: regular, color: rgb(0.8, 1, 0.97),
    });

    // NF number block
    page.drawText(`NF  ${nf.nf_numero ?? "—"}`, {
      x: MARGIN, y: H - 80, size: 22, font: bold, color: DARK,
    });

    // Metadata grid
    const meta: [string, string | undefined][] = [
      ["Arquivo original", nf.file_name],
      ["Data de upload", fmtDate(nf.created_at)],
      ["Destinatário", nf.nf_destinatario],
      ["CNPJ", nf.nf_cnpj],
      ["Valor Total", nf.nf_valor],
      ["Data da NF", nf.nf_data],
    ];

    let metaY = H - 106;
    for (const [label, value] of meta) {
      if (!value) continue;
      page.drawText(`${label}:`, { x: MARGIN, y: metaY, size: 8, font: bold, color: GRAY });
      page.drawText(value, { x: MARGIN + 90, y: metaY, size: 8, font: regular, color: DARK, maxWidth: CONTENT_W - 90 });
      metaY -= 14;
    }

    // Divider
    const imgTop = metaY - 8;
    page.drawLine({
      start: { x: MARGIN, y: imgTop },
      end: { x: W - MARGIN, y: imgTop },
      thickness: 0.5, color: LINE,
    });

    // Imagem escaneada
    const imgAreaH = imgTop - MARGIN - 20;
    const isPdf = nf.storage_path?.endsWith(".pdf");

    if (nf.storage_path && !isPdf) {
      try {
        const imgBytes = await fetch(storageUrl(nf.storage_path)).then((r) => r.arrayBuffer());
        const isPng = nf.storage_path.endsWith(".png");
        const img = isPng
          ? await doc.embedPng(imgBytes)
          : await doc.embedJpg(imgBytes);

        const scale = Math.min(CONTENT_W / img.width, imgAreaH / img.height, 1);
        const iw = img.width * scale;
        const ih = img.height * scale;
        const ix = MARGIN + (CONTENT_W - iw) / 2;
        const iy = MARGIN + 20 + (imgAreaH - ih) / 2;

        page.drawImage(img, { x: ix, y: iy, width: iw, height: ih });
      } catch {
        page.drawText("(Imagem não disponível)", {
          x: MARGIN, y: MARGIN + imgAreaH / 2, size: 10, font: regular, color: GRAY,
        });
      }
    } else if (isPdf) {
      page.drawText("Arquivo PDF — visualize no botão 'Ver imagem' na ferramenta.", {
        x: MARGIN, y: MARGIN + imgAreaH / 2, size: 10, font: regular, color: GRAY,
      });
    }

    // Número de página no rodapé
    page.drawText(`NF Wizard · Varremaster · ${new Date().toLocaleDateString("pt-BR")}`, {
      x: MARGIN, y: 12, size: 7, font: regular, color: GRAY,
    });
    page.drawText(`Pág. ${i + 2}`, {
      x: W - MARGIN - 24, y: 12, size: 7, font: regular, color: GRAY,
    });
  }

  onProgress?.(100);
  return doc.save();
}

export function downloadPDF(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
