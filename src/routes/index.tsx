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
  FolderOpen,
  X,
  RefreshCw,
  Sparkles,
  FileCheck2,
  BookOpen,
  Type,
  MousePointerClick,
  Database,
  Save,
  Eye,
  LogOut,
  FileDown,
  CalendarDays,
  Search,
  Pencil,
  Check,
  Trash2,
} from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { saveNF, listNFs, updateNF, deleteNF, storageUrl, fmtDate, listSavedReports, reportStorageUrl, triggerWeeklyReport, type NFRecord, type NFReport } from "../lib/nf-storage";
import { getWeekOptions } from "../lib/weekly-report";
import { signOut, getUserEmail } from "../lib/auth";

// ---- Types ----

type NFFields = {
  numero?: string;
  data?: string;
  destinatario?: string;
  cnpj?: string;
  valor?: string;
};

type Status = "aguardando" | "processando" | "concluido" | "erro";

type NFFile = {
  id: string;
  file: File;
  ext: string;
  type: "pdf" | "img";
  status: Status;
  selected: boolean;
  progress: number;
  ocrText: string;
  fields: NFFields;
  confidence?: number;
  customName?: string | undefined;
  previewUrl: string;
  errorMsg?: string;
  note?: string | undefined;
};

// ---- NF Field Parser ----

// Tolera espaços/pontuação que o OCR insere entre os grupos do CNPJ e
// normaliza para XX.XXX.XXX/XXXX-XX.
const CNPJ_RX = /(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})/;

function normalizeCnpj(raw: string): string | undefined {
  const m = raw.match(CNPJ_RX);
  if (!m) return undefined;
  return `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}`;
}

function parseNFFields(text: string): NFFields {
  const fields: NFFields = {};

  // CNPJ do DESTINATÁRIO tem prioridade: rótulo "CPF/CNPJ: <numero>"
  const destCnpj = text.match(
    /CPF\/?CNPJ\s*:?\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/i,
  )?.[1];
  const cnpj = destCnpj ? normalizeCnpj(destCnpj) : normalizeCnpj(text);
  if (cnpj) fields.cnpj = cnpj;

  const numPatterns = [
    /N[Oo°º]\.?\s*(\d{3}[\d.]{0,9})/,
    /NÚMERO\s*:?\s*(\d{3,15})/i,
    /NF-?e?\s*[nN][oO°º]?\s*(\d{3,15})/,
  ];
  for (const rx of numPatterns) {
    const num = text.match(rx)?.[1];
    if (num) {
      fields.numero = num.replace(/\./g, "");
      break;
    }
  }

  const dataStr = text.match(/(\d{2}[/-]\d{2}[/-]\d{4})/)?.[1];
  if (dataStr) fields.data = dataStr.replace(/-/g, "/");

  const valorRx = [
    /VALOR TOTAL[^R\d\n]{0,30}R?\$?\s*([\d.,]+)/i,
    /TOTAL A PAGAR[^R\d\n]{0,30}R?\$?\s*([\d.,]+)/i,
    /TOTAL NF[^R\d\n]{0,30}R?\$?\s*([\d.,]+)/i,
  ];
  for (const rx of valorRx) {
    const v = text.match(rx)?.[1];
    if (v) {
      fields.valor = `R$ ${v}`;
      break;
    }
  }
  if (!fields.valor) {
    // Fallback robusto (texto embaralhado do OCR em nuvem): pega o maior
    // token no formato de moeda BR (1.234,56) — o total costuma ser o maior.
    const tokens = [...text.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map((m) => m[0]);
    const toNumber = (t: string) => parseFloat(t.replace(/\./g, "").replace(",", "."));
    const max = tokens.sort((a, b) => toNumber(b) - toNumber(a))[0];
    if (max) fields.valor = `R$ ${max}`;
  }

  // Nome do DESTINATÁRIO: rótulo "DESTINATÁRIO: <nome>" até vírgula/CIDADE/traço
  const dest = text.match(/DESTINAT[ÁA]RIO\s*:?\s*(.+?)(?=\s*,|\s+CIDADE|\s*[-–]\s|\n|$)/i);
  if (dest?.[1]) {
    fields.destinatario = dest[1].replace(/\s+/g, " ").trim();
  }

  return fields;
}

// ---- Filename Builder ----

function sanitize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function buildName(pattern: string, fields: NFFields, ext: string): string {
  const values: Record<string, string | undefined> = {
    NUMERO: fields.numero,
    DATA: fields.data?.replace(/\//g, "-"),
    DESTINATARIO: fields.destinatario,
    CNPJ: fields.cnpj,
    VALOR: fields.valor,
  };
  const base = pattern.replace(/\{([A-Z_]+)\}/g, (_m, token: string) =>
    values[token] ? sanitize(values[token]!) : `_${token}_`,
  );
  return `${base.replace(/-+/g, "-").replace(/_+/g, "_")}.${ext}`;
}

// ---- OCR Processing ----

type OcrResult = { ocrText: string; previewUrl: string; confidence: number };

async function ocrImage(file: File, onProgress: (n: number) => void): Promise<OcrResult> {
  const { ocrImageBlob } = await import("../lib/ocr");
  const r = await ocrImageBlob(file, onProgress);
  return { ocrText: r.text, previewUrl: r.previewUrl, confidence: r.confidence };
}

async function ocrPDF(file: File, onProgress: (n: number) => void): Promise<OcrResult> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
  }

  const ab = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: ab }).promise;
  onProgress(8);

  // Texto embutido primeiro (PDF nativo — orientação correta, sem OCR)
  let embeddedText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    embeddedText +=
      tc.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ") + "\n";
  }
  onProgress(30);

  // Renderiza página 1 para preview
  const page1 = await pdf.getPage(1);
  const vp = page1.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page1.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
  let previewUrl = canvas.toDataURL("image/jpeg", 0.85);

  const ocrText = embeddedText.trim();

  // PDF escaneado (sem texto embutido): OCR com correção de orientação
  if (ocrText.replace(/\s/g, "").length < 80) {
    const { recognizeCanvas } = await import("../lib/ocr");
    let allText = "";
    let confSum = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const v = pg.getViewport({ scale: 2.5 });
      const c = document.createElement("canvas");
      c.width = v.width;
      c.height = v.height;
      await pg.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: v }).promise;
      const r = await recognizeCanvas(
        c,
        (n) => onProgress(30 + Math.round(((i - 1 + n / 100) / pdf.numPages) * 65)),
        true,
      );
      allText += r.text + "\n";
      confSum += r.confidence;
      if (i === 1) previewUrl = r.previewUrl;
    }
    onProgress(100);
    return { ocrText: allText, previewUrl, confidence: Math.round(confSum / pdf.numPages) };
  }

  onProgress(100);
  return { ocrText, previewUrl, confidence: 100 };
}

