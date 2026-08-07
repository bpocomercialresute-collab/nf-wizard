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
  Database,
  Save,
  Eye,
  FileDown,
  Search,
  Pencil,
  Check,
  Trash2,
  CalendarDays,
  AlertCircle,
  Calendar,
  BookOpen,
  MousePointerClick,
  Type,
  LogOut,
  Sparkles,
  Camera,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { signOut, getUserEmail } from "../lib/auth";
import { CameraModal } from "./CameraModal";
import { useState, useCallback, useEffect } from "react";
import {
  saveBoleto,
  listBoletos,
  updateBoleto,
  deleteBoleto,
  boletoStorageUrl,
  vencimentoStatus,
  fmtDate,
  type BoletoRecord,
  type VencimentoStatus,
} from "../lib/boleto-storage";

// ---- Types ----

type BoletoFields = {
  vencimento?: string;
  valor?: string;
  beneficiario?: string;
  cnpj_beneficiario?: string;
  numero_documento?: string;
};

type Status = "aguardando" | "processando" | "concluido" | "erro";

type BoletoFile = {
  id: string;
  file: File;
  ext: string;
  type: "pdf" | "img";
  status: Status;
  selected: boolean;
  progress: number;
  ocrText: string;
  fields: BoletoFields;
  customName?: string;
  previewUrl: string;
  errorMsg?: string;
};

// ---- Parser ----

const CNPJ_RX = /(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})/;

function normalizeCnpj(raw: string): string | undefined {
  const m = raw.match(CNPJ_RX);
  if (!m) return undefined;
  return `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}`;
}

function parseBoletoFields(text: string): BoletoFields {
  const fields: BoletoFields = {};

  // Vencimento — vários padrões de boleto
  const vencPatterns = [
    /VENCIMENTO\s*:?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
    /DATA\s+DE\s+VENCIMENTO\s*:?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
    /VENCE\s+EM\s*:?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
    /VENCTO\s*[.:\/]?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
    /VALIDO\s+AT[EÉ]\s*:?\s*(\d{2}[\/.-]\d{2}[\/.-]\d{4})/i,
  ];
  for (const rx of vencPatterns) {
    const m = text.match(rx)?.[1];
    if (m) {
      fields.vencimento = m.replace(/[.-]/g, "/");
      break;
    }
  }

  // Valor
  const valorPatterns = [
    /VALOR\s+DO\s+DOCUMENTO\s*:?\s*R?\$?\s*([\d.,]+)/i,
    /VALOR\s+COBRADO\s*:?\s*R?\$?\s*([\d.,]+)/i,
    /VALOR\s*:?\s*R?\$?\s*([\d.,]+)/i,
    /TOTAL\s+A\s+PAGAR\s*:?\s*R?\$?\s*([\d.,]+)/i,
  ];
  for (const rx of valorPatterns) {
    const v = text.match(rx)?.[1];
    if (v) { fields.valor = `R$ ${v}`; break; }
  }
  if (!fields.valor) {
    const tokens = [...text.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map((m) => m[0]);
    const toNumber = (t: string) => parseFloat(t.replace(/\./g, "").replace(",", "."));
    const max = tokens.sort((a, b) => toNumber(b) - toNumber(a))[0];
    if (max) fields.valor = `R$ ${max}`;
  }

  // Beneficiário / Cedente / Favorecido
  const benefPatterns = [
    /BENEFICI[ÁA]RIO\s*:?\s*(.+?)(?=\s*CNPJ|\s*CPF|\s*\n|$)/i,
    /CEDENTE\s*:?\s*(.+?)(?=\s*CNPJ|\s*CPF|\s*\n|$)/i,
    /FAVORECIDO\s*:?\s*(.+?)(?=\s*CNPJ|\s*CPF|\s*\n|$)/i,
    /EMPRESA\s*:?\s*(.+?)(?=\s*CNPJ|\s*CPF|\s*\n|$)/i,
  ];
  for (const rx of benefPatterns) {
    const m = text.match(rx)?.[1];
    if (m) { fields.beneficiario = m.replace(/\s+/g, " ").trim(); break; }
  }

  // CNPJ
  const cnpjPatterns = [
    /CNPJ\s*(?:DO\s+BENEFICI[ÁA]RIO|DO\s+CEDENTE)?\s*:?\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/i,
    /CPF\/?CNPJ\s*:?\s*(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})/i,
  ];
  for (const rx of cnpjPatterns) {
    const m = text.match(rx)?.[1];
    if (m) { const n = normalizeCnpj(m); if (n) { fields.cnpj_beneficiario = n; break; } }
  }
  if (!fields.cnpj_beneficiario) {
    const n = normalizeCnpj(text);
    if (n) fields.cnpj_beneficiario = n;
  }

  // Número do documento / NF associada
  const numPatterns = [
    /N[ÚU]MERO\s+DO\s+DOCUMENTO\s*:?\s*(\S+)/i,
    /N[Oo°º]\s+DO\s+DOCUMENTO\s*:?\s*(\S+)/i,
    /NOSSO\s+N[ÚU]MERO\s*:?\s*(\S+)/i,
    /NF\s*[-]?\s*[Ee]?\s*N[oO°º]?\s*:?\s*(\d{3,15})/i,
    /NOTA\s+FISCAL\s*:?\s*(\d{3,15})/i,
    /DOC\s*N[oO°º]?\s*:?\s*(\S+)/i,
  ];
  for (const rx of numPatterns) {
    const m = text.match(rx)?.[1];
    if (m) { fields.numero_documento = m.replace(/\./g, ""); break; }
  }

  return fields;
}

