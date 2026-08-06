const SUPABASE_URL = "https://itaqcedhozbvrlqydlof.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0YXFjZWRob3pidnJscXlkbG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTM2NzcsImV4cCI6MjEwMTQ4OTY3N30.r76d7SiXEngiznK1lh_aciGcskdK-A99xeTGVGMvsvc";

const H = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
};

export type NFRecord = {
  id: string;
  file_hash: string;
  file_name: string;
  nf_numero?: string;
  nf_data?: string;
  nf_destinatario?: string;
  nf_cnpj?: string;
  nf_valor?: string;
  storage_path?: string;
  created_at: string;
};

export type SaveResult =
  | { ok: true }
  | { ok: false; duplicate: true }
  | { ok: false; duplicate: false; error: string };

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getFileHash(file: File): Promise<string> {
  return sha256(file);
}

export async function isDuplicate(hash: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_uploads?file_hash=eq.${hash}&select=id&limit=1`,
    { headers: { ...H, "Content-Type": "application/json" } },
  );
  const data = (await res.json()) as { id: string }[];
  return data.length > 0;
}

export async function isDuplicateNumero(numero: string): Promise<boolean> {
  if (!numero) return false;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_uploads?nf_numero=eq.${encodeURIComponent(numero)}&select=id&limit=1`,
    { headers: { ...H, "Content-Type": "application/json" } },
  );
  const data = (await res.json()) as { id: string }[];
  return data.length > 0;
}

export async function saveNF(
  file: File,
  fields: {
    numero?: string;
    data?: string;
    destinatario?: string;
    cnpj?: string;
    valor?: string;
  },
  displayName?: string,
): Promise<SaveResult> {
  try {
    const hash = await sha256(file);

    if (await isDuplicate(hash)) return { ok: false, duplicate: true };
    if (fields.numero && await isDuplicateNumero(fields.numero))
      return { ok: false, duplicate: true };

    // Upload imagem para o Storage
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const storagePath = `${hash}.${ext}`;
    const mimeType = file.type || "application/octet-stream";

    await fetch(`${SUPABASE_URL}/storage/v1/object/nf-images/${storagePath}`, {
      method: "POST",
      headers: { ...H, "Content-Type": mimeType, "x-upsert": "false" },
      body: file,
    });

    // Salva metadados
    const res = await fetch(`${SUPABASE_URL}/rest/v1/nf_uploads`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        file_hash: hash,
        file_name: displayName ?? file.name,
        nf_numero: fields.numero ?? null,
        nf_data: fields.data ?? null,
        nf_destinatario: fields.destinatario ?? null,
        nf_cnpj: fields.cnpj ?? null,
        nf_valor: fields.valor ?? null,
        storage_path: storagePath,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if (txt.includes("duplicate") || txt.includes("unique"))
        return { ok: false, duplicate: true };
      throw new Error(txt);
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      duplicate: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function updateNF(
  id: string,
  fields: Partial<Pick<NFRecord, "nf_numero" | "nf_data" | "nf_destinatario" | "nf_cnpj" | "nf_valor" | "file_name">>,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/nf_uploads?id=eq.${id}`,
      {
        method: "PATCH",
        headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(fields),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteNF(id: string, storagePath?: string): Promise<boolean> {
  try {
    if (storagePath) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/nf-images/${storagePath}`, {
        method: "DELETE",
        headers: H,
      });
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/nf_uploads?id=eq.${id}`,
      { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function listNFs(): Promise<NFRecord[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_uploads?select=*&order=created_at.desc`,
    { headers: { ...H, "Content-Type": "application/json" } },
  );
  if (!res.ok) return [];
  return (await res.json()) as NFRecord[];
}

export function storageUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/nf-images/${storagePath}`;
}

export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ── Relatórios Semanais ───────────────────────────────────────────────────────

export type NFReport = {
  id: string;
  week_start: string;
  week_end: string;
  week_label: string;
  storage_path: string;
  nf_count: number;
  total_valor: number | null;
  created_at: string;
};

export async function listSavedReports(): Promise<NFReport[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nf_reports?select=*&order=week_start.desc`,
    { headers: { ...H, "Content-Type": "application/json" } },
  );
  if (!res.ok) return [];
  return (await res.json()) as NFReport[];
}

export function reportStorageUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/nf-reports/${storagePath}?t=${Date.now()}`;
}

export async function deleteOldReports(weekStart: string): Promise<void> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/nf_reports?week_start=eq.${weekStart}&select=id,storage_path`,
      { headers: { ...H, "Content-Type": "application/json" } },
    );
    if (!res.ok) return;
    const existing = (await res.json()) as { id: string; storage_path: string }[];
    for (const e of existing) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/nf-reports/${e.storage_path}`, {
        method: "DELETE",
        headers: H,
      });
      await fetch(`${SUPABASE_URL}/rest/v1/nf_reports?id=eq.${e.id}`, {
        method: "DELETE",
        headers: { ...H, Prefer: "return=minimal" },
      });
    }
  } catch { /* ignora */ }
}

export async function saveReportToStorage(
  pdfBytes: Uint8Array,
  weekStart: string,
  weekEnd: string,
  weekLabel: string,
  nfCount: number,
): Promise<{ ok: true; storage_path: string } | { ok: false; error: string }> {
  try {
    await deleteOldReports(weekStart);

    const storagePath = `${weekStart}_${Date.now()}.pdf`;

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/nf-reports/${storagePath}`,
      {
        method: "POST",
        headers: { ...H, "Content-Type": "application/pdf", "x-upsert": "true" },
        body: new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" }),
      },
    );
    if (!uploadRes.ok) throw new Error(`Upload falhou: ${uploadRes.status}`);

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/nf_reports`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        week_start: weekStart,
        week_end: weekEnd,
        week_label: weekLabel,
        storage_path: storagePath,
        nf_count: nfCount,
        total_valor: 0,
      }),
    });
    if (!insertRes.ok) throw new Error(`Insert falhou: ${insertRes.status}`);

    return { ok: true, storage_path: storagePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
