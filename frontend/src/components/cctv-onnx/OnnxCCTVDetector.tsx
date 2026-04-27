import { useRef, useEffect, useState, useCallback } from 'react';
import * as ort from 'onnxruntime-web';
import {
  Play, Square, Upload, Camera, Video,
  AlertTriangle, Shield, ShieldCheck, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';

// ── ONNX wasm runtime — load from CDN so no Vite config is needed ────────────
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
ort.env.wasm.numThreads = 1;

// ── Constants ────────────────────────────────────────────────────────────────

const INPUT_SIZE = 640;

// Default class names — edit or override via the UI to match your model
const DEFAULT_CLASSES = ['person', 'helmet', 'no-helmet'];

const CLASS_COLORS: Record<string, string> = {
  person: '#3b82f6',
  helmet: '#22c55e',
  'no-helmet': '#ef4444',
};
const FALLBACK_COLOR = '#f59e0b';

// ── Types ────────────────────────────────────────────────────────────────────

interface Detection {
  x1: number; y1: number; x2: number; y2: number;
  score: number; classId: number; label: string;
}

type ModelStatus = 'none' | 'loading' | 'ready' | 'error';
type VideoSource = 'webcam' | 'file';

// ── Pure helpers (no React state) ────────────────────────────────────────────

function calcIoU(a: Detection, b: Detection): number {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bA = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (aA + bA - inter + 1e-6);
}

function nms(dets: Detection[], iouThresh: number): Detection[] {
  dets.sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of dets) {
    if (!keep.some(k => k.classId === d.classId && calcIoU(d, k) > iouThresh)) {
      keep.push(d);
    }
  }
  return keep;
}

// Resize frame onto a 640×640 offscreen canvas and return CHW Float32 tensor
function preprocessFrame(
  src: HTMLVideoElement,
  offscreen: HTMLCanvasElement,
): Float32Array {
  const ctx = offscreen.getContext('2d')!;
  offscreen.width = INPUT_SIZE;
  offscreen.height = INPUT_SIZE;
  ctx.drawImage(src, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const n = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    tensor[i]         = data[i * 4]     / 255; // R plane
    tensor[n + i]     = data[i * 4 + 1] / 255; // G plane
    tensor[2 * n + i] = data[i * 4 + 2] / 255; // B plane
  }
  return tensor;
}

// Parse raw YOLOv8/v11 ONNX output [1, 4+C, 8400] → Detection[]
function parseOutput(
  outputData: Float32Array,
  numAnchors: number,
  numClasses: number,
  scaleX: number,
  scaleY: number,
  confThresh: number,
  iouThresh: number,
  classNames: string[],
): Detection[] {
  const dets: Detection[] = [];

  for (let i = 0; i < numAnchors; i++) {
    let maxScore = confThresh;
    let classId = -1;
    for (let c = 0; c < numClasses; c++) {
      const s = outputData[(4 + c) * numAnchors + i];
      if (s > maxScore) { maxScore = s; classId = c; }
    }
    if (classId < 0) continue;

    const cx = outputData[0 * numAnchors + i] * scaleX;
    const cy = outputData[1 * numAnchors + i] * scaleY;
    const w  = outputData[2 * numAnchors + i] * scaleX;
    const h  = outputData[3 * numAnchors + i] * scaleY;

    dets.push({
      x1: cx - w / 2, y1: cy - h / 2,
      x2: cx + w / 2, y2: cy + h / 2,
      score: maxScore, classId,
      label: classNames[classId] ?? `class_${classId}`,
    });
  }

  return nms(dets, iouThresh);
}

function drawDetections(ctx: CanvasRenderingContext2D, dets: Detection[]) {
  ctx.font = 'bold 12px monospace';
  for (const d of dets) {
    const color = CLASS_COLORS[d.label] ?? FALLBACK_COLOR;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);

    const txt = `${d.label} ${(d.score * 100).toFixed(0)}%`;
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = color;
    ctx.fillRect(d.x1, d.y1 - 20, tw + 8, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(txt, d.x1 + 4, d.y1 - 5);
  }
}

