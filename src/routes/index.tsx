import { createFileRoute } from "@tanstack/react-router";
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Download,
  ScanLine,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NF Renamer — Renomeie notas fiscais com OCR" },
      {
        name: "description",
        content:
          "Importe imagens e PDFs de notas fiscais, extraia os dados por OCR e baixe os arquivos renomeados no seu padrão.",
      },
      { property: "og:title", content: "NF Renamer — Renomeie notas fiscais com OCR" },
      {
        property: "og:description",
        content:
          "Importe imagens e PDFs de notas fiscais, extraia os dados por OCR e baixe os arquivos renomeados no seu padrão.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const tokens = ["{NUMERO}", "{DATA}", "{EMITENTE}", "{CNPJ}", "{VALOR}"];

type Status = "aguardando" | "processando" | "concluido" | "erro";

const files: {
  name: string;
  type: "pdf" | "img";
  status: Status;
  selected?: boolean;
  active?: boolean;
  progress?: number;
}[] = [
  { name: "nf_scan_0912.pdf", type: "pdf", status: "concluido", selected: true, active: true },
  { name: "IMG_20260731_0042.jpg", type: "img", status: "processando", selected: true, progress: 62 },
  { name: "nota_fornecedor_ax.pdf", type: "pdf", status: "aguardando" },
  { name: "recibo_scan_88.png", type: "img", status: "erro" },
  { name: "nf_eletronica_1102.pdf", type: "pdf", status: "concluido", selected: true },
];

const statusStyles: Record<Status, { label: string; className: string; icon: typeof Clock }> = {
  aguardando: {
    label: "aguardando",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  },
  processando: {
    label: "processando",
    className: "bg-accent/15 text-accent",
    icon: Loader2,
  },
  concluido: {
    label: "concluído",
    className: "bg-success/15 text-success",
    icon: CheckCircle2,
  },
  erro: {
    label: "erro",
    className: "bg-destructive/15 text-destructive",
    icon: AlertTriangle,
  },
};

const extracted = [
  { label: "Número NF", value: "000.912.447" },
  { label: "Data", value: "12/03/2026" },
  { label: "Emitente", value: "Aurora Distribuidora LTDA" },
  { label: "CNPJ", value: "12.345.678/0001-90" },
  { label: "Valor Total", value: "R$ 4.820,55" },
];

const ocrText = `DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA
AURORA DISTRIBUIDORA LTDA
CNPJ: 12.345.678/0001-90
INSCR. ESTADUAL: 110.042.998.114
No. 000.912.447   SERIE 001
DATA DE EMISSAO: 12/03/2026   SAIDA: 12/03/2026
NATUREZA DA OPERACAO: VENDA DE MERCADORIA
--------------------------------------------
PRODUTOS / SERVICOS
0012  CABO FLEX 2.5MM      UN  40   R$ 38,20
0034  CONECTOR RJ45        CX  06   R$ 112,90
--------------------------------------------
BASE DE CALCULO ICMS: R$ 4.120,00
VALOR TOTAL DA NOTA: R$ 4.820,55`;

function Index() {
  return (
    <div className="min-h-screen pb-28">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-5 py-4">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <ScanLine className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">NF Renamer</h1>
            <p className="text-xs text-muted-foreground">
              OCR de notas fiscais e renomeação automática de arquivos
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6">
        {/* Zona 1 */}
        <section className="surface rounded-2xl border border-border/70 p-5">
          <label
            htmlFor="pattern-input"
            className="text-sm font-medium text-foreground"
          >
            Padrão do nome do arquivo
          </label>
          <input
            id="pattern-input"
            defaultValue="NF_{NUMERO}_{DATA}_{EMITENTE}"
            className="mt-2 w-full rounded-xl border border-border bg-input/60 px-4 py-3 font-mono text-sm text-foreground outline-none transition focus:border-primary focus:shadow-[var(--shadow-glow)]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Tokens disponíveis:</span>
            {tokens.map((t) => (
              <button
                key={t}
                type="button"
                className="rounded-full border border-border bg-secondary px-3 py-1 font-mono text-xs text-secondary-foreground transition hover:border-primary hover:bg-primary/15 hover:text-primary"
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Zona 2 */}
        <section>
          <label
            htmlFor="file-input"
            className="surface flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border px-6 py-12 text-center transition hover:border-primary hover:bg-primary/5"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
              <UploadCloud className="size-7" />
            </span>
            <span className="text-base font-medium">
              Arraste arquivos aqui ou clique para importar
            </span>
            <span className="text-sm text-muted-foreground">
              Suporta JPG, PNG e PDF — múltiplos arquivos
            </span>
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
            />
          </label>
        </section>

        {/* Zona 3 */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-10">
          <div className="surface rounded-2xl border border-border/70 p-4 lg:col-span-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Arquivos processados</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                5
              </span>
            </div>
            <ul id="file-list" className="flex flex-col gap-2">
              {files.map((f) => {
                const s = statusStyles[f.status];
                const Icon = s.icon;
                return (
                  <li
                    key={f.name}
                    className={`rounded-xl border p-3 transition ${
                      f.active
                        ? "border-primary bg-primary/10"
                        : f.status === "erro"
                          ? "border-destructive/40 bg-destructive/5 hover:border-destructive"
                          : "border-border bg-card/60 hover:border-primary/60 hover:bg-primary/5"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        defaultChecked={f.selected}
                        className="size-4 shrink-0 accent-[oklch(0.74_0.15_168)]"
                      />
                      {f.type === "pdf" ? (
                        <FileText className="size-4 shrink-0 text-accent" />
                      ) : (
                        <ImageIcon className="size-4 shrink-0 text-warning" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 pl-6">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}
                      >
                        <Icon
                          className={`size-3 ${f.status === "processando" ? "animate-spin" : ""}`}
                        />
                        {s.label}
                      </span>
                    </div>
                    {f.status === "processando" && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="progress-stripes h-full rounded-full"
                          style={{ width: `${f.progress}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-7">
            <div className="surface rounded-2xl border border-border/70 p-4">
              <h2 className="mb-3 text-sm font-semibold">Pré-visualização</h2>
              <div
                id="preview-image"
                className="grid h-72 place-items-center rounded-xl border border-border bg-muted/40"
              >
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FileText className="size-10" />
                  <span className="text-xs">nf_scan_0912.pdf — página 1 de 1</span>
                </div>
              </div>
            </div>

            <div className="surface rounded-2xl border border-border/70 p-4">
              <h3 className="mb-2 text-sm font-semibold">Texto bruto extraído (OCR)</h3>
              <textarea
                id="preview-text"
                readOnly
                rows={9}
                defaultValue={ocrText}
                className="w-full resize-none rounded-xl border border-border bg-input/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground outline-none"
              />
            </div>

            <div className="surface rounded-2xl border border-border/70 p-4">
              <h3 className="mb-3 text-sm font-semibold">Campos extraídos</h3>
              <div
                id="preview-fields"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
              >
                {extracted.map((f) => (
                  <div
                    key={f.label}
                    className="rounded-xl border border-border bg-card/60 p-3 transition hover:border-primary/60"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface rounded-2xl border border-border/70 p-4">
              <label htmlFor="preview-filename" className="text-sm font-semibold">
                Nome do arquivo gerado
              </label>
              <div className="mt-2 flex items-stretch rounded-xl border border-border bg-input/60 transition focus-within:border-primary focus-within:shadow-[var(--shadow-glow)]">
                <input
                  id="preview-filename"
                  defaultValue="NF_000912447_12-03-2026_AURORA-DISTRIBUIDORA"
                  className="min-w-0 flex-1 bg-transparent px-4 py-3 font-mono text-sm outline-none"
                />
                <span className="grid place-items-center rounded-r-xl border-l border-border bg-muted px-4 font-mono text-sm text-muted-foreground">
                  .pdf
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Zona 4 */}
      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3 px-5 py-3">
          <span className="mr-auto text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">3</span> arquivos selecionados
          </span>
          <button
            id="btn-download-selected"
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
          >
            <Download className="size-4" />
            Baixar selecionados
          </button>
          <button
            id="btn-download-zip"
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:brightness-110"
          >
            <FileArchive className="size-4" />
            Baixar todos como ZIP
          </button>
        </div>
      </footer>
    </div>
  );
}
