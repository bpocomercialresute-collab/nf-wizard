import { useRef, useEffect, useState, useCallback } from "react";
import {
  X, Camera, RotateCcw, Check, SwitchCamera, AlertTriangle, Loader2, Scan,
} from "lucide-react";
import {
  loadOpenCV, isOpenCVReady, scanDocument, detectPaper, canvasToFile,
} from "../lib/document-scan";

type Step = "camera" | "processing" | "scanned";

type Props = {
  title?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
};

export function CameraModal({ title = "Escanear documento", onCapture, onClose }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const srcRef    = useRef<HTMLCanvasElement | null>(null);

  const [step, setStep]             = useState<Step>("camera");
  const [ready, setReady]           = useState(false);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [detected, setDetected]     = useState<boolean | null>(null);
  const [autoWarning, setAutoWarning] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCams, setHasMultipleCams] = useState(false);
  const [camError, setCamError]     = useState<string | null>(null);
  const [flash, setFlash]           = useState(false);
  const [cvReady, setCvReady]       = useState(() => isOpenCVReady());

  // ---- Camera ----

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (mode: "environment" | "user") => {
    stopStream();
    setReady(false);
    setCamError(null);
    setDetected(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("Câmera não suportada. Use Chrome ou Safari.");
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setHasMultipleCams(devices.filter((d) => d.kind === "videoinput").length > 1);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCamError("Sem acesso à câmera. Verifique permissões e tente novamente.");
    }
  }, [stopStream]);

  // Start camera + OpenCV in parallel (OpenCV loads in background, doesn't block UI)
  useEffect(() => {
    startCamera(facingMode);

    if (!isOpenCVReady()) {
      loadOpenCV()
        .then(() => setCvReady(true))
        .catch(() => { /* silently fall back — capture still works */ });
    }

    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time paper detection — only when OpenCV is ready
  useEffect(() => {
    if (step !== "camera" || !ready || !cvReady) return;

    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    const check = async () => {
      if (cancelled) return;
      const found = await detectPaper(video);
      if (!cancelled) {
        setDetected(found);
        setTimeout(check, 700);
      }
    };

    const t = setTimeout(check, 1000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [step, ready, cvReady]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleClose = () => { stopStream(); onClose(); };

  // ---- Capture → jscanify warp + enhance ----

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !ready) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 140);

    const raw = document.createElement("canvas");
    raw.width  = video.videoWidth;
    raw.height = video.videoHeight;
    const ctx  = raw.getContext("2d")!;
    if (facingMode === "user") { ctx.translate(raw.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);

    stopStream();
    setStep("processing");

    // Let React paint the processing state before heavy compute
    await new Promise((r) => setTimeout(r, 30));

    const { canvas, detected: doc } = await scanDocument(raw);
    srcRef.current = canvas;
    setScannedUrl(canvas.toDataURL("image/jpeg", 0.92));
    setAutoWarning(!doc);
    setStep("scanned");
  };

  const retake = async () => {
    setScannedUrl(null);
    setAutoWarning(false);
    setDetected(null);
    srcRef.current = null;
    setStep("camera");
    await startCamera(facingMode);
  };

  const confirm = async () => {
    const canvas = srcRef.current;
    if (!canvas) return;
    const file = await canvasToFile(canvas, `scan_${Date.now()}.jpg`);
    onCapture(file);
    onClose();
  };

  const switchCam = async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    await startCamera(next);
  };

  const borderColor =
    detected === true  ? "border-green-400" :
    detected === false ? "border-yellow-400" :
    "border-white";

  const showSwitch = hasMultipleCams && step === "camera";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {flash && <div className="pointer-events-none absolute inset-0 z-10 bg-white opacity-80" />}

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between bg-black/70 px-4 py-3 text-white">
        <button
          type="button"
          onClick={handleClose}
          className="grid size-10 place-items-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </button>

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-sm font-semibold tracking-wide">
            {step === "processing" ? "Processando…" : step === "scanned" ? "Documento pronto" : title}
          </span>
          {step === "camera" && (
            <span className={`flex items-center gap-1 text-[10px] ${cvReady ? "text-green-400" : "text-white/40"}`}>
              <Scan className="size-2.5" />
              {cvReady ? "Scanner com perspectiva ativo" : "Carregando scanner…"}
            </span>
          )}
        </div>

        {showSwitch ? (
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

        {/* Camera */}
        {step === "camera" && (
          <>
            {camError ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-white">
                <AlertTriangle className="size-12 text-destructive" />
                <p className="text-sm text-white/80">{camError}</p>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20"
                >
                  <RotateCcw className="size-4" />
                  Tentar novamente
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => setReady(true)}
                  className={`h-full w-full object-cover transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"} ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
                />
                {!ready && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="size-10 animate-spin text-white/60" />
                  </div>
                )}
                {ready && (
                  <div className="pointer-events-none absolute inset-0">
                    {/* Dimmed borders */}
                    <div className="absolute inset-x-0 top-0 bg-black/50" style={{ bottom: "18%" }} />
                    <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ top: "82%" }} />
                    <div className="absolute left-0 bg-black/50" style={{ top: "18%", bottom: "18%", right: "88%" }} />
                    <div className="absolute right-0 bg-black/50" style={{ top: "18%", bottom: "18%", left: "88%" }} />

                    {/* Document frame — cor muda com detecção */}
                    <div className="absolute" style={{ top: "18%", bottom: "18%", left: "12%", right: "12%" }}>
                      {([
                        "top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg",
                        "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg",
                        "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg",
                        "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg",
                      ] as const).map((cls) => (
                        <span
                          key={cls}
                          className={`absolute h-10 w-10 transition-colors duration-300 ${borderColor} ${cls}`}
                        />
                      ))}

                      {/* Status label */}
                      <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                        {detected === true && (
                          <span className="rounded-full bg-green-500/80 px-3 py-0.5 text-[11px] font-semibold text-white">
                            Documento detectado — pode fotografar
                          </span>
                        )}
                        {detected === false && (
                          <span className="rounded-full bg-yellow-500/70 px-3 py-0.5 text-[11px] font-semibold text-white">
                            Aponte para o documento
                          </span>
                        )}
                        {detected === null && (
                          <span className="rounded-full bg-black/50 px-3 py-0.5 text-[11px] text-white/70">
                            Posicione o documento dentro da moldura
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* Processing */}
        {step === "processing" && (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-white">
            <div className="relative">
              <Loader2 className="size-20 animate-spin text-primary" />
              <span className="absolute inset-0 flex items-center justify-center">
                <Scan className="size-8 text-white/60" />
              </span>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">Escaneando documento…</p>
              <p className="mt-1 text-sm text-white/60">
                Detectando bordas e corrigindo perspectiva
              </p>
            </div>
          </div>
        )}

        {/* Scanned result */}
        {step === "scanned" && scannedUrl && (
          <div className="flex h-full flex-col">
            <img
              src={scannedUrl}
              alt="Documento digitalizado"
              className="min-h-0 flex-1 object-contain"
            />
            {autoWarning && (
              <div className="flex items-center justify-center gap-2 bg-yellow-500/15 px-4 py-2 text-center text-xs font-medium text-yellow-300">
                <AlertTriangle className="size-3.5 shrink-0" />
                Bordas não detectadas — use fundo escuro para melhor resultado
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex shrink-0 items-center justify-center gap-8 bg-black/70 px-6 py-5">
        {step === "camera" && (
          <button
            type="button"
            disabled={!ready}
            onClick={capture}
            className="flex flex-col items-center gap-1.5 disabled:opacity-40"
          >
            <span
              className={`relative grid size-20 place-items-center rounded-full border-4 bg-white/10 transition-all duration-300 active:scale-95 hover:bg-white/20 ${
                detected === true
                  ? "border-green-400 shadow-[0_0_28px_rgba(74,222,128,0.5)]"
                  : "border-white"
              }`}
            >
              <Camera className="size-9 text-white" />
            </span>
            <span className="text-xs text-white/70">Escanear</span>
          </button>
        )}

        {step === "scanned" && (
          <>
            <button
              type="button"
              onClick={retake}
              className="flex flex-col items-center gap-1.5 text-white/80 transition hover:text-white"
            >
              <span className="grid size-14 place-items-center rounded-full border-2 border-white/30 bg-white/10 transition hover:bg-white/20">
                <RotateCcw className="size-6" />
              </span>
              <span className="text-xs">Refazer</span>
            </button>
            <button
              type="button"
              onClick={confirm}
              className="flex flex-col items-center gap-1.5 text-white transition hover:text-primary"
            >
              <span className="grid size-16 place-items-center rounded-full bg-primary shadow-[0_0_20px_oklch(0.74_0.15_168/0.5)] transition hover:brightness-110">
                <Check className="size-8" />
              </span>
              <span className="text-xs font-semibold">Usar scan</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