// ---- Component ----

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NF Wizard — Renomeie notas fiscais com OCR" },
      {
        name: "description",
        content:
          "Importe imagens e PDFs de notas fiscais, extraia os dados por OCR e baixe os arquivos renomeados.",
      },
      { property: "og:title", content: "NF Wizard — Renomeie notas fiscais com OCR" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// Mude para true para reativar o seletor de campos no nome do arquivo.
const PATTERN_UI_ENABLED = false;

const FIELD_OPTIONS = [
  { token: "{NUMERO}", label: "Número NF" },
  { token: "{DATA}", label: "Data" },
  { token: "{DESTINATARIO}", label: "Destinatário" },
  { token: "{CNPJ}", label: "CNPJ" },
  { token: "{VALOR}", label: "Valor Total" },
] as const;

const FAKE_FIELDS: NFFields = {
  numero: "000123",
  data: "15/08/2026",
  destinatario: "EMPRESA SA LTDA",
  cnpj: "12.345.678/0001-90",
  valor: "R$ 1.500,00",
};

const statusConfig: Record<Status, { label: string; className: string; icon: typeof Clock }> = {
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

// ---- Manual / Instruções ----

function ManualModal({ onClose, pattern }: { onClose: () => void; pattern: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const steps = [
    {
      icon: Type,
      title: "1. Escolha como salvar",
      body: (
        <>
          Em <strong>Como salvar o arquivo?</strong>, clique nos campos (Número NF, Data,
          Destinatário…) para montar o nome. A ordem dos cliques é a ordem no nome. A prévia
          mostra exatamente como vai ficar.
        </>
      ),
    },
    {
      icon: FolderOpen,
      title: "2. Escolha a pasta (opcional)",
      body: (
        <>
          Só no <strong>Chrome</strong> ou <strong>Edge</strong>. Selecionada, os arquivos salvam
          direto nela. Sem pasta, baixam pelo navegador normal.
        </>
      ),
    },
    {
      icon: UploadCloud,
      title: "3. Importe as notas",
      body: (
        <>
          Arraste ou clique na área de upload. Aceita JPG, PNG e PDF — vários de uma vez. Fotos{" "}
          <strong>retas, nítidas e bem iluminadas</strong> (sem sombra) leem muito melhor. Papel
          girado é corrigido sozinho.
        </>
      ),
    },
    {
      icon: ScanLine,
      title: "4. OCR automático",
      body: (
        <>
          O texto é lido e os campos (número, data, destinatário, CNPJ, valor) preenchem sozinhos
          automaticamente via OCR em nuvem de alta precisão.
        </>
      ),
    },
    {
      icon: MousePointerClick,
      title: "5. Confira e ajuste",
      body: (
        <>
          Clique num arquivo pra ver o texto. <strong>Edite qualquer campo</strong> (número, data,
          destinatário…) e o nome se refaz sozinho. O selo mostra a confiança da leitura.
        </>
      ),
    },
    {
      icon: FileArchive,
      title: "6. Baixe",
      body: (
        <>
          Um por vez, os <strong>selecionados</strong>, ou <strong>todos como ZIP</strong> — botões
          na barra de baixo. Já saem com o nome novo.
        </>
      ),
    },
  ];

  return (
    <div
      onClick={onClose}
      className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-pop surface flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[var(--shadow-glow)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
              <BookOpen className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight">Como usar o NF Wizard</h2>
              <p className="text-xs text-muted-foreground">Renomeie notas fiscais em 6 passos</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-3 overflow-y-auto p-5">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.title}
                className="flex gap-3 rounded-xl border border-border bg-card/60 p-3.5 transition hover:border-primary/50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </div>
            );
          })}

          {/* Nota */}
          <div className="flex gap-2.5 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-foreground">
              O OCR é processado em nuvem para <strong>máxima precisão</strong>. A imagem da nota é
              enviada ao serviço e o texto retorna em segundos.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border/60 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="brand-gradient inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:brightness-110"
          >
            Entendi, começar
          </button>
        </div>
      </div>
    </div>
  );
}

