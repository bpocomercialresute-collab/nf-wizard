import { useRef, useEffect, useState, useCallback } from "react";
import { X, Camera, RotateCcw, Check, SwitchCamera, AlertTriangle, Loader2 } from "lucide-react";

type Props = {
  title?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
};

export function CameraModal({ title = "Escanear documento", onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCams, setHasMultipleCams] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(
    async (mode: "environment" | "user") => {
      stopStream();
      setReady(false);
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Câmera não suportada neste navegador. Use Chrome ou Safari.");
        return;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        setHasMultipleCams(cams.length > 1);

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setError(
          "Sem acesso à câmera. Verifique permissões do navegador e tente novamente.",
        );
      }
    },
    [stopStream],
  );

  useEffect(() => {
    startCamera(facingMode);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bloqueio de scroll quando modal abrir
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // ESC fecha
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleClose = () => {
    stopStream();
    onClose();
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready) return;

    // Flash visual
    setFlash(true);
    setTimeout(() => setFlash(false), 150);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;

    // Espelha horizontalmente se for câmera frontal
    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0);
    setCaptured(canvas.toDataURL("image/jpeg", 0.92));
  };

  const retake = () => setCaptured(null);

  const confirm = async () => {
    if (!captured) return;
    const res = await fetch(captured);
    const blob = await res.blob();
    const file = new File([blob], `scan_${Date.now()}.jpg`, { type: "image/jpeg" });
    stopStream();
    onCapture(file);
  };

  const switchCam = async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    await startCamera(next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Flash */}
      {flash && <div className="pointer-events-none absolute inset-0 z-10 animate-ping bg-white opacity-80" />}

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between bg-black/70 px-4 py-3 text-white">
        <button
          type="button"
          onClick={handleClose}
          className="grid size-10 place-items-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </button>
        <span className="text-sm font-semibold tracking-wide">{title}</span>
        {hasMultipleCams && !captured ? (
          <button
            type="button"
            onClick={switchCam}
            className="grid size-10 place-items-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <SwitchCamera className="size-5" />
          </button>
        ) : (
          <span className="size-10" />
        )}
      </div>

      {/* Viewport */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-white">
            <AlertTriangle className="size-12 text-destructive" />
            <p className="text-sm text-white/80">{error}</p>
            <button
              type="button"
              onClick={() => startCamera(facingMode)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20"
            >
              <RotateCcw className="size-4" />
              Tentar novamente
            </button>
          </div>
        ) : captured ? (
          /* Preview da captura */
          <img
            src={captured}
            alt="Captura"
            className="h-full w-full object-contain"
          />
        ) : (
          /* Camera ao vivo */
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => setReady(true)}
              className={`h-full w-full object-cover transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"} ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
            />

            {/* Loader enquanto câmera carrega */}
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="size-10 animate-spin text-white/60" />
              </div>
            )}

            {/* Overlay do documento — área escurecida com janela central */}
            {ready && (
              <div className="pointer-events-none absolute inset-0">
                {/* Dimmed borders usando 4 divs */}
                <div className="absolute inset-x-0 top-0 bg-black/50" style={{ bottom: "15%" }} />
                <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ top: "85%" }} />
                <div
                  className="absolute left-0 bg-black/50"
                  style={{ top: "15%", bottom: "15%", right: "88%" }}
                />
                <div
                  className="absolute right-0 bg-black/50"
                  style={{ top: "15%", bottom: "15%", left: "88%" }}
                />

                {/* Moldura e cantos */}
                <div
                  className="absolute"
                  style={{ top: "15%", bottom: "15%", left: "12%", right: "12%" }}
                >
                  {/* Cantos coloridos */}
                  {[
                    "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                    "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                    "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                    "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                  ].map((cls) => (
                    <span
                      key={cls}
                      className={`absolute h-8 w-8 border-primary ${cls}`}
                    />
                  ))}

                  {/* Texto-guia */}
                  <p className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium tracking-wide text-white/70">
                    Alinhe o documento dentro da moldura
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Controles inferiores */}
      <div className="flex shrink-0 items-center justify-center gap-10 bg-black/70 px-8 py-6">
        {captured ? (
          <>
            <button
              type="button"
              onClick={retake}
              className="inline-flex flex-col items-center gap-1.5 text-white/80 transition hover:text-white"
            >
              <span className="grid size-14 place-items-center rounded-full border-2 border-white/30 bg-white/10 transition hover:bg-white/20">
                <RotateCcw className="size-6" />
              </span>
              <span className="text-xs">Refazer</span>
            </button>
            <button
              type="button"
              onClick={confirm}
              className="inline-flex flex-col items-center gap-1.5 text-white transition hover:text-primary"
            >
              <span className="grid size-16 place-items-center rounded-full bg-primary shadow-[0_0_20px_oklch(0.74_0.15_168/0.5)] transition hover:brightness-110">
                <Check className="size-8" />
              </span>
              <span className="text-xs font-semibold">Usar esta foto</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={capture}
            className="relative flex flex-col items-center gap-1.5 disabled:opacity-40"
          >
            <span className="grid size-18 place-items-center rounded-full border-4 border-white bg-white/10 transition hover:bg-white/20 active:scale-95">
              <Camera className="size-8 text-white" />
            </span>
            <span className="text-xs text-white/70">Capturar</span>
          </button>
        )}
      </div>
    </div>
  );
}
