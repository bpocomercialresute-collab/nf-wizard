import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { Lock, Mail, Eye, EyeOff, Loader2, ShieldCheck, ScanLine } from "lucide-react";

import appCss from "../styles.css?url";
import { reportNFWizardError } from "../lib/nf-wizard-error-reporting";
import { isAuthenticated, tryRefresh, signIn } from "../lib/auth";

// ---- 404 / Error ----

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportNFWizardError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

// ---- Login Screen ----

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");
    const result = await signIn(email.trim(), password);
    setLoading(false);
    if (result.ok) {
      onSuccess();
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Glow de fundo */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.74 0.15 168 / 0.12) 0%, transparent 70%)",
        }}
      />

      {/* Card */}
      <div className="animate-pop surface relative z-10 w-full max-w-sm rounded-2xl border border-border/70 shadow-[var(--shadow-glow)]">

        {/* Topo — branding */}
        <div className="flex flex-col items-center gap-4 border-b border-border/60 px-8 py-8">
          <img
            src="/brand/varremaster-full.png"
            alt="Varremaster"
            className="h-10 w-auto select-none"
            draggable={false}
          />
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <ScanLine className="size-6" />
            </span>
            <h1 className="mt-2 text-xl font-bold tracking-tight">
              <span className="brand-text">NF Wizard</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Entre com suas credenciais para acessar
            </p>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-8 py-7">
          {/* E-mail */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-email" className="text-xs font-medium text-muted-foreground">
              E-mail
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                id="login-email"
                ref={emailRef}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-primary focus:shadow-[var(--shadow-glow)]"
              />
            </div>
          </div>

          {/* Senha */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-pwd" className="text-xs font-medium text-muted-foreground">
              Senha
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                id="login-pwd"
                type={showPwd ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-11 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/50 focus:border-primary focus:shadow-[var(--shadow-glow)]"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 transition hover:text-foreground"
              >
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Erro */}
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {/* Botão */}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="brand-gradient mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </button>
        </form>

        {/* Rodapé */}
        <div className="flex items-center justify-center gap-1.5 border-t border-border/60 px-8 py-4">
          <ShieldCheck className="size-3.5 text-muted-foreground/60" />
          <p className="text-[11px] text-muted-foreground/70">
            Acesso restrito · Varremaster
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- Auth Gate ----

type AuthState = "checking" | "authenticated" | "unauthenticated";

function AuthGate() {
  const { queryClient } = Route.useRouteContext();
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    (async () => {
      const ok = isAuthenticated() || (await tryRefresh());
      setAuth(ok ? "authenticated" : "unauthenticated");
    })();
  }, []);

  if (auth === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (auth === "unauthenticated") {
    return <LoginScreen onSuccess={() => setAuth("authenticated")} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

// ---- Route ----

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "NF Wizard — Varremaster" },
      {
        name: "description",
        content:
          "NF Wizard — OCR de notas fiscais e renomeação automática de arquivos. Ferramenta Varremaster.",
      },
      { name: "author", content: "Varremaster" },
      { name: "theme-color", content: "#13A79E" },
      { property: "og:title", content: "NF Wizard — Varremaster" },
      {
        property: "og:description",
        content: "OCR de notas fiscais e renomeação automática de arquivos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/brand/varremaster-mark.jpg", type: "image/jpeg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <AuthGate />;
}
