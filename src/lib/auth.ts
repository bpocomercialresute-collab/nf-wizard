const SUPABASE_URL = "https://itaqcedhozbvrlqydlof.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0YXFjZWRob3pidnJscXlkbG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTM2NzcsImV4cCI6MjEwMTQ4OTY3N30.r76d7SiXEngiznK1lh_aciGcskdK-A99xeTGVGMvsvc";

type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_email: string;
};

const KEY = "nfw_session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function clearSession() {
  localStorage.removeItem(KEY);
}

function isValid(s: Session): boolean {
  return s.expires_at > Math.floor(Date.now() / 1000) + 60;
}

export function isAuthenticated(): boolean {
  const s = getSession();
  return !!s && isValid(s);
}

export function getUserEmail(): string {
  return getSession()?.user_email ?? "";
}

export async function tryRefresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  if (isValid(s)) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) { clearSession(); return false; }
    const d = await res.json();
    saveSession({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (d.expires_in as number),
      user_email: (d.user as { email: string }).email,
    });
    return true;
  } catch {
    clearSession();
    return false;
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const d = await res.json();
      const msg =
        (d as { error_description?: string; msg?: string; error?: string })
          .error_description ??
        (d as { msg?: string }).msg ??
        "Credenciais inválidas";
      return { ok: false, error: msg };
    }
    const d = await res.json();
    saveSession({
      access_token: (d as { access_token: string }).access_token,
      refresh_token: (d as { refresh_token: string }).refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (d as { expires_in: number }).expires_in,
      user_email: (d as { user: { email: string } }).user.email,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Erro de conexão. Tente novamente." };
  }
}

export async function signOut(): Promise<void> {
  const s = getSession();
  if (s) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => {});
  }
  clearSession();
}
