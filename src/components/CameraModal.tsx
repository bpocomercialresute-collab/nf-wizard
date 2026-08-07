import { useRef, useEffect, useState, useCallback } from "react";
import {
  X, Camera, RotateCcw, Check, SwitchCamera,
  AlertTriangle, Loader2, WifiOff,
} from "lucide-react";
import {
  loadOpenCV, autoDetectDocument,
  perspectiveWarp, enhanceDocument, estimateOutputSize, canvasToFile,
} from "../lib/document-scan";

type Step = "camera" | "processing" | "scanned";

type Props = {
  title?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
};

export function CameraModal({ title = "Escanear documento", onCapture, onClose }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const srcRef     = useRef<HTMLCanvasElement | null>(null);  // scanned result canvas

  const [step, setStep]         = useState<Step>("camera");
  const [ready, setReady]       = useState(false);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [autoWarning, setAutoWarning] = useState(false); // detection failed, used full image
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCams, setHasMultipleCams] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [flash, setFlash]       = useState(false);
  const [cvStatus, setCvStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // ---- camera ----

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (mode: "environment" | "user") => {
    stopStream();
    setReady(false);
    setCamError(null);

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

  useEffect(() => {
    startCamera(facingMode);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-load OpenCV in background as soon as modal opens
  useEffect(() => {
    setCvStatus("loading");
    loadOpenCV()
      .then(() => setCvStatus("ready"))
      .catch(() => setCvStatus("error"));
  }, []);

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

  // ---- capture → auto-process ----

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

    // Let React paint "processing" before heavy computation
    await new Promise((r) => setTimeout(r, 40));

    try {
      // Try auto-detect document corners
      const quad = autoDetectDocument(raw);
      let result: HTMLCanvasElement;

      if (quad) {
        const { w, h } = estimateOutputSize(quad);
        const warped = perspectiveWarp(raw, quad, w, h);
        result = enhanceDocument(warped);
        setAutoWarning(false);
      } else {
        // No clear document boundary found — enhance the full photo
        result = enhanceDocument(raw);
        setAutoWarning(true);
      }

      srcRef.current = result;
      setScannedUrl(result.toDataURL("image/jpeg", 0.92));
    } catch {
      // Fallback: use raw photo
      srcRef.current = raw;
      setScannedUrl(raw.toDataURL("image/jpeg", 0.92));
      setAutoWarning(true);
    }

    setStep("scanned");
  };

  const retake = async () => {
    setScannedUrl(null);
    setAutoWarning(false);
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

        <span className="text-sm font-semibold tracking-wide">
          {step === "processing" ? "Digitalizando..." : step === "scanned" ? "Documento pronto" : title}
        </span>

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
                    <div className="absolute inset-x-0 top-0 bg-black/50" style={{ bottom: "20%" }} />
                    <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ top: "80%" }} />
                    <div className="absolute left-0 bg-black/50" style={{ top: "20%", bottom: "20%", right: "85%" }} />
                    <div className="absolute right-0 bg-black/50" style={{ top: "20%", bottom: "20%", left: "85%" }} />
                    {/* Corner markers */}
                    <div className="absolute" style={{ top: "20%", bottom: "20%", left: "15%", right: "15%" }}>
                      {[
                        "top-0 left-0 border-t-2 border-l-2 rounded-tl-lg",
                        "top-0 right-0 border-t-2 border-r-2 rounded-tr-lg",
                        "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg",
                        "bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg",
                      ].map((cls) => (
                        <span key={cls} className={`absolute h-8 w-8 border-primary ${cls}`} />
                      ))}
                      <p className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium text-white/70">
                        Posicione o documento dentro da moldura
                      </p>
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
            <Loader2 className="size-16 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-base font-semibold">Digitalizando documento…</p>
              {cvStatus === "loading" && (
                <p className="mt-1 text-sm text-white/60">Carregando scanner (primeira vez)…</p>
              )}
              {cvStatus === "error" && (
                <div className="mt-2 flex items-center justify-center gap-2 text-sm text-yellow-400">
                  <WifiOff className="size-4" />
                  OpenCV não disponível — usando filtro simples
                </div>
              )}
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
              <div className="flex items-center justify-center gap-2 bg-yellow-500/20 px-4 py-2 text-center text-xs font-medium text-yellow-300">
                <AlertTriangle className="size-3.5 shrink-0" />
                Bordas do documento não detectadas — tente com fundo contrastante
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
            <span className="grid size-20 place-items-center rounded-full border-4 border-white bg-white/10 transition hover:bg-white/20 active:scale-95">
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
