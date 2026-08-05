import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "pdf-lib";
import { type NFRecord, storageUrl, fmtDate } from "./nf-storage";

const SUPABASE_URL = "https://itaqcedhozbvrlqydlof.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0YXFjZWRob3pidnJscXlkbG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTM2NzcsImV4cCI6MjEwMTQ4OTY3N30.r76d7SiXEngiznK1lh_aciGcskdK-A99xeTGVGMvsvc";

// ── Cores ────────────────────────────────────────────────────────────────────
const C = {
  brand:    rgb(0.075, 0.655, 0.616),
  brandDk:  rgb(0.04,  0.42,  0.40),
  brandLt:  rgb(0.87,  0.97,  0.96),
  white:    rgb(1,     1,     1),
  dark:     rgb(0.10,  0.10,  0.10),
  mid:      rgb(0.30,  0.30,  0.30),
  gray:     rgb(0.55,  0.55,  0.55),
  line:     rgb(0.88,  0.88,  0.88),
  rowAlt:   rgb(0.97,  0.99,  0.99),
  success:  rgb(0.08,  0.56,  0.31),
};

// ── Página A4 ─────────────────────────────────────────────────────────────────
const W = 595.28;
const H = 841.89;
const M = 36; // margem
const CW = W - M * 2;

// ── Semanas ───────────────────────────────────────────────────────────────────

export type WeekOption = { label: string; start: Date; end: Date };

function mondayOf(d: Date): Date {
  const r = new Date(d);
  const day = r.getUTCDay();
  r.setUTCDate(r.getUTCDate() + (day === 0 ? -6 : 1 - day));
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export function getWeekOptions(count = 8): WeekOption[] {
  const base = mondayOf(new Date());
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const last = new Date(end.getTime() - 86_400_000);
    const label = i === 0
      ? `Semana atual  (${fmtShort(start)} – ${fmtShort(last)})`
      : `${fmtShort(start)} – ${fmtShort(last)}`;
    return { label, start, end };
  });
}

// ── Busca ─────────────────────────────────────────────────────────────────────

export async function fetchWeekNFs(start: Date, end: Date): Promise<NFRecord[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_uploads?created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&select=*&order=created_at.asc`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" } },
  );
  return res.ok ? ((await res.json()) as NFRecord[]) : [];
}

export async function fetchWeekNFCount(start: Date, end: Date): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_uploads?created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&select=id`,
    {
      method: "HEAD",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        "Content-Type": "application/json",
        Prefer: "count=exact",
      },
    },
  );
  if (!res.ok) return 0;
  const raw = res.headers.get("content-range");
  if (!raw) return 0;
  const total = raw.split("/")[1];
  return total ? parseInt(total, 10) : 0;
}

// ── Helpers de desenho ────────────────────────────────────────────────────────

function parseValor(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.replace(/R\$\s?/, "").replace(/\./g, "").replace(",", ".")) || 0;
}

function fmtBRL(n: number): string {
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function drawFooter(page: PDFPage, regular: PDFFont, pageNum: number, total: number) {
  page.drawLine({ start: { x: M, y: 24 }, end: { x: W - M, y: 24 }, thickness: 0.4, color: C.line });
  page.drawText("NF Wizard · Varremaster", { x: M, y: 10, size: 7, font: regular, color: C.gray });
  page.drawText(`Pág. ${pageNum} / ${total}`, { x: W - M - 50, y: 10, size: 7, font: regular, color: C.gray });
  page.drawText(new Date().toLocaleDateString("pt-BR"), {
    x: W / 2 - 20, y: 10, size: 7, font: regular, color: C.gray,
  });
}

function drawPageHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, sub: string) {
  page.drawRectangle({ x: 0, y: H - 40, width: W, height: 40, color: C.brand });
  page.drawText("NF Wizard — Relatório Semanal", { x: M, y: H - 26, size: 11, font: bold, color: C.white });
  page.drawText(sub, { x: W - M - (sub.length * 5.5), y: H - 26, size: 8, font: regular, color: rgb(0.8, 1, 0.97) });
}

function infoBox(
  page: PDFPage, bold: PDFFont, regular: PDFFont,
  x: number, y: number, w: number, h: number,
  label: string, value: string,
) {
  page.drawRectangle({ x, y, width: w, height: h, color: C.brandLt, borderColor: C.line, borderWidth: 0.5 });
  page.drawText(label.toUpperCase(), { x: x + 6, y: y + h - 12, size: 6.5, font: bold, color: C.gray });
  page.drawText(truncate(value, Math.floor(w / 5.5)), { x: x + 6, y: y + 6, size: 8.5, font: regular, color: C.dark });
}

// ── PDF principal ─────────────────────────────────────────────────────────────

