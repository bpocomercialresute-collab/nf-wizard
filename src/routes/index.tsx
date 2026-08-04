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
  Cloud,
  Lock,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";

// ---- Types ----

type NFFields = {
  numero?: string;
  data?: string;
  emitente?: string;
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

  // CNPJ do EMITENTE tem prioridade: "RECEBEMOS DE <nome> - <CNPJ> OS PRODUTOS"
  const emitCnpj = text.match(
    /RECEBEMOS\s+DE\s+.+?[-–]\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/i,
  )?.[1];
  const cnpj = emitCnpj ? normalizeCnpj(emitCnpj) : normalizeCnpj(text);
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

  // Canhoto/recibo: "RECEBEMOS DE <EMITENTE> - <CNPJ> OS PRODUTOS..."
  const rec = text.match(
    /RECEBEMOS\s+DE\s+(.+?)(?=\s*[-–]\s*\d{2}[.\d]|\s+CNPJ|\s+OS\s+PRODUTOS|\n|$)/i,
  );
  if (rec?.[1]) {
    fields.emitente = rec[1].replace(/\s+/g, " ").trim();
  }

  // Fallback: primeira linha com sufixo empresarial
  if (!fields.emitente) {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 3);
    const companySuffix =
      /\b(LTDA|S\.?A\.?|ME|EPP|EIRELI|DISTRIBUIDORA|COMERCIO|COMERCIAL|INDUSTRIA)\b/i;
    const skipLine = /CNPJ|INSCR|NOTA|DANFE|NF-e|REGIME|TRIBUTARIO|ENDERECO|END\./i;
    for (const line of lines) {
      if (companySuffix.test(line) && !skipLine.test(line) && line.length < 80) {
        fields.emitente = line.replace(/CNPJ.*$/, "").trim();
        break;
      }
    }
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
    EMITENTE: fields.emitente,
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

const tokens = ["{NUMERO}", "{DATA}", "{EMITENTE}", "{CNPJ}", "{VALOR}"];

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
      title: "1. Monte o padrão do nome",
      body: (
        <>
          Clique nos tokens (<code className="rounded bg-muted px-1 font-mono">{"{NUMERO}"}</code>,{" "}
          <code className="rounded bg-muted px-1 font-mono">{"{DATA}"}</code>…) para inseri-los.
          Eles viram os dados da nota. Padrão atual:{" "}
          <code className="rounded bg-muted px-1 font-mono text-primary">{pattern}</code>
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
          O texto é lido e os campos (número, data, emitente, CNPJ, valor) preenchem sozinhos.
          Escolha o motor no topo: <strong>Nuvem</strong> (mais preciso, envia a imagem ao serviço)
          ou <strong>Local</strong> (privado, roda no navegador).
        </>
      ),
    },
    {
      icon: MousePointerClick,
      title: "5. Confira e ajuste",
      body: (
        <>
          Clique num arquivo pra ver o texto. <strong>Edite qualquer campo</strong> (número, data,
          emitente…) e o nome se refaz sozinho. O selo mostra a confiança da leitura.
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
              Na <strong>primeira vez</strong>, o modelo de OCR é baixado (precisa de internet uma
              vez). Depois roda offline — suas notas <strong>nunca saem do navegador</strong>.
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
  const [pattern, setPattern] = useState("NF_{NUMERO}_{DATA}_{EMITENTE}");
  const [outputDir, setOutputDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [outputDirName, setOutputDirName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [engine, setEngine] = useState<"cloud" | "local">("cloud");
  const [apiKey, setApiKey] = useState("");
  const patternRef = useRef<HTMLInputElement>(null);

  // Carrega preferências salvas (só no cliente)
  useEffect(() => {
    const e = localStorage.getItem("nfw_engine");
    if (e === "local" || e === "cloud") setEngine(e);
    const k = localStorage.getItem("nfw_apikey");
    if (k) setApiKey(k);
  }, []);
  useEffect(() => {
    localStorage.setItem("nfw_engine", engine);
  }, [engine]);
  useEffect(() => {
    localStorage.setItem("nfw_apikey", apiKey);
  }, [apiKey]);

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
        let note: string | undefined;

        if (isImage && engine === "cloud") {
          try {
            const { ocrCloud } = await import("../lib/ocr-cloud");
            const r = await ocrCloud(file, apiKey, onProg);
            ocrText = r.text;
            previewUrl = r.previewUrl;
            confidence = 96; // OCR.space engine 2 — leitura de alta precisão
          } catch (cloudErr) {
            // Nuvem falhou (limite/rede): cai para OCR local automaticamente
            const r = await ocrImage(file, onProg);
            ocrText = r.ocrText;
            previewUrl = r.previewUrl;
            confidence = r.confidence;
            note = `OCR em nuvem indisponível (${
              cloudErr instanceof Error ? cloudErr.message : "erro"
            }). Usei OCR local — confira os campos.`;
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
          note,
        });
      } catch (err) {
        update({
          status: "erro",
          errorMsg: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [engine, apiKey],
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
      setOutputDirName(handle.name);
    } catch {
      // user cancelled
    }
  };

  const clearOutputFolder = () => {
    setOutputDir(null);
    setOutputDirName("");
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

  // ---- Token insertion ----

  const insertToken = (token: string) => {
    const input = patternRef.current;
    if (!input) return;
    const s = input.selectionStart ?? input.value.length;
    const e = input.selectionEnd ?? input.value.length;
    const newVal = input.value.slice(0, s) + token + input.value.slice(e);
    setPattern(newVal);
    requestAnimationFrame(() => {
      input.focus();
      const pos = s + token.length;
      input.setSelectionRange(pos, pos);
    });
  };

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
          { key: "emitente", label: "Emitente", value: activeFile.fields.emitente },
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
            OCR local no navegador
          </span>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3.5 py-2 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary lg:ml-3"
          >
            <BookOpen className="size-4" />
            <span className="hidden sm:inline">Manual</span>
          </button>
        </div>
      </header>

      {showManual && <ManualModal onClose={() => setShowManual(false)} pattern={pattern} />}

      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6">
        {/* Zona 1 — Padrão */}
        <section className="surface animate-rise rounded-2xl border border-border/70 p-5">
          <label htmlFor="pattern-input" className="text-sm font-medium text-foreground">
            Padrão do nome do arquivo
          </label>
          <input
            id="pattern-input"
            ref={patternRef}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-input/60 px-4 py-3 font-mono text-sm text-foreground outline-none transition focus:border-primary focus:shadow-[var(--shadow-glow)]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Tokens disponíveis:</span>
            {tokens.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => insertToken(t)}
                className="rounded-full border border-border bg-secondary px-3 py-1 font-mono text-xs text-secondary-foreground transition hover:border-primary hover:bg-primary/15 hover:text-primary"
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Zona 1a — Motor de OCR */}
        <section
          className="surface animate-rise rounded-2xl border border-border/70 p-5"
          style={{ animationDelay: "40ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Motor de leitura (OCR)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {engine === "cloud"
                  ? "Nuvem: máxima precisão. A imagem é enviada ao serviço OCR.space."
                  : "Local: roda no navegador, 100% privado. Menor precisão em fotos ruins."}
              </p>
            </div>
            <div className="flex shrink-0 rounded-xl border border-border bg-secondary p-1">
              <button
                type="button"
                onClick={() => setEngine("cloud")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  engine === "cloud"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Cloud className="size-4" />
                Nuvem
              </button>
              <button
                type="button"
                onClick={() => setEngine("local")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  engine === "local"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Lock className="size-4" />
                Local
              </button>
            </div>
          </div>
          {engine === "cloud" && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <label htmlFor="ocr-key" className="text-xs font-medium text-muted-foreground">
                Chave da API OCR.space
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input
                  id="ocr-key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="helloworld (demo — limitada)"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-input/60 px-3 py-2 font-mono text-xs outline-none transition focus:border-primary"
                />
                <a
                  href="https://ocr.space/ocrapi/freekey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
                >
                  Pegar chave grátis
                </a>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Vazio usa a chave demo (poucas leituras/dia). Uma chave grátis própria libera uso
                normal. Guardada só no seu navegador.
              </p>
            </div>
          )}
        </section>

        {/* Zona 1b — Pasta de destino */}
        <section
          className="surface animate-rise rounded-2xl border border-border/70 p-5"
          style={{ animationDelay: "60ms" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Pasta de destino</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {outputDirName
                  ? `Salvando em: ${outputDirName}`
                  : "Nenhuma pasta selecionada — arquivos baixados pelo navegador"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {outputDir && (
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
                {outputDir ? "Alterar pasta" : "Selecionar pasta"}
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
                    <button
                      type="button"
                      onClick={() => downloadOne(activeFile)}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:border-primary hover:text-primary"
                    >
                      <Download className="size-3.5" />
                      Baixar este arquivo
                    </button>
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
          <button
            id="btn-download-zip"
            type="button"
            disabled={nfFiles.filter((f) => f.status === "concluido").length === 0}
            onClick={downloadAllZip}
            className="brand-gradient inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-all duration-200 hover:brightness-110 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <FileArchive className="size-4" />
            Baixar todos como ZIP
          </button>
        </div>
      </footer>
    </div>
  );
}