// ── Main Component ───────────────────────────────────────────────────────────

export function OnnxCCTVDetector() {
  // DOM refs
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const offscreen   = useRef(document.createElement('canvas'));

  // Runtime refs (read inside rAF loop — avoid stale closures)
  const sessionRef  = useRef<ort.InferenceSession | null>(null);
  const animRef     = useRef<number>(0);
  const streamRef   = useRef<MediaStream | null>(null);
  const lastInferTs = useRef<number>(0);
  const lastDets    = useRef<Detection[]>([]);

  // Config refs mirrored from state so the loop reads current values
  const confRef     = useRef(0.4);
  const iouRef      = useRef(0.5);
  const classRef    = useRef<string[]>(DEFAULT_CLASSES);

  // React state (for UI only)
  const [modelStatus,   setModelStatus]   = useState<ModelStatus>('none');
  const [modelFileName, setModelFileName] = useState<string | null>(null);
  const [running,       setRunning]       = useState(false);
  const [source,        setSource]        = useState<VideoSource>('webcam');
  const [fps,           setFps]           = useState(0);
  const [detections,    setDetections]    = useState<Detection[]>([]);
  const [conf,          setConf]          = useState(0.4);
  const [classNames,    setClassNames]    = useState<string[]>(DEFAULT_CLASSES);
  const [errorMsg,      setErrorMsg]      = useState<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => { confRef.current  = conf; },        [conf]);
  useEffect(() => { classRef.current = classNames; },  [classNames]);

  // ── Model loading ──────────────────────────────────────────────────────────

  const loadSession = useCallback(async (src: string | ArrayBuffer) => {
    setModelStatus('loading');
    setErrorMsg(null);
    try {
      sessionRef.current = await ort.InferenceSession.create(src as ArrayBuffer, {
        executionProviders: ['wasm'],
      });
      setModelStatus('ready');
    } catch (e) {
      setModelStatus('error');
      setErrorMsg(String(e));
    }
  }, []);

  const handleModelFile = useCallback((file: File) => {
    setModelFileName(file.name);
    file.arrayBuffer().then(loadSession);
  }, [loadSession]);

  const loadFromPublic = useCallback(() => {
    setModelFileName('yolo11n.onnx');
    loadSession('/yolo11n.onnx');
  }, [loadSession]);

  // ── Inference loop ─────────────────────────────────────────────────────────

  const loop = useCallback(async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !sessionRef.current) return;
    if (video.readyState < 2) {
      animRef.current = requestAnimationFrame(loop);
      return;
    }

    // Set canvas size once when video dimensions arrive
    if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Throttle inference to ~15 fps regardless of monitor refresh rate
    const now = performance.now();
    if (now - lastInferTs.current >= 66) {
      lastInferTs.current = now;
      try {
        const tensor = preprocessFrame(video, offscreen.current);
        const feeds  = { images: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]) };
        const result = await sessionRef.current.run(feeds);
        const out    = result[Object.keys(result)[0]];
        const data   = out.data as Float32Array;
        const numAnchors = out.dims[2];
        const numClasses = out.dims[1] - 4;

        const dets = parseOutput(
          data, numAnchors, numClasses,
          canvas.width  / INPUT_SIZE,
          canvas.height / INPUT_SIZE,
          confRef.current, iouRef.current, classRef.current,
        );

        lastDets.current = dets;
        setDetections([...dets]);
        setFps(Math.round(1000 / (performance.now() - now)));
      } catch {
        // keep last detections on inference error
      }
    }

    drawDetections(ctx, lastDets.current);
    animRef.current = requestAnimationFrame(loop);
  }, []); // stable — reads config via refs

  // ── Start / stop ───────────────────────────────────────────────────────────

  const startDetection = useCallback(async () => {
    if (!sessionRef.current) return;

    if (source === 'webcam') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setErrorMsg('Webcam access denied — check browser permissions');
        return;
      }
    } else {
      videoRef.current?.play();
    }

    setRunning(true);
    lastDets.current = [];
    animRef.current = requestAnimationFrame(loop);
  }, [source, loop]);

  const stopDetection = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setFps(0);
    setDetections([]);
    lastDets.current = [];
  }, []);

  const handleVideoFile = useCallback((file: File) => {
    if (!videoRef.current) return;
    videoRef.current.src = URL.createObjectURL(file);
    videoRef.current.loop = true;
    videoRef.current.muted = true;
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  // ── Derived display values ─────────────────────────────────────────────────

  const count = (label: string) => detections.filter(d => d.label === label).length;
  const violation = count('no-helmet') > 0;

  const statusStyle = {
    none:    { bg: '#f3f4f6', color: '#9ca3af', border: '#e5e7eb' },
    loading: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
    ready:   { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    error:   { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  }[modelStatus];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f2f2f0] p-6">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">ONNX CCTV Detector</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              In-browser YOLOv11 · WebAssembly · no backend required
            </p>
          </div>
          <Badge
            className="text-xs px-3 py-1"
            style={{
              background: statusStyle.bg,
              color: statusStyle.color,
              border: `1px solid ${statusStyle.border}`,
            }}
          >
            {modelStatus === 'none'    && 'No model loaded'}
            {modelStatus === 'loading' && 'Loading model…'}
            {modelStatus === 'ready'   && `Ready · ${modelFileName}`}
            {modelStatus === 'error'   && 'Model error'}
          </Badge>
        </div>

        {/* Body */}
        <div className="grid grid-cols-[1fr_288px] gap-4 items-start">

          {/* ── Video canvas ── */}
          <div className="bg-white rounded-2xl border border-black/[0.08] overflow-hidden shadow-sm">
            <div className="relative bg-gray-950" style={{ aspectRatio: '16/9' }}>
              {/* hidden video element — canvas is the visible surface */}
              <video ref={videoRef} className="hidden" playsInline muted />
              <canvas ref={canvasRef} className="w-full h-full object-contain" />

              {!running && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center">
                    <Camera className="w-7 h-7 text-white/25" />
                  </div>
                  <p className="text-white/30 text-sm">
                    {modelStatus !== 'ready' ? 'Load a model to begin' : 'Press Start Detection'}
                  </p>
                </div>
              )}

              {running && (
                <>
                  <div className="absolute top-3 left-3 bg-red-500 rounded-full w-2 h-2 animate-pulse" />
                  <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm rounded-lg px-2.5 py-1 text-white text-xs font-mono">
                    {fps} fps
                  </div>
                  {violation && (
                    <div className="absolute bottom-3 left-3 right-3 bg-red-500/90 backdrop-blur-sm rounded-xl p-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-white shrink-0" />
                      <span className="text-white text-sm font-semibold">
                        Helmet violation — {count('no-helmet')} worker{count('no-helmet') > 1 ? 's' : ''} without helmet
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Controls bar */}
            <div className="px-4 py-3 flex items-center gap-3 border-t border-black/[0.06]">
              {/* Source toggle */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                {(['webcam', 'file'] as VideoSource[]).map(s => (
                  <button
                    key={s}
                    onClick={() => { if (!running) setSource(s); }}
                    className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                      source === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'
                    } ${running ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {s === 'webcam' ? <Camera className="w-3 h-3" /> : <Video className="w-3 h-3" />}
                    {s === 'webcam' ? 'Webcam' : 'Video file'}
                  </button>
                ))}
              </div>

              {source === 'file' && !running && (
                <label className="text-xs text-gray-500 cursor-pointer hover:text-gray-900 transition-colors flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5">
                  <Upload className="w-3 h-3" />
                  Choose file
                  <input
                    type="file" className="hidden" accept="video/*"
                    onChange={e => e.target.files?.[0] && handleVideoFile(e.target.files[0])}
                  />
                </label>
              )}

              <div className="flex-1" />

              <Button
                size="sm"
                disabled={modelStatus !== 'ready'}
                onClick={running ? stopDetection : startDetection}
                className={`text-xs h-8 ${running
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-gray-900 hover:bg-gray-800 text-white'
                }`}
              >
                {running
                  ? <><Square className="w-3.5 h-3.5 mr-1.5" />Stop</>
                  : <><Play  className="w-3.5 h-3.5 mr-1.5" />Start Detection</>
                }
              </Button>
            </div>
          </div>

          {/* ── Side panel ── */}
          <div className="space-y-3">

            {/* Model loader */}
            <div className="bg-white rounded-2xl border border-black/[0.08] p-4 space-y-3 shadow-sm">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Model</p>

              <label className="block cursor-pointer group">
                <div className="border-2 border-dashed border-gray-200 group-hover:border-gray-400 rounded-xl p-4 text-center transition-colors">
                  <Upload className="w-5 h-5 text-gray-300 group-hover:text-gray-500 mx-auto mb-1.5 transition-colors" />
                  <p className="text-xs text-gray-400 font-medium">Upload .onnx file</p>
                  <p className="text-[10px] text-gray-300 mt-0.5">yolo11n / yolo11s / custom</p>
                </div>
                <input type="file" className="hidden" accept=".onnx"
                  onChange={e => e.target.files?.[0] && handleModelFile(e.target.files[0])}
                />
              </label>

              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-[10px] text-gray-300">or</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              <Button
                variant="outline" size="sm"
                className="w-full text-xs h-8"
                disabled={modelStatus === 'loading'}
                onClick={loadFromPublic}
              >
                Load /yolo11n.onnx (public folder)
              </Button>

              {errorMsg && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-500 leading-relaxed break-all">{errorMsg}</p>
                </div>
              )}
            </div>

            {/* Detection counts */}
            <div className="bg-white rounded-2xl border border-black/[0.08] p-4 space-y-3 shadow-sm">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Live Detections</p>
              <StatRow icon={<Users       className="w-3.5 h-3.5 text-blue-400"  />} label="People"     value={count('person')}    active={count('person')    > 0} color="#3b82f6" />
              <StatRow icon={<ShieldCheck className="w-3.5 h-3.5 text-green-400" />} label="Helmet on"  value={count('helmet')}    active={count('helmet')    > 0} color="#22c55e" />
              <StatRow icon={<Shield      className="w-3.5 h-3.5 text-red-400"   />} label="No helmet"  value={count('no-helmet')} active={count('no-helmet') > 0} color="#ef4444" />

              {violation && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <p className="text-[11px] text-red-600 font-semibold">Safety violation active</p>
                </div>
              )}
            </div>

            {/* Confidence slider */}
            <div className="bg-white rounded-2xl border border-black/[0.08] p-4 space-y-3 shadow-sm">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Settings</p>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Confidence threshold</span>
                  <span className="text-xs font-mono font-bold text-gray-900">
                    {(conf * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  min={10} max={90} step={5}
                  value={[conf * 100]}
                  onValueChange={([v]) => setConf(v / 100)}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-500">Class names (match your model, comma-separated)</p>
                <input
                  className="w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-2 font-mono text-gray-700 focus:outline-none focus:border-gray-400 transition-colors"
                  value={classNames.join(', ')}
                  onChange={e =>
                    setClassNames(e.target.value.split(',').map(s => s.trim()).filter(Boolean))
                  }
                  placeholder="person, helmet, no-helmet"
                />
              </div>
            </div>

            {/* How-to hint */}
            <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3.5">
              <p className="text-[10px] text-gray-400 leading-relaxed space-y-1">
                <span className="block font-semibold text-gray-500 mb-1">Export your model</span>
                <code className="text-gray-500 font-mono block">yolo export model=yolo11n.pt format=onnx</code>
                <span className="block mt-1">
                  Drop <code className="font-mono">yolo11n.onnx</code> into{' '}
                  <code className="font-mono">frontend/public/</code> and click "Load from public folder", or upload it directly.
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatRow({
  icon, label, value, active, color,
}: {
  icon: React.ReactNode; label: string;
  value: number; active: boolean; color: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[11px] text-gray-500">{label}</span>
      </div>
      <span
        className="text-sm font-bold font-mono transition-colors duration-200"
        style={{ color: active ? color : '#d1d5db' }}
      >
        {value}
      </span>
    </div>
  );
}