export async function generateWeeklyPDF(
  nfs: NFRecord[],
  weekLabel: string,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório Semanal NF Wizard — ${weekLabel}`);
  doc.setAuthor("Varremaster NF Wizard");
  doc.setCreator("NF Wizard · Varremaster");
  doc.setSubject(weekLabel);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);

  const totalValor = nfs.reduce((s, n) => s + parseValor(n.nf_valor), 0);
  const totalPages = 2 + nfs.length; // capa + resumo + 1 por NF

  // ── Tenta embutir logo ──────────────────────────────────────────────────────
  let logoImg: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const logoBytes = await fetch(`${origin}/brand/varremaster-full.png`).then((r) => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch { /* logo opcional */ }

  // ══════════════════════════════════════════════════════════════════════════
  // CAPA
  // ══════════════════════════════════════════════════════════════════════════
  const cover = doc.addPage([W, H]);

  // Faixa superior escura
  cover.drawRectangle({ x: 0, y: H - 160, width: W, height: 160, color: C.brandDk });
  // Faixa de destaque teal
  cover.drawRectangle({ x: 0, y: H - 170, width: W, height: 14, color: C.brand });

  // Logo
  if (logoImg) {
    const lh = 38;
    const lw = (logoImg.width / logoImg.height) * lh;
    cover.drawImage(logoImg, { x: M, y: H - M - lh, width: lw, height: lh });
  } else {
    cover.drawText("VARREMASTER", { x: M, y: H - M - 24, size: 18, font: bold, color: C.white });
  }

  cover.drawText("NF Wizard", { x: M, y: H - 100, size: 36, font: bold, color: C.white });
  cover.drawText("Relatório Semanal de Notas Fiscais", { x: M, y: H - 124, size: 14, font: regular, color: rgb(0.78, 0.97, 0.94) });

  // Período — caixa centralizada
  const periodClean = weekLabel.replace("Semana atual  (", "").replace("Semana atual (", "").replace(")", "").trim();
  cover.drawRectangle({ x: M, y: H - 220, width: CW, height: 36, color: C.brand, borderColor: C.brand, borderWidth: 0 });
  cover.drawText(periodClean, { x: M + 12, y: H - 196, size: 13, font: bold, color: C.white });

  // 3 cards de resumo
  const cardW = (CW - 16) / 3;
  const cardH = 72;
  const cardY = H - 320;
  const cards = [
    { label: "Total de Notas", value: String(nfs.length), sub: "notas fiscais" },
    { label: "Valor Total", value: totalValor > 0 ? fmtBRL(totalValor) : "—", sub: "soma dos valores" },
    { label: "Período", value: periodClean.split(" – ")[0] ?? "", sub: `até ${periodClean.split(" – ")[1] ?? ""}` },
  ];
  for (let ci = 0; ci < cards.length; ci++) {
    const cx = M + ci * (cardW + 8);
    const card = cards[ci]!;
    cover.drawRectangle({ x: cx, y: cardY, width: cardW, height: cardH, color: C.white, borderColor: C.line, borderWidth: 0.5 });
    cover.drawRectangle({ x: cx, y: cardY + cardH - 4, width: cardW, height: 4, color: C.brand });
    cover.drawText(card.label.toUpperCase(), { x: cx + 8, y: cardY + cardH - 18, size: 7, font: bold, color: C.gray });
    cover.drawText(truncate(card.value, 18), { x: cx + 8, y: cardY + 32, size: 16, font: bold, color: C.dark });
    cover.drawText(card.sub, { x: cx + 8, y: cardY + 12, size: 7.5, font: regular, color: C.gray });
  }

  // Índice (até 28 NFs)
  const idxTitle = H - 360;
  cover.drawText("ÍNDICE DAS NOTAS", { x: M, y: idxTitle, size: 8, font: bold, color: C.gray });
  cover.drawLine({ start: { x: M, y: idxTitle - 4 }, end: { x: W - M, y: idxTitle - 4 }, thickness: 0.4, color: C.line });

  let iy = idxTitle - 20;
  for (let ni = 0; ni < Math.min(nfs.length, 28); ni++) {
    const nf = nfs[ni]!;
    if (ni % 2 === 0) cover.drawRectangle({ x: M, y: iy - 2, width: CW, height: 14, color: C.rowAlt });
    cover.drawText(`${String(ni + 1).padStart(2, "0")}.`, { x: M + 4, y: iy + 2, size: 8, font: bold, color: C.brand });
    cover.drawText(`NF ${nf.nf_numero ?? "—"}`, { x: M + 24, y: iy + 2, size: 8, font: bold, color: C.dark });
    const dest = truncate(nf.nf_destinatario ?? "—", 30);
    cover.drawText(dest, { x: M + 90, y: iy + 2, size: 8, font: regular, color: C.mid });
    const val = nf.nf_valor ? truncate(nf.nf_valor, 16) : "";
    cover.drawText(val, { x: W - M - 80, y: iy + 2, size: 8, font: regular, color: C.success });
    cover.drawText(`Pág. ${ni + 3}`, { x: W - M - 28, y: iy + 2, size: 7.5, font: regular, color: C.gray });
    iy -= 14;
    if (iy < 50) break;
  }
  if (nfs.length > 28) {
    cover.drawText(`… e mais ${nfs.length - 28} nota(s). Veja o resumo na próxima página.`, {
      x: M, y: iy, size: 8, font: regular, color: C.gray,
    });
  }

  cover.drawText(`Gerado em ${new Date().toLocaleString("pt-BR")}  ·  NF Wizard · Varremaster`, {
    x: M, y: 10, size: 7.5, font: regular, color: C.gray,
  });

  onProgress?.(5);

  // ══════════════════════════════════════════════════════════════════════════
  // RESUMO — tabela completa
  // ══════════════════════════════════════════════════════════════════════════
  const summaryPages: PDFPage[] = [];
  let sp: PDFPage | null = null;
  let sy = 0;
  const ROW_H = 16;
  const COL = { num: M, nf: M + 22, dest: M + 80, cnpj: M + 240, data: M + 360, valor: M + 440 };
  const HEADER_Y = H - 72;

  function newSummaryPage() {
    const p = doc.addPage([W, H]);
    drawPageHeader(p, bold, regular, "Resumo Geral");
    // Cabeçalho da tabela
    p.drawRectangle({ x: M, y: HEADER_Y, width: CW, height: 18, color: C.brand });
    p.drawText("#",           { x: COL.num  + 2, y: HEADER_Y + 5, size: 7.5, font: bold, color: C.white });
    p.drawText("Nº NF",       { x: COL.nf   + 2, y: HEADER_Y + 5, size: 7.5, font: bold, color: C.white });
    p.drawText("Destinatário",{ x: COL.dest + 2, y: HEADER_Y + 5, size: 7.5, font: bold, color: C.white });
    p.drawText("CNPJ",        { x: COL.cnpj + 2, y: HEADER_Y + 5, size: 7.5, font: bold, color: C.white });
    p.drawText("Data NF",     { x: COL.data + 2, y: HEADER_Y + 5, size: 7.5, font: bold, color: C.white });
    p.drawText("Valor",       { x: COL.valor+ 2, y: HEADER_Y + 5, size: 7.5, font: bold, color: C.white });
    summaryPages.push(p);
    return { page: p, rowY: HEADER_Y - ROW_H };
  }

  ({ page: sp, rowY: sy } = newSummaryPage());

  for (let ni = 0; ni < nfs.length; ni++) {
    const nf = nfs[ni]!;
    if (sy < 50) {
      ({ page: sp, rowY: sy } = newSummaryPage());
    }
    if (ni % 2 === 0) sp!.drawRectangle({ x: M, y: sy, width: CW, height: ROW_H, color: C.rowAlt });
    const rowY2 = sy + 4;
    sp!.drawText(String(ni + 1),                            { x: COL.num  + 2, y: rowY2, size: 7.5, font: regular, color: C.gray });
    sp!.drawText(truncate(nf.nf_numero ?? "—", 7),          { x: COL.nf   + 2, y: rowY2, size: 7.5, font: bold,    color: C.dark });
    sp!.drawText(truncate(nf.nf_destinatario ?? "—", 22),   { x: COL.dest + 2, y: rowY2, size: 7.5, font: regular, color: C.dark });
    sp!.drawText(truncate(nf.nf_cnpj ?? "—", 20),           { x: COL.cnpj + 2, y: rowY2, size: 7.5, font: regular, color: C.mid  });
    sp!.drawText(truncate(nf.nf_data ?? "—", 10),           { x: COL.data + 2, y: rowY2, size: 7.5, font: regular, color: C.mid  });
    sp!.drawText(truncate(nf.nf_valor ?? "—", 13),          { x: COL.valor+ 2, y: rowY2, size: 7.5, font: bold,    color: C.success });
    sy -= ROW_H;
  }

  // Linha de total
  if (totalValor > 0) {
    sp!.drawRectangle({ x: M, y: sy, width: CW, height: ROW_H, color: C.brand });
    sp!.drawText("TOTAL", { x: COL.dest + 2, y: sy + 4, size: 8, font: bold, color: C.white });
    sp!.drawText(fmtBRL(totalValor), { x: COL.valor + 2, y: sy + 4, size: 8, font: bold, color: C.white });
  }

  for (const p of summaryPages) drawFooter(p, regular, summaryPages.indexOf(p) + 2, totalPages);

  onProgress?.(15);

  // ══════════════════════════════════════════════════════════════════════════
  // UMA PÁGINA POR NF
  // ══════════════════════════════════════════════════════════════════════════
  for (let i = 0; i < nfs.length; i++) {
    const nf = nfs[i]!;
    onProgress?.(Math.round(15 + ((i + 1) / nfs.length) * 82));

    const page = doc.addPage([W, H]);
    const pageNum = 2 + summaryPages.length + i + 1;

    // Header com número da NF em destaque
    page.drawRectangle({ x: 0, y: H - 56, width: W, height: 56, color: C.brandDk });
    page.drawRectangle({ x: 0, y: H - 60, width: W, height: 4, color: C.brand });
    page.drawText(`NF  ${nf.nf_numero ?? "—"}`, { x: M, y: H - 36, size: 22, font: bold, color: C.white });
    page.drawText(`${i + 1} de ${nfs.length}`, { x: W - M - 50, y: H - 22, size: 8, font: regular, color: rgb(0.7, 0.95, 0.92) });
    page.drawText(nf.nf_destinatario ? truncate(nf.nf_destinatario, 55) : "", {
      x: M, y: H - 50, size: 8.5, font: regular, color: rgb(0.78, 0.97, 0.94),
    });

    // Grid de informações — 2 colunas
    const BOX_H = 40;
    const BOX_GAP = 6;
    const COL_W = (CW - BOX_GAP) / 2;
    const gridTop = H - 72;

    const row1: [string, string | undefined][] = [
      ["Destinatário", nf.nf_destinatario],
      ["CNPJ", nf.nf_cnpj],
    ];
    const row2: [string, string | undefined][] = [
      ["Número da NF", nf.nf_numero],
      ["Data da NF", nf.nf_data],
    ];
    const row3: [string, string | undefined][] = [
      ["Valor Total", nf.nf_valor],
      ["Data de upload", fmtDate(nf.created_at)],
    ];

    const rows = [row1, row2, row3];
    for (let ri = 0; ri < rows.length; ri++) {
      const rowY = gridTop - ri * (BOX_H + BOX_GAP);
      for (let ci = 0; ci < rows[ri]!.length; ci++) {
        const [label, value] = rows[ri]![ci]!;
        infoBox(page, bold, regular, M + ci * (COL_W + BOX_GAP), rowY - BOX_H, COL_W, BOX_H, label, value ?? "—");
      }
    }

    // Área da imagem
    const infoBottom = gridTop - rows.length * (BOX_H + BOX_GAP) - 10;
    const imgAreaY = 36;
    const imgAreaH = infoBottom - imgAreaY;
    const imgAreaW = CW;

    // Moldura da imagem
    page.drawRectangle({
      x: M, y: imgAreaY, width: imgAreaW, height: imgAreaH,
      color: C.rowAlt, borderColor: C.line, borderWidth: 0.8,
    });

    const isPdf = nf.storage_path?.endsWith(".pdf");
    if (nf.storage_path && !isPdf) {
      try {
        const imgBytes = await fetch(storageUrl(nf.storage_path)).then((r) => r.arrayBuffer());
        const img = nf.storage_path.endsWith(".png")
          ? await doc.embedPng(imgBytes)
          : await doc.embedJpg(imgBytes);

        const PAD = 10;
        const scale = Math.min((imgAreaW - PAD * 2) / img.width, (imgAreaH - PAD * 2) / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        page.drawImage(img, {
          x: M + (imgAreaW - iw) / 2,
          y: imgAreaY + (imgAreaH - ih) / 2,
          width: iw, height: ih,
        });
      } catch {
        page.drawText("Imagem não disponível", {
          x: M + imgAreaW / 2 - 40, y: imgAreaY + imgAreaH / 2, size: 10, font: regular, color: C.gray,
        });
      }
    } else if (isPdf) {
      page.drawText("Arquivo PDF", { x: M + 12, y: imgAreaY + imgAreaH / 2 + 8, size: 11, font: bold, color: C.gray });
      page.drawText("Visualize o original na ferramenta NF Wizard.", {
        x: M + 12, y: imgAreaY + imgAreaH / 2 - 8, size: 9, font: regular, color: C.gray,
      });
    } else {
      page.drawText("Sem imagem registrada", {
        x: M + imgAreaW / 2 - 50, y: imgAreaY + imgAreaH / 2, size: 10, font: regular, color: C.gray,
      });
    }

    drawFooter(page, regular, pageNum, totalPages);
  }

  onProgress?.(100);
  return doc.save();
}

// ── Download ──────────────────────────────────────────────────────────────────

export function downloadPDF(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
