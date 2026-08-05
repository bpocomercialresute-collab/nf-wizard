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

export async function saveNF(
  file: File,
  fields: {
    numero?: string;
    data?: string;
    destinatario?: string;
    cnpj?: string;
    valor?: string;
  },
): Promise<SaveResult> {
  try {
    const hash = await sha256(file);

    if (await isDuplicate(hash)) return { ok: false, duplicate: true };

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
        file_name: file.name,
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