function Index() {
  const [nfFiles, setNfFiles] = useState<NFFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTokens, setActiveTokens] = useState<string[]>(["{NUMERO}", "{DATA}", "{DESTINATARIO}"]);
  const [outputDir, setOutputDir] = useState<FileSystemDirectoryHandle | null>(null);
  const outputDirName = outputDir?.name ?? "";
  const [isDragging, setIsDragging] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showAllNFs, setShowAllNFs] = useState(false);
  const [allNFs, setAllNFs] = useState<NFRecord[]>([]);
  const [loadingNFs, setLoadingNFs] = useState(false);
  const [saveStates, setSaveStates] = useState<Record<string, "saving" | "saved" | "duplicate" | "error">>({});
  const [showReport, setShowReport] = useState(false);
  const [selectedWeekIdx, setSelectedWeekIdx] = useState(0);
  const [reportState, setReportState] = useState<"idle" | "generating">("idle");
  const [reportProgress, setReportProgress] = useState(0);
  const [weekNFCount, setWeekNFCount] = useState<number | null>(null);
  const [savedReports, setSavedReports] = useState<NFReport[]>([]);
  const [loadingSavedReports, setLoadingSavedReports] = useState(false);
  const [nfSearch, setNfSearch] = useState("");
  const [editingNFId, setEditingNFId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<NFRecord>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const pattern = PATTERN_UI_ENABLED
    ? activeTokens.length > 0
      ? `NF_${activeTokens.join("_")}`
      : "NF_{NUMERO}"
    : "NF_{NUMERO}";
  const examplePreview = buildName(pattern, FAKE_FIELDS, "pdf");

  const activeFile = nfFiles.find((f) => f.id === activeId) ?? nfFiles[0] ?? null;
  const selectedCount = nfFiles.filter((f) => f.selected).length;

  const getDisplayName = useCallback(
    (f: NFFile) => f.customName ?? buildName(pattern, f.fields, f.ext),
    [pattern],
  );

  const patch = useCallback(
    (id: string, p: Partial<NFFile>) =>
      setNfFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f))),
    [],
  );

  const resetName = useCallback(
    (id: string) =>
      setNfFiles((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          const { customName: _drop, ...rest } = f;
          return rest;
        }),
      ),
    [],
  );

  const processFile = useCallback(
    async (file: File) => {
      const id = crypto.randomUUID();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isImage = ["jpg", "jpeg", "png"].includes(ext);

      const entry: NFFile = {
        id,
        file,
        ext,
        type: isImage ? "img" : "pdf",
        status: "aguardando",
        selected: true,
        progress: 0,
        ocrText: "",
        fields: {},
        previewUrl: "",
      };

      setNfFiles((prev) => [...prev, entry]);
      setActiveId(id);

      const update = (p: Partial<NFFile>) =>
        setNfFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

      update({ status: "processando" });

      try {
        const onProg = (n: number) => update({ progress: n });
        let ocrText: string;
        let previewUrl: string;
        let confidence: number | undefined;

        if (isImage) {
          try {
            const { ocrCloud } = await import("../lib/ocr-cloud");
            const { getOcrApiKey } = await import("../lib/supabase-config");
            const key = await getOcrApiKey();
            const r = await ocrCloud(file, key, onProg);
            ocrText = r.text;
            previewUrl = r.previewUrl;
            confidence = 96;
          } catch (cloudErr) {
            const msg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
            throw new Error(`OCR em nuvem falhou: ${msg}.`);
          }
        } else {
          const r = isImage ? await ocrImage(file, onProg) : await ocrPDF(file, onProg);
          ocrText = r.ocrText;
          previewUrl = r.previewUrl;
          confidence = r.confidence;
        }

        const fields = parseNFFields(ocrText);
        update({
          status: "concluido",
          progress: 100,
          ocrText,
          fields,
          previewUrl,
          confidence,
        });
      } catch (err) {
        update({
          status: "erro",
          errorMsg: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      Array.from(list).forEach((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        if (["pdf", "jpg", "jpeg", "png"].includes(ext)) processFile(f);
      });
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // ---- Folder selection ----

  const selectOutputFolder = async () => {
    if (!("showDirectoryPicker" in window)) {
      alert(
        "Seu navegador não suporta seleção de pasta diretamente.\nUse Chrome ou Edge para esta funcionalidade.\nOs arquivos serão baixados normalmente pelo navegador.",
      );
      return;
    }
    try {
      const handle = await (
        window as Window & {
          showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ mode: "readwrite" });
      setOutputDir(handle);
    } catch {
      // user cancelled — mantém estado atual
    }
  };

  const clearOutputFolder = () => {
    setOutputDir(null);
  };

  // ---- Downloads ----

  const downloadOne = async (nfFile: NFFile) => {
    const name = getDisplayName(nfFile);
    if (outputDir) {
      try {
        const fh = await outputDir.getFileHandle(name, { create: true });
        const wr = await fh.createWritable();
        await wr.write(nfFile.file);
        await wr.close();
        return;
      } catch (err) {
        console.error("Erro ao salvar na pasta:", err);
      }
    }
    // Fallback: browser download
    const url = URL.createObjectURL(nfFile.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSelected = async () => {
    const ready = nfFiles.filter((f) => f.selected && f.status === "concluido");
    for (const f of ready) await downloadOne(f);
  };

  const downloadAllZip = async () => {
    const ready = nfFiles.filter((f) => f.status === "concluido");
    if (!ready.length) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const f of ready) zip.file(getDisplayName(f), f.file);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nf-wizard.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Salvar no banco ----

  const handleSave = useCallback(async (nfFile: NFFile) => {
    if (nfFile.status !== "concluido") return;
    setSaveStates((prev) => ({ ...prev, [nfFile.id]: "saving" }));
    const name = getDisplayName(nfFile);
    const result = await saveNF(nfFile.file, nfFile.fields, name);
    if (result.ok) {
      setSaveStates((prev) => ({ ...prev, [nfFile.id]: "saved" }));
    } else if (result.duplicate) {
      setSaveStates((prev) => ({ ...prev, [nfFile.id]: "duplicate" }));
    } else {
      setSaveStates((prev) => ({ ...prev, [nfFile.id]: "error" }));
    }
  }, [getDisplayName]);

  const openAllNFs = useCallback(async () => {
    setShowAllNFs(true);
    setNfSearch("");
    setEditingNFId(null);
    setLoadingNFs(true);
    const records = await listNFs();
    setAllNFs(records);
    setLoadingNFs(false);
  }, []);

  const filteredNFs = nfSearch.trim()
    ? allNFs.filter((nf) => {
        const q = nfSearch.toLowerCase();
        return (
          (nf.nf_numero ?? "").toLowerCase().includes(q) ||
          (nf.nf_destinatario ?? "").toLowerCase().includes(q) ||
          (nf.nf_cnpj ?? "").toLowerCase().includes(q) ||
          (nf.nf_valor ?? "").toLowerCase().includes(q) ||
          (nf.file_name ?? "").toLowerCase().includes(q)
        );
      })
    : allNFs;

  const startEditNF = useCallback((nf: NFRecord) => {
    setEditingNFId(nf.id);
    setEditFields({
      nf_numero: nf.nf_numero ?? "",
      nf_destinatario: nf.nf_destinatario ?? "",
      nf_cnpj: nf.nf_cnpj ?? "",
      nf_valor: nf.nf_valor ?? "",
      file_name: nf.file_name ?? "",
    });
  }, []);

  const saveEditNF = useCallback(async () => {
    if (!editingNFId) return;
    setSavingEdit(true);
    const currentNF = allNFs.find((n) => n.id === editingNFId);
    const ext = (currentNF?.file_name ?? "pdf").split(".").pop()?.toLowerCase() ?? "pdf";
    const editNFFields: NFFields = {};
    if (editFields.nf_numero) editNFFields.numero = editFields.nf_numero;
    if (currentNF?.nf_data) editNFFields.data = currentNF.nf_data;
    if (editFields.nf_destinatario) editNFFields.destinatario = editFields.nf_destinatario;
    if (editFields.nf_cnpj) editNFFields.cnpj = editFields.nf_cnpj;
    if (editFields.nf_valor) editNFFields.valor = editFields.nf_valor;
    const rebuiltName = buildName(pattern, editNFFields, ext);
    const finalFields = { ...editFields, file_name: rebuiltName };
    const ok = await updateNF(editingNFId, finalFields);
    if (ok) {
      setAllNFs((prev) =>
        prev.map((nf) => (nf.id === editingNFId ? { ...nf, ...finalFields } : nf)),
      );
      setEditingNFId(null);
    }
    setSavingEdit(false);
  }, [editingNFId, editFields, allNFs, pattern]);

  const handleDeleteNF = useCallback(async (nf: NFRecord) => {
    const ok = await deleteNF(nf.id, nf.storage_path);
    if (ok) {
      setAllNFs((prev) => prev.filter((n) => n.id !== nf.id));
      if (editingNFId === nf.id) setEditingNFId(null);
    }
  }, [editingNFId]);

  // Quando modal de relatório abre: carrega relatórios salvos + contagem da semana
  useEffect(() => {
    if (!showReport) return;
    // Carrega lista de relatórios salvos
    setLoadingSavedReports(true);
    listSavedReports().then((r) => { setSavedReports(r); setLoadingSavedReports(false); });
  }, [showReport]);

  // Contagem de NFs da semana selecionada
  useEffect(() => {
    if (!showReport) return;
    setWeekNFCount(null);
    const weeks = getWeekOptions();
    const week = weeks[selectedWeekIdx];
    if (!week) return;
    let cancelled = false;
    import("../lib/weekly-report").then(({ fetchWeekNFCount }) =>
      fetchWeekNFCount(week.start, week.end).then((n) => { if (!cancelled) setWeekNFCount(n); })
    );
    return () => { cancelled = true; };
  }, [showReport, selectedWeekIdx]);

  const handleGenerateReport = useCallback(async () => {
    const weeks = getWeekOptions();
    const week = weeks[selectedWeekIdx];
    if (!week) return;
    setReportState("generating");
    setReportProgress(0);

    // Simula progresso enquanto a Edge Function processa
    const fakeProgress = setInterval(() => {
      setReportProgress((p) => (p < 88 ? p + 3 : p));
    }, 800);

    try {
      // Formata week_start como YYYY-MM-DD para a Edge Function
      const weekStartStr = week.start.toISOString().split("T")[0]!;
      const result = await triggerWeeklyReport(weekStartStr);

      clearInterval(fakeProgress);
      setReportProgress(100);

      if (!result.ok) {
        alert(`Erro ao gerar relatório: ${result.error}`);
        setReportState("idle");
        setReportProgress(0);
        return;
      }

      // Baixa o PDF do Storage
      if (result.storage_path) {
        const url = reportStorageUrl(result.storage_path);
        const a = document.createElement("a");
        a.href = url;
        a.download = `NF_Wizard_Relatorio_${weekStartStr}.pdf`;
        a.target = "_blank";
        a.click();
      }

      // Recarrega lista de relatórios salvos
      setSavedReports(await listSavedReports());
    } catch (err) {
      clearInterval(fakeProgress);
      alert(`Erro inesperado: ${err instanceof Error ? err.message : String(err)}`);
    }

    setReportState("idle");
    setReportProgress(0);
  }, [selectedWeekIdx]);

  // ---- Active file helpers ----

  const activeExt = activeFile?.ext ?? "";
  const displayName = activeFile ? getDisplayName(activeFile) : "";
  const displayBase = displayName.endsWith(`.${activeExt}`)
    ? displayName.slice(0, -(activeExt.length + 1))
    : displayName;

  const extractedFields: { key: keyof NFFields; label: string; value?: string | undefined }[] =
    activeFile
      ? [
          { key: "numero", label: "Número NF", value: activeFile.fields.numero },
          { key: "data", label: "Data", value: activeFile.fields.data },
          { key: "destinatario", label: "Destinatário", value: activeFile.fields.destinatario },
          { key: "cnpj", label: "CNPJ", value: activeFile.fields.cnpj },
          { key: "valor", label: "Valor Total", value: activeFile.fields.valor },
        ]
      : [];

  const setField = (id: string, key: keyof NFFields, value: string) =>
    setNfFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, fields: { ...f.fields, [key]: value } } : f)),
    );

  // ---- Render ----

  return (
    <div className="min-h-screen pb-28">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3.5">
          <img
            src="/brand/varremaster-full.png"
            alt="Varremaster"
            className="h-9 w-auto shrink-0 select-none"
            draggable={false}
          />
          <span className="hidden h-9 w-px bg-border sm:block" />
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
            <ScanLine className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="brand-text text-lg font-bold tracking-tight">NF Wizard</h1>
            <p className="truncate text-xs text-muted-foreground">
              OCR de notas fiscais e renomeação automática de arquivos
            </p>
          </div>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary lg:inline-flex">
            <Sparkles className="size-3.5" />
            OCR em nuvem — alta precisão
          </span>
          <button
            type="button"
            onClick={openAllNFs}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-sm font-medium text-primary transition hover:bg-primary/20 lg:ml-0"
          >
            <Database className="size-4" />
            <span className="hidden sm:inline">Todas NFs</span>
          </button>
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3.5 py-2 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
          >
            <FileDown className="size-4" />
            <span className="hidden sm:inline">Relatório</span>
          </button>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3.5 py-2 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
          >
            <BookOpen className="size-4" />
            <span className="hidden sm:inline">Manual</span>
          </button>
          <button
            type="button"
            title={`Sair (${getUserEmail()})`}
            onClick={async () => { await signOut(); window.location.reload(); }}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {showManual && <ManualModal onClose={() => setShowManual(false)} pattern={pattern} />}

      {/* Modal — Todas NFs */}
      {showAllNFs && (
        <div
          onClick={() => { setShowAllNFs(false); setEditingNFId(null); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="surface flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[var(--shadow-glow)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
                  <Database className="size-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Todas as Notas Fiscais</h2>
                  <p className="text-xs text-muted-foreground">
                    {loadingNFs ? "Carregando…" : `${allNFs.length} nota${allNFs.length !== 1 ? "s" : ""} salva${allNFs.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowAllNFs(false); setEditingNFId(null); }}
                className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Barra de pesquisa */}
            {!loadingNFs && allNFs.length > 0 && (
              <div className="border-b border-border/60 px-5 py-3">
                <div className="flex items-center gap-2.5 rounded-xl border border-border bg-input/60 px-3 py-2 transition focus-within:border-primary">
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    value={nfSearch}
                    onChange={(e) => setNfSearch(e.target.value)}
                    placeholder="Pesquisar por número, destinatário, CNPJ, valor…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  {nfSearch && (
                    <button
                      type="button"
                      onClick={() => setNfSearch("")}
                      className="text-muted-foreground transition hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                {nfSearch.trim() && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {filteredNFs.length} resultado{filteredNFs.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {/* Lista */}
            <div className="flex flex-col gap-2 overflow-y-auto p-4">
              {loadingNFs && (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              )}
              {!loadingNFs && allNFs.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Database className="size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhuma nota fiscal salva ainda.</p>
                </div>
              )}
              {!loadingNFs && filteredNFs.length === 0 && allNFs.length > 0 && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Search className="size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhum resultado para "{nfSearch}"</p>
                </div>
              )}
              {!loadingNFs && filteredNFs.map((nf) => {
                const isPdf = nf.storage_path?.endsWith(".pdf");
                const isEditing = editingNFId === nf.id;
                return (
                  <div
                    key={nf.id}
                    className={`rounded-xl border p-3 transition ${isEditing ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:border-primary/50"}`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Thumbnail */}
                      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                        {nf.storage_path && !isPdf ? (
                          <img
                            src={storageUrl(nf.storage_path)}
                            alt="NF"
                            className="size-full object-cover"
                          />
                        ) : (
                          <FileText className="size-7 text-accent" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-bold text-foreground">
                            NF {nf.nf_numero ?? "—"}
                          </span>
                          {nf.nf_valor && (
                            <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                              {nf.nf_valor}
                            </span>
                          )}
                        </div>
                        {nf.nf_destinatario && (
                          <p className="truncate text-xs text-muted-foreground">{nf.nf_destinatario}</p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                          {fmtDate(nf.created_at)} · {nf.file_name}
                        </p>
                      </div>

                      {/* Ações */}
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          title={isEditing ? "Cancelar edição" : "Editar campos"}
                          onClick={() => {
                            if (isEditing) {
                              setEditingNFId(null);
                            } else {
                              startEditNF(nf);
                            }
                          }}
                          className={`grid size-9 place-items-center rounded-xl border transition ${
                            isEditing
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border bg-secondary text-muted-foreground hover:border-primary hover:text-primary"
                          }`}
                        >
                          <Pencil className="size-4" />
                        </button>
                        {nf.storage_path && (
                          <>
                            <a
                              href={storageUrl(nf.storage_path)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Visualizar imagem"
                              className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-primary hover:text-primary"
                            >
                              <Eye className="size-4" />
                            </a>
                            <button
                              type="button"
                              title="Baixar imagem"
                              onClick={async () => {
                                const res = await fetch(storageUrl(nf.storage_path!));
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = nf.file_name;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-primary hover:text-primary"
                            >
                              <Download className="size-4" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          title="Excluir nota fiscal"
                          onClick={() => {
                            if (window.confirm(`Excluir NF ${nf.nf_numero ?? nf.file_name}? Esta ação não pode ser desfeita.`)) {
                              handleDeleteNF(nf);
                            }
                          }}
                          className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>

                    {/* Formulário de edição inline */}
                    {isEditing && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                          {[
                            { key: "nf_numero" as const, label: "Número NF" },
                            { key: "nf_destinatario" as const, label: "Destinatário" },
                            { key: "nf_cnpj" as const, label: "CNPJ" },
                            { key: "nf_valor" as const, label: "Valor" },
                          ].map((field) => (
                            <div key={field.key} className="rounded-lg border border-border bg-card/80 p-2 transition focus-within:border-primary">
                              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {field.label}
                              </label>
                              <input
                                value={(editFields[field.key] as string) ?? ""}
                                onChange={(e) =>
                                  setEditFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                                }
                                placeholder="não identificado"
                                className="mt-0.5 w-full bg-transparent text-xs font-medium text-foreground outline-none placeholder:font-normal placeholder:italic placeholder:text-muted-foreground"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <p className="min-w-0 truncate font-mono text-[11px] text-foreground">
                            {(() => {
                              const f: NFFields = {};
                              if (editFields.nf_numero) f.numero = editFields.nf_numero;
                              if (nf.nf_data) f.data = nf.nf_data;
                              if (editFields.nf_destinatario) f.destinatario = editFields.nf_destinatario;
                              if (editFields.nf_cnpj) f.cnpj = editFields.nf_cnpj;
                              if (editFields.nf_valor) f.valor = editFields.nf_valor;
                              return buildName(pattern, f, (nf.file_name ?? "pdf").split(".").pop()?.toLowerCase() ?? "pdf");
                            })()}
                          </p>
                        </div>
                        <div className="mt-2.5 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingNFId(null)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-foreground hover:text-foreground"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={saveEditNF}
                            disabled={savingEdit}
                            className="brand-gradient inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
                          >
                            {savingEdit ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Check className="size-3" />
                            )}
                            Salvar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal — Relatório Semanal */}
      {showReport && (
        <div
          onClick={() => { if (reportState !== "generating") setShowReport(false); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="surface flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[var(--shadow-glow)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
                  <FileDown className="size-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Relatório Semanal em PDF</h2>
                  <p className="text-xs text-muted-foreground">
                    Exporta todas as notas fiscais da semana
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { if (reportState !== "generating") setShowReport(false); }}
                disabled={reportState === "generating"}
                className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Corpo */}
            <div className="flex flex-col gap-5 p-5">
              {/* Seletor de semana */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Semana
                  </label>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-all ${
                    weekNFCount === null
                      ? "bg-muted text-muted-foreground"
                      : weekNFCount > 0
                        ? "bg-primary/12 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {weekNFCount === null ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        contando…
                      </span>
                    ) : (
                      `${weekNFCount} nota${weekNFCount !== 1 ? "s" : ""} nesta semana`
                    )}
                  </span>
                </div>
                <select
                  value={selectedWeekIdx}
                  onChange={(e) => setSelectedWeekIdx(Number(e.target.value))}
                  disabled={reportState === "generating"}
                  className="w-full rounded-xl border border-border bg-input/60 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-50"
                >
                  {getWeekOptions().map((w, i) => (
                    <option key={i} value={i}>{w.label}</option>
                  ))}
                </select>
              </div>

              {/* Info */}
              {weekNFCount !== null && weekNFCount > 0 && reportState === "idle" && (
                <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-foreground">
                    O relatório incluirá <strong>{weekNFCount} nota{weekNFCount !== 1 ? "s" : ""} fiscal{weekNFCount !== 1 ? "is" : ""}</strong> com capa, tabela-resumo e uma página por NF com imagem.
                  </p>
                </div>
              )}

              {weekNFCount === 0 && reportState === "idle" && (
                <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Nenhuma nota fiscal encontrada nessa semana. Selecione outra semana.
                  </p>
                </div>
              )}

              {/* Barra de progresso */}
              {reportState === "generating" && (
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Gerando PDF…</span>
                    <span className="font-semibold text-primary">{reportProgress}%</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="progress-stripes h-full rounded-full transition-all duration-300"
                      style={{ width: `${reportProgress}%` }}
                    />
                  </div>
                  <p className="text-center text-[11px] text-muted-foreground">
                    Aguarde — embutindo imagens das notas…
                  </p>
                </div>
              )}

              {/* Botão */}
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={reportState === "generating" || weekNFCount === 0 || weekNFCount === null}
                className="brand-gradient inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reportState === "generating" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Gerando relatório…
                  </>
                ) : (
                  <>
                    <FileDown className="size-4" />
                    Gerar, salvar e baixar PDF
                  </>
                )}
              </button>

              {/* Lista de relatórios salvos */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Relatórios gerados automaticamente
                  </p>
                  {loadingSavedReports && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                </div>

                {!loadingSavedReports && savedReports.length === 0 && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                    <CalendarDays className="size-4 shrink-0 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      Nenhum relatório salvo ainda. O sistema gera automaticamente toda segunda-feira.
                    </p>
                  </div>
                )}

                <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
                  {savedReports.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5 transition hover:border-primary/40"
                    >
                      <FileDown className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">{r.week_label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.nf_count} nota{r.nf_count !== 1 ? "s" : ""}
                          {r.total_valor ? ` · ${r.total_valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}
                          {" · "}{fmtDate(r.created_at)}
                        </p>
                      </div>
                      <a
                        href={reportStorageUrl(r.storage_path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground transition hover:border-primary hover:text-primary"
                        title="Baixar PDF"
                      >
                        <Download className="size-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6">
        {/* Zona 1 — Como salvar (oculto quando PATTERN_UI_ENABLED = false) */}
        {PATTERN_UI_ENABLED && <section className="surface animate-rise rounded-2xl border border-border/70 p-5">
          <p className="text-sm font-medium text-foreground">Como salvar o arquivo?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Clique para adicionar campos ao nome. A ordem que você clicar é a ordem no arquivo.
          </p>

          {/* Chips disponíveis */}
          <div className="mt-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Campos disponíveis
            </p>
            <div className="flex flex-wrap gap-2">
              {FIELD_OPTIONS.filter((f) => !activeTokens.includes(f.token)).map((f) => (
                <button
                  key={f.token}
                  type="button"
                  onClick={() => setActiveTokens((prev) => [...prev, f.token])}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  <span className="text-primary">+</span>
                  {f.label}
                </button>
              ))}
              {FIELD_OPTIONS.every((f) => activeTokens.includes(f.token)) && (
                <span className="text-xs italic text-muted-foreground">Todos os campos adicionados</span>
              )}
            </div>
          </div>

          {/* Chips ativos (em ordem) */}
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Nome do arquivo — em ordem
            </p>
            {activeTokens.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                Nenhum campo selecionado — clique acima para adicionar.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  NF
                </span>
                {activeTokens.map((token, idx) => {
                  const f = FIELD_OPTIONS.find((x) => x.token === token)!;
                  return (
                    <span
                      key={token}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
                    >
                      <span className="text-muted-foreground">{idx + 1}.</span>
                      {f.label}
                      <button
                        type="button"
                        title="Remover"
                        onClick={() => setActiveTokens((prev) => prev.filter((t) => t !== token))}
                        className="ml-0.5 rounded-full text-primary/60 transition hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Prévia do nome */}
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-3">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">Prévia do nome gerado:</p>
              <p className="truncate font-mono text-xs font-medium text-foreground">{examplePreview}</p>
            </div>
          </div>
        </section>}

        {/* Zona 1b — Pasta de destino */}
        <section
          className="surface animate-rise rounded-2xl border border-border/70 p-5"
          style={{ animationDelay: "60ms" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Local de salvamento</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {outputDirName
                  ? `Salvando em: ${outputDirName}`
                  : "Nenhum local selecionado — arquivos baixados pelo navegador"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {outputDirName && (
                <button
                  type="button"
                  onClick={clearOutputFolder}
                  title="Remover pasta"
                  className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={selectOutputFolder}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
              >
                <FolderOpen className="size-4" />
                {outputDirName ? "Alterar local" : "Selecionar local"}
              </button>
            </div>
          </div>
        </section>

        {/* Zona 2 — Upload */}
        <section className="animate-rise" style={{ animationDelay: "120ms" }}>
          <label
            htmlFor="file-input"
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`group surface flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all duration-300 ${
              isDragging
                ? "scale-[1.01] border-primary bg-primary/10 shadow-[var(--shadow-glow)]"
                : "border-border hover:border-primary hover:bg-primary/5"
            }`}
          >
            <span
              className={`grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/15 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 ${
                isDragging ? "animate-bounce" : ""
              }`}
            >
              <UploadCloud className="size-7" />
            </span>
            <span className="text-base font-medium">
              {isDragging ? "Solte para importar" : "Arraste arquivos aqui ou clique para importar"}
            </span>
            <span className="text-sm text-muted-foreground">
              Suporta JPG, PNG e PDF — múltiplos arquivos
            </span>
            <input
              id="file-input"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
          </label>
        </section>

        {/* Empty state */}
        {nfFiles.length === 0 && (
          <section className="animate-fade flex flex-col items-center gap-3 py-8 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-card shadow-[var(--shadow-soft)] ring-1 ring-border">
              <FileCheck2 className="size-8 text-primary/70" />
            </span>
            <p className="text-sm font-medium text-foreground">Nenhuma nota fiscal ainda</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Importe imagens ou PDFs acima. O texto é lido por OCR direto no seu navegador — nada é
              enviado a servidores.
            </p>
          </section>
        )}

        {/* Zona 3 — Lista + Preview */}
        {nfFiles.length > 0 && (
          <section className="animate-rise grid grid-cols-1 gap-5 lg:grid-cols-10">
            {/* Lista de arquivos */}
            <div className="surface rounded-2xl border border-border/70 p-4 lg:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Arquivos processados</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {nfFiles.length}
                </span>
              </div>
              <ul id="file-list" className="flex flex-col gap-2">
                {nfFiles.map((f) => {
                  const s = statusConfig[f.status];
                  const Icon = s.icon;
                  return (
                    <li
                      key={f.id}
                      onClick={() => setActiveId(f.id)}
                      className={`animate-pop cursor-pointer rounded-xl border p-3 transition-all duration-200 hover:shadow-[var(--shadow-soft)] ${
                        f.id === activeFile?.id
                          ? "border-primary bg-primary/10 ring-1 ring-primary/25"
                          : f.status === "erro"
                            ? "border-destructive/40 bg-destructive/5 hover:border-destructive"
                            : "border-border bg-card/60 hover:border-primary/60 hover:bg-primary/5"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={f.selected}
                          onChange={(e) => {
                            e.stopPropagation();
                            patch(f.id, { selected: !f.selected });
                          }}
                          className="size-4 shrink-0 accent-[oklch(0.74_0.15_168)]"
                        />
                        {f.type === "pdf" ? (
                          <FileText className="size-4 shrink-0 text-accent" />
                        ) : (
                          <ImageIcon className="size-4 shrink-0 text-warning" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs">{f.file.name}</span>
                        <button
                          type="button"
                          title="Remover arquivo"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNfFiles((prev) => {
                              const found = prev.find((x) => x.id === f.id);
                              if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
                              return prev.filter((x) => x.id !== f.id);
                            });
                            if (activeId === f.id) setActiveId(null);
                          }}
                          className="shrink-0 text-muted-foreground transition hover:text-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
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
                      {f.status === "erro" && f.errorMsg && (
                        <p className="mt-1 pl-6 text-[11px] text-destructive">{f.errorMsg}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Preview panel */}
            {activeFile && (
              <div className="flex flex-col gap-4 lg:col-span-7">
                {/* Preview de imagem/PDF */}
                <div className="surface rounded-2xl border border-border/70 p-4">
                  <h2 className="mb-3 text-sm font-semibold">Pré-visualização</h2>
                  <div
                    id="preview-image"
                    className="grid h-72 place-items-center overflow-hidden rounded-xl border border-border bg-muted/40"
                  >
                    {activeFile.previewUrl ? (
                      <img
                        src={activeFile.previewUrl}
                        alt="preview"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : activeFile.status === "processando" ? (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-8 animate-spin" />
                        <span className="text-xs">{activeFile.progress}% — processando OCR…</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText className="size-10" />
                        <span className="text-xs">{activeFile.file.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Texto OCR */}
                <div className="surface rounded-2xl border border-border/70 p-4">
                  <h3 className="mb-2 text-sm font-semibold">Texto bruto extraído (OCR)</h3>
                  <textarea
                    id="preview-text"
                    readOnly
                    rows={9}
                    value={
                      activeFile.ocrText ||
                      (activeFile.status === "processando"
                        ? "Extraindo texto…"
                        : (activeFile.errorMsg ?? "Sem texto extraído"))
                    }
                    className="w-full resize-none rounded-xl border border-border bg-input/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground outline-none"
                  />
                </div>

                {/* Campos extraídos */}
                <div className="surface rounded-2xl border border-border/70 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Campos extraídos</h3>
                      {activeFile.status === "concluido" &&
                        typeof activeFile.confidence === "number" && (
                          <span
                            title="Confiança da leitura OCR"
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              activeFile.confidence >= 70
                                ? "bg-success/15 text-success"
                                : activeFile.confidence >= 45
                                  ? "bg-warning/15 text-warning"
                                  : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {activeFile.confidence >= 70 ? (
                              <CheckCircle2 className="size-3" />
                            ) : (
                              <AlertTriangle className="size-3" />
                            )}
                            {activeFile.confidence}% leitura
                          </span>
                        )}
                    </div>
                    {activeFile.status === "concluido" && (
                      <button
                        type="button"
                        onClick={() => {
                          setNfFiles((prev) => {
                            const f = prev.find((x) => x.id === activeFile.id);
                            if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
                            return prev.filter((x) => x.id !== activeFile.id);
                          });
                          setActiveId(null);
                          processFile(activeFile.file);
                        }}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
                      >
                        <RefreshCw className="size-3" />
                        Re-processar
                      </button>
                    )}
                  </div>
                  {activeFile.note && (
                    <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                      {activeFile.note}
                    </p>
                  )}
                  {activeFile.status === "concluido" &&
                    typeof activeFile.confidence === "number" &&
                    activeFile.confidence < 45 && (
                      <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-foreground">
                        Leitura de baixa qualidade. Tente uma foto mais nítida, reta e bem
                        iluminada, sem sombra sobre o papel.
                      </p>
                    )}
                  <p className="mb-2 text-xs text-muted-foreground">
                    Confira e edite se o OCR errar — o nome do arquivo se atualiza sozinho.
                  </p>
                  <div
                    id="preview-fields"
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    {extractedFields.map((f) => (
                      <div
                        key={f.key}
                        className="rounded-xl border border-border bg-card/60 p-3 transition focus-within:border-primary hover:border-primary/60"
                      >
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {f.label}
                        </label>
                        <input
                          value={f.value ?? ""}
                          placeholder="não identificado"
                          onChange={(e) => setField(activeFile.id, f.key, e.target.value)}
                          className="mt-1 w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:italic placeholder:text-muted-foreground"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Nome gerado */}
                <div className="surface rounded-2xl border border-border/70 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="preview-filename" className="text-sm font-semibold">
                      Nome do arquivo gerado
                    </label>
                    {activeFile.customName !== undefined && (
                      <button
                        type="button"
                        onClick={() => resetName(activeFile.id)}
                        className="text-xs text-muted-foreground transition hover:text-primary"
                      >
                        Restaurar automático
                      </button>
                    )}
                  </div>
                  <div className="flex items-stretch rounded-xl border border-border bg-input/60 transition focus-within:border-primary focus-within:shadow-[var(--shadow-glow)]">
                    <input
                      id="preview-filename"
                      value={displayBase}
                      onChange={(e) =>
                        patch(activeFile.id, {
                          customName: `${e.target.value}.${activeExt}`,
                        })
                      }
                      className="min-w-0 flex-1 bg-transparent px-4 py-3 font-mono text-sm outline-none"
                    />
                    <span className="grid place-items-center rounded-r-xl border-l border-border bg-muted px-4 font-mono text-sm text-muted-foreground">
                      .{activeExt}
                    </span>
                  </div>
                  {activeFile.status === "concluido" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => downloadOne(activeFile)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
                      >
                        <Download className="size-3.5" />
                        Baixar este arquivo
                      </button>

                      {/* Botão Salvar na ferramenta */}
                      {(() => {
                        const st = saveStates[activeFile.id];
                        if (st === "saved") return (
                          <span className="inline-flex items-center gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-xs font-medium text-success">
                            <CheckCircle2 className="size-3.5" />
                            Salvo na ferramenta
                          </span>
                        );
                        if (st === "duplicate") return (
                          <span className="inline-flex items-center gap-2 rounded-xl border border-muted bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                            <CheckCircle2 className="size-3.5" />
                            Já salvo anteriormente
                          </span>
                        );
                        if (st === "saving") return (
                          <span className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                            <Loader2 className="size-3.5 animate-spin" />
                            Salvando…
                          </span>
                        );
                        if (st === "error") return (
                          <button
                            type="button"
                            onClick={() => handleSave(activeFile)}
                            className="inline-flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/20"
                          >
                            <AlertTriangle className="size-3.5" />
                            Erro — tentar novamente
                          </button>
                        );
                        return (
                          <button
                            type="button"
                            onClick={() => handleSave(activeFile)}
                            className="brand-gradient inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-all duration-200 hover:brightness-110"
                          >
                            <Save className="size-3.5" />
                            Salvar na ferramenta
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Zona 4 — Footer fixo */}
      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3 px-5 py-3">
          <span className="mr-auto text-sm text-muted-foreground">
            {nfFiles.length > 0 ? (
              <>
                <span className="font-semibold text-foreground">{selectedCount}</span> de{" "}
                <span className="font-semibold text-foreground">{nfFiles.length}</span> arquivos
                selecionados
                {outputDirName && <span className="ml-2 text-primary">→ {outputDirName}</span>}
              </>
            ) : (
              "Nenhum arquivo carregado"
            )}
          </span>
          <button
            id="btn-download-selected"
            type="button"
            disabled={selectedCount === 0}
            onClick={downloadSelected}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="size-4" />
            Baixar selecionados
          </button>
        </div>
      </footer>
    </div>
  );
}
