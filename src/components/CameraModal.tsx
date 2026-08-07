import { useRef, useEffect, useState, useCallback } from "react";
import {
  X, Camera, RotateCcw, Check, SwitchCamera,
  AlertTriangle, Loader2, Crop,
} from "lucide-react";
import {
  perspectiveWarp, enhanceDocument, estimateOutputSize, canvasToFile,
} from "../lib/document-scan";
import type { Quad, Point } from "../lib/document-scan";

type Step = "camera" | "corners" | "processing" | "scanned";

type Props = {
  title?: string;
  onCapture: (file: File) => void;
  onClose: () => void;
};

// ---- helpers ----

function computeImageRect(
  contW: number, contH: number, imgW: number, imgH: number,
): { x: number; y: number; w: number; h: number } {
  const ca = contW / contH, ia = imgW / imgH;
  if (ia > ca) {
    const w = contW, h = contW / ia;
    return { x: 0, y: (contH - h) / 2, w, h };
  }
  const h = contH, w = contH * ia;
  return { x: (contW - w) / 2, y: 0, w, h };
}

function initQuad(w: number, h: number): Quad {
  const mx = w * 0.12, my = h * 0.12;
  return [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
}

// ---- component ----

export function CameraModal({ title = "Escanear documento", onCapture, onClose }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);   // raw captured canvas
  const overlayRef  = useRef<HTMLCanvasElement>(null);           // corner handles overlay
  const contRef     = useRef<HTMLDivElement>(null);              // viewport container

  const [step, setStep]           = useState<Step>("camera");
  const [ready, setReady]         = useState(false);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [scannedUrl, setScannedUrl]   = useState<string | null>(null);
  const [facingMode, setFacingMode]   = useState<"environment" | "user">("environment");
  const [hasMultipleCams, setHasMultipleCams] = useState(false);
  const [error, setError]  = useState<string | null>(null);
  const [flash, setFlash]  = useState(false);
  const [enhance, setEnhance] = useState(true);  // P&B vs cor

  // corners in IMAGE pixel space
  const [corners, setCorners] = useState<Quad>([[0,0],[1,0],[1,1],[0,1]]);
  const draggingRef = useRef<number | null>(null);

  // ---- camera ----

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async (mode: "environment" | "user") => {
    stopStream();
    setReady(false);
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Câmera não suportada. Use Chrome ou Safari.");
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
      setError("Sem acesso à câmera. Verifique permissões e tente novamente.");
    }
  }, [stopStream]);

  useEffect(() => {
    startCamera(facingMode);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- capture ----

  const capture = () => {
    const video = videoRef.current;
    if (!video || !ready) return;

    setFlash(true);
    setTimeout(() => setFlash(false), 140);

    const c = document.createElement("canvas");
    c.width  = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d")!;
    if (facingMode === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);

    srcCanvasRef.current = c;
    setCapturedUrl(c.toDataURL("image/jpeg", 0.92));
    setCorners(initQuad(c.width, c.height));
    setStep("corners");
    stopStream();
  };

  // ---- corners overlay draw ----

  const drawOverlay = useCallback(() => {
    const canvas  = overlayRef.current;
    const cont    = contRef.current;
    const src     = srcCanvasRef.current;
    if (!canvas || !cont || !src) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { clientWidth: cw, clientHeight: ch } = cont;
    canvas.width  = cw;
    canvas.height = ch;

    const rect = computeImageRect(cw, ch, src.width, src.height);

    // Map image-space corner → canvas-space
    const toCanvas = ([ix, iy]: Point): Point => [
      rect.x + (ix / src.width)  * rect.w,
      rect.y + (iy / src.height) * rect.h,
    ];
    const [c0, c1, c2, c3] = corners;
    const pts: [Point, Point, Point, Point] = [toCanvas(c0), toCanvas(c1), toCanvas(c2), toCanvas(c3)];

    ctx.clearRect(0, 0, cw, ch);

    // Dim outside
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.lineTo(pts[3][0], pts[3][1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.lineTo(pts[3][0], pts[3][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Handles
    pts.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(34,197,94,0.22)";
      ctx.fill();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
    });
  }, [corners]);

  useEffect(() => {
    if (step === "corners") drawOverlay();
  }, [step, corners, drawOverlay]);

  // ---- pointer events for dragging corners ----

  const pointerToImageCoords = (e: React.PointerEvent): Point => {
    const canvas = overlayRef.current!;
    const src    = srcCanvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const imgRect = computeImageRect(canvas.width, canvas.height, src.width, src.height);
    const ix = ((px - imgRect.x) / imgRect.w) * src.width;
    const iy = ((py - imgRect.y) / imgRect.h) * src.height;
    return [
      Math.max(0, Math.min(src.width,  ix)),
      Math.max(0, Math.min(src.height, iy)),
    ];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (step !== "corners") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [px, py] = pointerToImageCoords(e);
    const src = srcCanvasRef.current!;
    const imgRect = computeImageRect(
      overlayRef.current!.width, overlayRef.current!.height, src.width, src.height,
    );
    const THRESH = 50 * (src.width / imgRect.w); // 50 display px in image space
    let closest = -1, minD = THRESH;
    corners.forEach(([cx, cy], i) => {
      const d = Math.hypot(cx - px, cy - py);
      if (d < minD) { minD = d; closest = i; }
    });
    draggingRef.current = closest >= 0 ? closest : null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current === null || step !== "corners") return;
    const pt = pointerToImageCoords(e);
    const idx = draggingRef.current;
    setCorners((prev) => {
      const next = [...prev] as Quad;
      next[idx] = pt;
      return next;
    });
  };

  const onPointerUp = () => { draggingRef.current = null; };

  // ---- process: warp + enhance ----

  const process = async () => {
    const src = srcCanvasRef.current;
    if (!src) return;
    setStep("processing");

    // yield to let React paint "processing" state
    await new Promise((r) => setTimeout(r, 30));

    const { w, h } = estimateOutputSize(corners);
    const warped = perspectiveWarp(src, corners, w, h);
    const final  = enhance ? enhanceDocument(warped) : warped;
    setScannedUrl(final.toDataURL("image/jpeg", 0.92));
    // keep canvas for confirm
    srcCanvasRef.current = final;
    setStep("scanned");
  };

  const retake = async () => {
    setScannedUrl(null);
    setCapturedUrl(null);
    srcCanvasRef.current = null;
    setStep("camera");
    await startCamera(facingMode);
  };

  const confirm = async () => {
    const canvas = srcCanvasRef.current;
    if (!canvas) return;
    const file = await canvasToFile(canvas, `scan_${Date.now()}.jpg`);
    onCapture(file);
    onClose();
  };

  // ---- switch cam ----

  const switchCam = async () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    await startCamera(next);
  };

  // ---- render ----

  const showSwitch = hasMultipleCams && step === "camera";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-white opacity-80" />
      )}

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
          {step === "corners"
            ? "Ajuste os cantos do documento"
            : step === "processing"
            ? "Processando..."
            : step === "scanned"
            ? "Documento digitalizado"
            : title}
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
      <div ref={contRef} className="relative flex-1 overflow-hidden bg-black">

        {/* ---- CAMERA ---- */}
        {step === "camera" && (
          <>
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
                    {/* dimmed area */}
                    <div className="absolute inset-x-0 top-0 bg-black/50" style={{ bottom: "15%" }} />
                    <div className="absolute inset-x-0 bottom-0 bg-black/50" style={{ top: "85%" }} />
                    <div className="absolute left-0 bg-black/50" style={{ top: "15%", bottom: "15%", right: "88%" }} />
                    <div className="absolute right-0 bg-black/50" style={{ top: "15%", bottom: "15%", left: "88%" }} />
                    {/* corners */}
                    <div className="absolute" style={{ top: "15%", bottom: "15%", left: "12%", right: "12%" }}>
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

        {/* ---- CORNERS ---- */}
        {step === "corners" && capturedUrl && (
          <>
            <img
              src={capturedUrl}
              alt="Capturado"
              className="h-full w-full object-contain"
              draggable={false}
            />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 touch-none"
              style={{ cursor: "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </>
        )}

        {/* ---- PROCESSING ---- */}
        {step === "processing" && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-white">
            <Loader2 className="size-14 animate-spin text-primary" />
            <p className="text-sm text-white/70">Digitalizando documento...</p>
          </div>
        )}

        {/* ---- SCANNED ---- */}
        {step === "scanned" && scannedUrl && (
          <img
            src={scannedUrl}
            alt="Documento digitalizado"
            className="h-full w-full object-contain"
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex shrink-0 items-center justify-center gap-6 bg-black/70 px-6 py-5">

        {/* Camera step */}
        {step === "camera" && (
          <button
            type="button"
            disabled={!ready}
            onClick={capture}
            className="flex flex-col items-center gap-1.5 disabled:opacity-40"
          >
            <span className="grid size-18 place-items-center rounded-full border-4 border-white bg-white/10 transition hover:bg-white/20 active:scale-95">
              <Camera className="size-8 text-white" />
            </span>
            <span className="text-xs text-white/70">Capturar</span>
          </button>
        )}

        {/* Corners step */}
        {step === "corners" && (
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

            {/* Enhance toggle */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEnhance((v) => !v)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${enhance ? "bg-primary text-primary-foreground" : "border border-white/30 bg-white/10 text-white/70"}`}
              >
                {enhance ? "P&B (scan)" : "Cor (foto)"}
              </button>
              <span className="text-[10px] text-white/40">modo</span>
            </div>

            <button
              type="button"
              onClick={process}
              className="inline-flex flex-col items-center gap-1.5 text-white transition hover:text-primary"
            >
              <span className="grid size-16 place-items-center rounded-full bg-primary shadow-[0_0_20px_oklch(0.74_0.15_168/0.5)] transition hover:brightness-110">
                <Crop className="size-8" />
              </span>
              <span className="text-xs font-semibold">Processar</span>
            </button>
          </>
        )}

        {/* Scanned step */}
        {step === "scanned" && (
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
              <span className="text-xs font-semibold">Usar scan</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