// ---- Filename builder ----

function sanitize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function buildBoleteName(fields: BoletoFields, ext: string): string {
  const parts: string[] = ["BOLETO"];
  if (fields.numero_documento) parts.push(sanitize(fields.numero_documento));
  else parts.push("_NUMERO_");
  if (fields.vencimento) parts.push(sanitize(fields.vencimento));
  else parts.push("_VENCIMENTO_");
  return `${parts.join("_")}.${ext}`;
}

// ---- Status configs ----

const statusConfig: Record<Status, { label: string; className: string; icon: typeof Clock }> = {
  aguardando: { label: "aguardando", className: "bg-muted text-muted-foreground", icon: Clock },
  processando: { label: "processando", className: "bg-accent/15 text-accent", icon: Loader2 },
  concluido: { label: "concluído", className: "bg-success/15 text-success", icon: CheckCircle2 },
  erro: { label: "erro", className: "bg-destructive/15 text-destructive", icon: AlertTriangle },
};

const vencStatusConfig: Record<VencimentoStatus, { label: string; className: string; icon: typeof CalendarDays }> = {
  vencido: { label: "VENCIDO", className: "bg-destructive/15 text-destructive", icon: AlertCircle },
  hoje: { label: "Vence hoje", className: "bg-warning/15 text-warning", icon: AlertTriangle },
  proximo: { label: "Próximos 7 dias", className: "bg-yellow-500/15 text-yellow-500", icon: Calendar },
  em_dia: { label: "Em dia", className: "bg-success/15 text-success", icon: CheckCircle2 },
  sem_data: { label: "Sem data", className: "bg-muted text-muted-foreground", icon: CalendarDays },
};

// ---- Manual ----

function ManualBoletoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const steps = [
    { icon: Type, title: "1. Importe os boletos", body: "Arraste ou clique na área de upload. Aceita JPG, PNG e PDF — vários de uma vez." },
    { icon: ScanLine, title: "2. OCR automático em nuvem", body: "O boleto é escaneado em nuvem (mesma engine das notas fiscais). Extrai: vencimento, valor, beneficiário, CNPJ e número do documento." },
    { icon: MousePointerClick, title: "3. Confira e ajuste", body: "Clique em um arquivo para ver os campos. Edite qualquer campo se o OCR errar — o nome se refaz automaticamente." },
    { icon: CalendarDays, title: "4. Alertas de vencimento", body: "Cada boleto exibe seu status: Em dia (verde), Próximos 7 dias (amarelo), Vence hoje (laranja) ou Vencido (vermelho)." },
    { icon: Database, title: "5. Gerencie no banco", body: "Salve na ferramenta para acessar depois em \"Todos os Boletos\". Filtre por status de vencimento, pesquise por beneficiário, valor ou data." },
    { icon: FileArchive, title: "6. Baixe", body: "Um por vez, os selecionados, ou todos como ZIP — botões no rodapé. Saem com o nome automático: BOLETO_NUMERO_VENCIMENTO." },
  ];

  return (
    <div onClick={onClose} className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="animate-pop surface flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[var(--shadow-glow)]">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
              <BookOpen className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight">Como usar — Comprovantes Fiscais</h2>
              <p className="text-xs text-muted-foreground">Gerencie boletos em 6 passos</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto p-5">
          {steps.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="flex gap-3 rounded-xl border border-border bg-card/60 p-3.5 transition hover:border-primary/50">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/60 px-5 py-3">
          <button type="button" onClick={onClose} className="brand-gradient inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:brightness-110">
            Entendi, começar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main component ----

type VencFilter = "todos" | "vencido" | "hoje" | "proximo" | "em_dia";

export function ComprovantesTab() {
  const [files, setFiles] = useState<BoletoFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [outputDir, setOutputDir] = useState<FileSystemDirectoryHandle | null>(null);
  const outputDirName = outputDir?.name ?? "";

  const [showCamera, setShowCamera] = useState(false);
  const [saveStates, setSaveStates] = useState<Record<string, "saving" | "saved" | "duplicate" | "error">>({});

  // Modal — Todos os Boletos
  const [showAll, setShowAll] = useState(false);
  const [allBoletos, setAllBoletos] = useState<BoletoRecord[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [boletoSearch, setBoletoSearch] = useState("");
  const [vencFilter, setVencFilter] = useState<VencFilter>("todos");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<BoletoRecord>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const activeFile = files.find((f) => f.id === activeId) ?? files[0] ?? null;
  const selectedCount = files.filter((f) => f.selected).length;

  const getDisplayName = useCallback(
    (f: BoletoFile) => f.customName ?? buildBoleteName(f.fields, f.ext),
    [],
  );

  const patch = useCallback(
    (id: string, p: Partial<BoletoFile>) =>
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f))),
    [],
  );

  const resetName = useCallback(
    (id: string) =>
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== id) return f;
          const { customName: _drop, ...rest } = f;
          return rest;
        }),
      ),
    [],
  );

  // ---- OCR (só nuvem, igual NF) ----

  const processFile = useCallback(async (file: File) => {
    const id = crypto.randomUUID();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isImage = ["jpg", "jpeg", "png"].includes(ext);

    const entry: BoletoFile = {
      id, file, ext,
      type: isImage ? "img" : "pdf",
      status: "aguardando",
      selected: true,
      progress: 0,
      ocrText: "",
      fields: {},
      previewUrl: "",
    };

    setFiles((prev) => [...prev, entry]);
    setActiveId(id);

    const update = (p: Partial<BoletoFile>) =>
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

    update({ status: "processando" });

    try {
      const onProg = (n: number) => update({ progress: n });
      let ocrText: string;
      let previewUrl: string;

      if (isImage) {
        const { ocrCloud } = await import("../lib/ocr-cloud");
        const { getOcrApiKey } = await import("../lib/supabase-config");
        const key = await getOcrApiKey();
        const r = await ocrCloud(file, key, onProg);
        ocrText = r.text;
        previewUrl = r.previewUrl;
      } else {
        // PDF: texto embutido primeiro, depois OCR nuvem se necessário
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).href;
        }
        const ab = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: ab }).promise;
        onProg(8);

        let embeddedText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          embeddedText += tc.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ") + "\n";
        }
        onProg(30);

        const page1 = await pdf.getPage(1);
        const vp = page1.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page1.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        previewUrl = canvas.toDataURL("image/jpeg", 0.85);

        if (embeddedText.replace(/\s/g, "").length >= 80) {
          ocrText = embeddedText.trim();
          onProg(100);
        } else {
          // PDF escaneado: converte página 1 para blob e envia ao OCR nuvem
          onProg(35);
          const blob = await new Promise<Blob>((res, rej) =>
            canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob falhou"))), "image/jpeg", 0.85),
          );
          const { ocrCloud } = await import("../lib/ocr-cloud");
          const { getOcrApiKey } = await import("../lib/supabase-config");
          const key = await getOcrApiKey();
          const r = await ocrCloud(blob, key, (n) => onProg(35 + Math.round(n * 0.65)));
          ocrText = r.text;
          previewUrl = r.previewUrl;
        }
      }

      const fields = parseBoletoFields(ocrText);
      update({ status: "concluido", progress: 100, ocrText, fields, previewUrl });
    } catch (err) {
      update({ status: "erro", errorMsg: err instanceof Error ? err.message : String(err) });
    }
  }, []);

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

  // ---- Pasta de destino ----

  const selectOutputFolder = async () => {
    if (!("showDirectoryPicker" in window)) {
      alert("Seu navegador não suporta seleção de pasta.\nUse Chrome ou Edge.\nOs arquivos serão baixados normalmente.");
      return;
    }
    try {
      const handle = await (window as Window & { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
      setOutputDir(handle);
    } catch { /* cancelado */ }
  };

  // ---- Downloads ----

  const downloadOne = async (bf: BoletoFile) => {
    const name = getDisplayName(bf);
    if (outputDir) {
      try {
        const fh = await outputDir.getFileHandle(name, { create: true });
        const wr = await fh.createWritable();
        await wr.write(bf.file);
        await wr.close();
        return;
      } catch (err) { console.error(err); }
    }
    const url = URL.createObjectURL(bf.file);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSelected = async () => {
    const ready = files.filter((f) => f.selected && f.status === "concluido");
    for (const f of ready) await downloadOne(f);
  };

  const downloadAllZip = async () => {
    const ready = files.filter((f) => f.status === "concluido");
    if (!ready.length) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const f of ready) zip.file(getDisplayName(f), f.file);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "comprovantes.zip"; a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Salvar no banco ----

  const handleSave = useCallback(async (bf: BoletoFile) => {
    if (bf.status !== "concluido") return;
    setSaveStates((prev) => ({ ...prev, [bf.id]: "saving" }));
    const name = getDisplayName(bf);
    const result = await saveBoleto(bf.file, bf.fields, name);
    if (result.ok) {
      setSaveStates((prev) => ({ ...prev, [bf.id]: "saved" }));
    } else if (result.duplicate) {
      setSaveStates((prev) => ({ ...prev, [bf.id]: "duplicate" }));
    } else {
      setSaveStates((prev) => ({ ...prev, [bf.id]: "error" }));
    }
  }, [getDisplayName]);

  // ---- Modal todos boletos ----

  const openAll = useCallback(async () => {
    setShowAll(true);
    setBoletoSearch("");
    setVencFilter("todos");
    setEditingId(null);
    setLoadingAll(true);
    const records = await listBoletos();
    setAllBoletos(records);
    setLoadingAll(false);
  }, []);

  const filteredBoletos = allBoletos.filter((b) => {
    const q = boletoSearch.toLowerCase().trim();
    const matchSearch = !q ||
      (b.beneficiario ?? "").toLowerCase().includes(q) ||
      (b.cnpj_beneficiario ?? "").toLowerCase().includes(q) ||
      (b.valor ?? "").toLowerCase().includes(q) ||
      (b.vencimento ?? "").includes(q) ||
      (b.numero_documento ?? "").toLowerCase().includes(q) ||
      (b.file_name ?? "").toLowerCase().includes(q);
    const status = vencimentoStatus(b.vencimento);
    const matchFilter = vencFilter === "todos" || status === vencFilter;
    return matchSearch && matchFilter;
  });

  const vencCounts = {
    vencido: allBoletos.filter((b) => vencimentoStatus(b.vencimento) === "vencido").length,
    hoje: allBoletos.filter((b) => vencimentoStatus(b.vencimento) === "hoje").length,
    proximo: allBoletos.filter((b) => vencimentoStatus(b.vencimento) === "proximo").length,
    em_dia: allBoletos.filter((b) => vencimentoStatus(b.vencimento) === "em_dia").length,
  };

  const startEdit = useCallback((b: BoletoRecord) => {
    setEditingId(b.id);
    setEditFields({
      vencimento: b.vencimento ?? "",
      valor: b.valor ?? "",
      beneficiario: b.beneficiario ?? "",
      cnpj_beneficiario: b.cnpj_beneficiario ?? "",
      numero_documento: b.numero_documento ?? "",
      file_name: b.file_name ?? "",
    });
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    setSavingEdit(true);
    const currentB = allBoletos.find((n) => n.id === editingId);
    const ext = (currentB?.file_name ?? "pdf").split(".").pop()?.toLowerCase() ?? "pdf";
    const rebuiltFields: BoletoFields = {
      ...(editFields.vencimento !== undefined && { vencimento: editFields.vencimento }),
      ...(editFields.valor !== undefined && { valor: editFields.valor }),
      ...(editFields.beneficiario !== undefined && { beneficiario: editFields.beneficiario }),
      ...(editFields.cnpj_beneficiario !== undefined && { cnpj_beneficiario: editFields.cnpj_beneficiario }),
      ...(editFields.numero_documento !== undefined && { numero_documento: editFields.numero_documento }),
    };
    const rebuiltName = buildBoleteName(rebuiltFields, ext);
    const finalFields = { ...editFields, file_name: rebuiltName };
    const ok = await updateBoleto(editingId, finalFields);
    if (ok) {
      setAllBoletos((prev) =>
        prev.map((b) => (b.id === editingId ? { ...b, ...finalFields } : b)),
      );
      setEditingId(null);
    }
    setSavingEdit(false);
  }, [editingId, editFields, allBoletos]);

  const handleDelete = useCallback(async (b: BoletoRecord) => {
    const ok = await deleteBoleto(b.id, b.storage_path);
    if (ok) {
      setAllBoletos((prev) => prev.filter((x) => x.id !== b.id));
      if (editingId === b.id) setEditingId(null);
    }
  }, [editingId]);

  // ---- Fields helpers ----

  const setField = (id: string, key: keyof BoletoFields, value: string) =>
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, fields: { ...f.fields, [key]: value } } : f)),
    );

  const activeExt = activeFile?.ext ?? "";
  const displayName = activeFile ? getDisplayName(activeFile) : "";
  const displayBase = displayName.endsWith(`.${activeExt}`)
    ? displayName.slice(0, -(activeExt.length + 1))
    : displayName;

  type ExtractedField = { key: keyof BoletoFields; label: string; value: string | undefined };
  const extractedFields: ExtractedField[] = activeFile
    ? [
        { key: "vencimento", label: "Vencimento (DD/MM/AAAA)", value: activeFile.fields.vencimento },
        { key: "valor", label: "Valor", value: activeFile.fields.valor },
        { key: "beneficiario", label: "Beneficiário / Cedente", value: activeFile.fields.beneficiario },
        { key: "cnpj_beneficiario", label: "CNPJ Beneficiário", value: activeFile.fields.cnpj_beneficiario },
        { key: "numero_documento", label: "Nº Documento / NF", value: activeFile.fields.numero_documento },
      ]
    : [];

  // ---- Render ----

  return (
    <div className="min-h-screen pb-24 sm:pb-28">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border/70 bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-3 sm:gap-4 sm:px-5 sm:py-3.5">
          <img
            src="/brand/varremaster-full.png"
            alt="Varremaster"
            className="h-7 w-auto shrink-0 select-none sm:h-9"
            draggable={false}
          />
          <span className="hidden h-9 w-px bg-border sm:block" />
          <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15 sm:grid">
            <FileDown className="size-5" />
          </span>
          <div className="hidden min-w-0 sm:block">
            <h1 className="brand-text text-lg font-bold tracking-tight">Comprovantes Fiscais</h1>
            <p className="truncate text-xs text-muted-foreground">
              Escaneie e gerencie boletos com OCR em nuvem e alertas de vencimento
            </p>
          </div>

          {/* Spacer */}
          <span className="flex-1" />

          <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary lg:inline-flex">
            <Sparkles className="size-3.5" />
            OCR em nuvem — alta precisão
          </span>
          <button
            type="button"
            onClick={openAll}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-2.5 py-2 text-sm font-medium text-primary transition hover:bg-primary/20 sm:px-3.5"
          >
            <Database className="size-4" />
            <span className="hidden sm:inline">Todos os Boletos</span>
          </button>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="hidden items-center gap-2 rounded-xl border border-border bg-secondary px-3.5 py-2 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary md:inline-flex"
          >
            <BookOpen className="size-4" />
            <span>Manual</span>
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-2.5 py-2 text-sm font-medium text-secondary-foreground transition hover:border-primary hover:text-primary sm:px-3.5"
          >
            <ScanLine className="size-4" />
            <span className="hidden sm:inline">Notas Fiscais</span>
          </Link>
          <button
            type="button"
            title={`Sair (${getUserEmail()})`}
            onClick={async () => { await signOut(); window.location.reload(); }}
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive sm:size-10"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      {showManual && <ManualBoletoModal onClose={() => setShowManual(false)} />}

      {showCamera && (
        <CameraModal
          title="Escanear boleto"
          onClose={() => setShowCamera(false)}
          onCapture={(file) => {
            setShowCamera(false);
            processFile(file);
          }}
        />
      )}

      {/* Modal — Todos os Boletos */}
      {showAll && (
        <div
          onClick={() => { setShowAll(false); setEditingId(null); }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="surface flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[var(--shadow-glow)]"
          >
            {/* Header modal */}
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/15">
                  <Database className="size-5" />
                </span>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Todos os Boletos</h2>
                  <p className="text-xs text-muted-foreground">
                    {loadingAll ? "Carregando…" : `${allBoletos.length} boleto${allBoletos.length !== 1 ? "s" : ""} salvo${allBoletos.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowAll(false); setEditingId(null); }}
                className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Filtros de vencimento */}
            {!loadingAll && allBoletos.length > 0 && (
              <div className="border-b border-border/60 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: "todos" as VencFilter, label: `Todos (${allBoletos.length})`, className: "border-border bg-secondary text-secondary-foreground" },
                    { key: "vencido" as VencFilter, label: `Vencidos (${vencCounts.vencido})`, className: "border-destructive/40 bg-destructive/10 text-destructive" },
                    { key: "hoje" as VencFilter, label: `Vence hoje (${vencCounts.hoje})`, className: "border-warning/40 bg-warning/10 text-warning" },
                    { key: "proximo" as VencFilter, label: `7 dias (${vencCounts.proximo})`, className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500" },
                    { key: "em_dia" as VencFilter, label: `Em dia (${vencCounts.em_dia})`, className: "border-success/40 bg-success/10 text-success" },
                  ] as const).map(({ key, label, className }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setVencFilter(key)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${className} ${vencFilter === key ? "ring-2 ring-primary/40" : "opacity-70 hover:opacity-100"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Busca */}
                <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-border bg-input/60 px-3 py-2 transition focus-within:border-primary">
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    type="text"
                    value={boletoSearch}
                    onChange={(e) => setBoletoSearch(e.target.value)}
                    placeholder="Pesquisar por beneficiário, CNPJ, valor, vencimento…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  {boletoSearch && (
                    <button type="button" onClick={() => setBoletoSearch("")} className="text-muted-foreground transition hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                {(boletoSearch.trim() || vencFilter !== "todos") && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {filteredBoletos.length} resultado{filteredBoletos.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {/* Lista */}
            <div className="flex flex-col gap-2 overflow-y-auto p-4">
              {loadingAll && (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              )}
              {!loadingAll && allBoletos.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Database className="size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhum boleto salvo ainda.</p>
                </div>
              )}
              {!loadingAll && filteredBoletos.length === 0 && allBoletos.length > 0 && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Search className="size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nenhum resultado.</p>
                </div>
              )}
              {!loadingAll && filteredBoletos.map((b) => {
                const isPdf = b.storage_path?.endsWith(".pdf");
                const isEditing = editingId === b.id;
                const vs = vencimentoStatus(b.vencimento);
                const vc = vencStatusConfig[vs];
                const VcIcon = vc.icon;
                return (
                  <div
                    key={b.id}
                    className={`rounded-xl border p-3 transition ${isEditing ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:border-primary/50"}`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Thumbnail */}
                      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                        {b.storage_path && !isPdf ? (
                          <img src={boletoStorageUrl(b.storage_path)} alt="Boleto" className="size-full object-cover" />
                        ) : (
                          <FileText className="size-7 text-accent" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-foreground">
                            {b.beneficiario ?? b.file_name}
                          </span>
                          {b.valor && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                              {b.valor}
                            </span>
                          )}
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${vc.className}`}>
                            <VcIcon className="size-3" />
                            {b.vencimento ? `${b.vencimento} — ${vc.label}` : vc.label}
                          </span>
                        </div>
                        {b.cnpj_beneficiario && (
                          <p className="truncate text-xs text-muted-foreground">{b.cnpj_beneficiario}</p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                          {fmtDate(b.created_at)} · {b.file_name}
                        </p>
                      </div>

                      {/* Ações */}
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          title={isEditing ? "Cancelar" : "Editar"}
                          onClick={() => { if (isEditing) setEditingId(null); else startEdit(b); }}
                          className={`grid size-9 place-items-center rounded-xl border transition ${isEditing ? "border-primary bg-primary/15 text-primary" : "border-border bg-secondary text-muted-foreground hover:border-primary hover:text-primary"}`}
                        >
                          <Pencil className="size-4" />
                        </button>
                        {b.storage_path && (
                          <>
                            <a
                              href={boletoStorageUrl(b.storage_path)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Visualizar"
                              className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-primary hover:text-primary"
                            >
                              <Eye className="size-4" />
                            </a>
                            <button
                              type="button"
                              title="Baixar"
                              onClick={async () => {
                                const res = await fetch(boletoStorageUrl(b.storage_path!));
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url; a.download = b.file_name; a.click();
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
                          title="Excluir"
                          onClick={() => {
                            if (window.confirm(`Excluir boleto "${b.beneficiario ?? b.file_name}"? Esta ação não pode ser desfeita.`)) {
                              handleDelete(b);
                            }
                          }}
                          className="grid size-9 place-items-center rounded-xl border border-border bg-secondary text-muted-foreground transition hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>

                    {/* Edição inline */}
                    {isEditing && (
                      <div className="mt-3 border-t border-border/60 pt-3">
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                          {[
                            { key: "vencimento" as const, label: "Vencimento (DD/MM/AAAA)" },
                            { key: "valor" as const, label: "Valor" },
                            { key: "beneficiario" as const, label: "Beneficiário" },
                            { key: "cnpj_beneficiario" as const, label: "CNPJ Beneficiário" },
                            { key: "numero_documento" as const, label: "Nº Documento / NF" },
                          ].map((field) => (
                            <div key={field.key} className="rounded-lg border border-border bg-card/80 p-2 transition focus-within:border-primary">
                              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{field.label}</label>
                              <input
                                value={(editFields[field.key] as string) ?? ""}
                                onChange={(e) => setEditFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                placeholder="não identificado"
                                className="mt-0.5 w-full bg-transparent text-xs font-medium text-foreground outline-none placeholder:font-normal placeholder:italic placeholder:text-muted-foreground"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <p className="min-w-0 truncate font-mono text-[11px] text-foreground">
                            {buildBoleteName(
                              {
                                ...(editFields.vencimento !== undefined && { vencimento: editFields.vencimento }),
                                ...(editFields.valor !== undefined && { valor: editFields.valor }),
                                ...(editFields.beneficiario !== undefined && { beneficiario: editFields.beneficiario }),
                                ...(editFields.cnpj_beneficiario !== undefined && { cnpj_beneficiario: editFields.cnpj_beneficiario }),
                                ...(editFields.numero_documento !== undefined && { numero_documento: editFields.numero_documento }),
                              },
                              (b.file_name ?? "pdf").split(".").pop()?.toLowerCase() ?? "pdf",
                            )}
                          </p>
                        </div>
                        <div className="mt-2.5 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-foreground hover:text-foreground"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={savingEdit}
                            className="brand-gradient inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50"
                          >
                            {savingEdit ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
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

      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-6 sm:px-5 sm:py-6">
        {/* Pasta de destino */}
        <section className="surface animate-rise rounded-2xl border border-border/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Local de salvamento</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {outputDirName ? `Salvando em: ${outputDirName}` : "Nenhum local — arquivos baixados pelo navegador"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {outputDirName && (
                <button
                  type="button"
                  onClick={() => setOutputDir(null)}
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

        {/* Upload + Escanear */}
        <section className="animate-rise flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "60ms" }}>
          {/* Drag & drop */}
          <label
            htmlFor="boleto-file-input"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`group surface flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300 ${
              isDragging ? "scale-[1.01] border-primary bg-primary/10 shadow-[var(--shadow-glow)]" : "border-border hover:border-primary hover:bg-primary/5"
            }`}
          >
            <span className={`grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/15 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 ${isDragging ? "animate-bounce" : ""}`}>
              <UploadCloud className="size-7" />
            </span>
            <span className="text-base font-medium">
              {isDragging ? "Solte para importar" : "Arraste arquivos ou clique para importar"}
            </span>
            <span className="text-sm text-muted-foreground">Suporta JPG, PNG e PDF — múltiplos arquivos</span>
            <input
              id="boleto-file-input"
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
          </label>

          {/* Botão escanear */}
          <button
            type="button"
            onClick={() => setShowCamera(true)}
            className="group surface flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border px-8 py-10 text-center transition-all duration-300 hover:border-primary hover:bg-primary/5 sm:w-52"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/15 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105">
              <Camera className="size-7" />
            </span>
            <span className="text-base font-medium">Escanear câmera</span>
            <span className="text-sm text-muted-foreground">Abre câmera ao vivo</span>
          </button>
        </section>

        {/* Empty state */}
        {files.length === 0 && (
          <section className="animate-fade flex flex-col items-center gap-3 py-8 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-card shadow-[var(--shadow-soft)] ring-1 ring-border">
              <CalendarDays className="size-8 text-primary/70" />
            </span>
            <p className="text-sm font-medium text-foreground">Nenhum boleto ainda</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Importe imagens ou PDFs de boletos acima. O OCR em nuvem extrai vencimento, valor, beneficiário e CNPJ automaticamente.
            </p>
          </section>
        )}

        {/* Lista + Preview */}
        {files.length > 0 && (
          <section className="animate-rise grid grid-cols-1 gap-5 lg:grid-cols-10">
            {/* Lista */}
            <div className="surface rounded-2xl border border-border/70 p-4 lg:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Arquivos processados</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{files.length}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {files.map((f) => {
                  const s = statusConfig[f.status];
                  const Icon = s.icon;
                  const vs = f.status === "concluido" ? vencimentoStatus(f.fields.vencimento) : null;
                  const vc = vs ? vencStatusConfig[vs] : null;
                  const VcIcon = vc?.icon;
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
                          onChange={(e) => { e.stopPropagation(); patch(f.id, { selected: !f.selected }); }}
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
                          title="Remover"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFiles((prev) => prev.filter((x) => x.id !== f.id));
                            if (activeId === f.id) setActiveId(null);
                          }}
                          className="shrink-0 text-muted-foreground transition hover:text-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className}`}>
                          <Icon className={`size-3 ${f.status === "processando" ? "animate-spin" : ""}`} />
                          {s.label}
                        </span>
                        {vc && VcIcon && (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${vc.className}`}>
                            <VcIcon className="size-3" />
                            {f.fields.vencimento ? f.fields.vencimento : vc.label}
                          </span>
                        )}
                      </div>
                      {f.status === "processando" && (
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="progress-stripes h-full rounded-full" style={{ width: `${f.progress}%` }} />
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

            {/* Preview */}
            {activeFile && (
              <div className="flex flex-col gap-4 lg:col-span-7">
                {/* Preview imagem */}
                <div className="surface rounded-2xl border border-border/70 p-4">
                  <h2 className="mb-3 text-sm font-semibold">Pré-visualização</h2>
                  <div className="grid h-48 place-items-center overflow-hidden rounded-xl border border-border bg-muted/40 sm:h-72">
                    {activeFile.previewUrl ? (
                      <img src={activeFile.previewUrl} alt="preview" className="max-h-full max-w-full object-contain" />
                    ) : activeFile.status === "processando" ? (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-8 animate-spin" />
                        <span className="text-xs">{activeFile.progress}% — processando OCR em nuvem…</span>
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
                    readOnly
                    rows={8}
                    value={activeFile.ocrText || (activeFile.status === "processando" ? "Extraindo texto via OCR em nuvem…" : (activeFile.errorMsg ?? "Sem texto extraído"))}
                    className="w-full resize-none rounded-xl border border-border bg-input/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground outline-none"
                  />
                </div>

                {/* Campos extraídos */}
                <div className="surface rounded-2xl border border-border/70 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Campos extraídos</h3>
                      {activeFile.status === "concluido" && activeFile.fields.vencimento && (() => {
                        const vs = vencimentoStatus(activeFile.fields.vencimento);
                        const vc = vencStatusConfig[vs];
                        const VcIcon = vc.icon;
                        return (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${vc.className}`}>
                            <VcIcon className="size-3" />
                            {vc.label}
                          </span>
                        );
                      })()}
                    </div>
                    {activeFile.status === "concluido" && (
                      <button
                        type="button"
                        onClick={() => {
                          setFiles((prev) => prev.filter((x) => x.id !== activeFile.id));
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
                  <p className="mb-2 text-xs text-muted-foreground">
                    Confira e edite se o OCR errar — o nome do arquivo se atualiza sozinho.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {extractedFields.map((f) => (
                      <div
                        key={f.key}
                        className="rounded-xl border border-border bg-card/60 p-3 transition focus-within:border-primary hover:border-primary/60"
                      >
                        <label className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</label>
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
                    <label className="text-sm font-semibold">Nome do arquivo gerado</label>
                    {activeFile.customName !== undefined && (
                      <button type="button" onClick={() => resetName(activeFile.id)} className="text-xs text-muted-foreground transition hover:text-primary">
                        Restaurar automático
                      </button>
                    )}
                  </div>
                  <div className="flex items-stretch rounded-xl border border-border bg-input/60 transition focus-within:border-primary focus-within:shadow-[var(--shadow-glow)]">
                    <input
                      value={displayBase}
                      onChange={(e) => patch(activeFile.id, { customName: `${e.target.value}.${activeExt}` })}
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

                      {/* Salvar na ferramenta */}
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
                          <button type="button" onClick={() => handleSave(activeFile)} className="inline-flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/20">
                            <AlertTriangle className="size-3.5" />
                            Erro — tentar novamente
                          </button>
                        );
                        return (
                          <button type="button" onClick={() => handleSave(activeFile)} className="brand-gradient inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-all duration-200 hover:brightness-110">
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

      {/* Footer fixo */}
      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <span className="mr-auto min-w-0 text-xs text-muted-foreground sm:text-sm">
            {files.length > 0 ? (
              <>
                <span className="font-semibold text-foreground">{selectedCount}</span>
                <span className="hidden sm:inline"> de <span className="font-semibold text-foreground">{files.length}</span> boletos selecionados</span>
                <span className="sm:hidden">/{files.length} sel.</span>
                {outputDirName && <span className="ml-2 hidden text-primary sm:inline">→ {outputDirName}</span>}
              </>
            ) : (
              <span className="hidden sm:inline">Nenhum boleto carregado</span>
            )}
          </span>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={downloadSelected}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Baixar selecionados</span>
            <span className="sm:hidden">Baixar</span>
          </button>
          <button
            type="button"
            disabled={files.filter((f) => f.status === "concluido").length === 0}
            onClick={downloadAllZip}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <FileArchive className="size-4" />
            ZIP
          </button>
        </div>
      </footer>
    </div>
  );
}
