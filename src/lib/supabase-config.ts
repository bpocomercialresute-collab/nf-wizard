const SUPABASE_URL = "https://itaqcedhozbvrlqydlof.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0YXFjZWRob3pidnJscXlkbG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTM2NzcsImV4cCI6MjEwMTQ4OTY3N30.r76d7SiXEngiznK1lh_aciGcskdK-A99xeTGVGMvsvc";

let cachedKey: string | null = null;

export async function getOcrApiKey(): Promise<string> {
  if (cachedKey !== null) return cachedKey;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_config?key=eq.ocr_api_key&select=value`,
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      },
    );
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const data = (await res.json()) as { value: string }[];
    cachedKey = data[0]?.value ?? "helloworld";
  } catch {
    cachedKey = "helloworld";
  }
  return cachedKey;
}
