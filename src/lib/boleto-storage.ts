const SUPABASE_URL = "https://itaqcedhozbvrlqydlof.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0YXFjZWRob3pidnJscXlkbG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTM2NzcsImV4cCI6MjEwMTQ4OTY3N30.r76d7SiXEngiznK1lh_aciGcskdK-A99xeTGVGMvsvc";

const H = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
};

export type BoletoRecord = {
  id: string;
  file_hash: string;
  file_name: string;
  vencimento?: string;
  valor?: string;
  beneficiario?: string;
  cnpj_beneficiario?: string;
  numero_documento?: string;
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

async function isDuplicate(hash: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/boleto_uploads?file_hash=eq.${hash}&select=id&limit=1`,
    { headers: { ...H, "Content-Type": "application/json" } },
  );
  const data = (await res.json()) as { id: string }[];
  return data.length > 0;
}

export async function saveBoleto(
  file: File,
  fields: {
    vencimento?: string;
    valor?: string;
    beneficiario?: string;
    cnpj_beneficiario?: string;
    numero_documento?: string;
  },
  displayName?: string,
): Promise<SaveResult> {
  try {
    const hash = await sha256(file);
    if (await isDuplicate(hash)) return { ok: false, duplicate: true };

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const storagePath = `${hash}.${ext}`;
    const mimeType = file.type || "application/octet-stream";

    await fetch(`${SUPABASE_URL}/storage/v1/object/boleto-images/${storagePath}`, {
      method: "POST",
      headers: { ...H, "Content-Type": mimeType, "x-upsert": "false" },
      body: file,
    });

    const res = await fetch(`${SUPABASE_URL}/rest/v1/boleto_uploads`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        file_hash: hash,
        file_name: displayName ?? file.name,
        vencimento: fields.vencimento ?? null,
        valor: fields.valor ?? null,
        beneficiario: fields.beneficiario ?? null,
        cnpj_beneficiario: fields.cnpj_beneficiario ?? null,
        numero_documento: fields.numero_documento ?? null,
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

export async function updateBoleto(
  id: string,
  fields: Partial<Pick<BoletoRecord, "vencimento" | "valor" | "beneficiario" | "cnpj_beneficiario" | "numero_documento" | "file_name">>,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/boleto_uploads?id=eq.${id}`,
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

export async function deleteBoleto(id: string, storagePath?: string): Promise<boolean> {
  try {
    if (storagePath) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/boleto-images/${storagePath}`, {
        method: "DELETE",
        headers: H,
      });
    }
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/boleto_uploads?id=eq.${id}`,
      { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function listBoletos(): Promise<BoletoRecord[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/boleto_uploads?select=*&order=created_at.desc`,
    { headers: { ...H, "Content-Type": "application/json" } },
  );
  if (!res.ok) return [];
  return (await res.json()) as BoletoRecord[];
}

export function boletoStorageUrl(storagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/boleto-images/${storagePath}`;
}

// DD/MM/YYYY -> Date (meia-noite horário local)
export function parseVencimento(v: string): Date | null {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export type VencimentoStatus = "vencido" | "hoje" | "proximo" | "em_dia" | "sem_data";

export function vencimentoStatus(vencimento?: string): VencimentoStatus {
  if (!vencimento) return "sem_data";
  const due = parseVencimento(vencimento);
  if (!due) return "sem_data";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueClean = new Date(due);
  dueClean.setHours(0, 0, 0, 0);
  const diff = Math.round((dueClean.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "vencido";
  if (diff === 0) return "hoje";
  if (diff <= 7) return "proximo";
  return "em_dia";
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
