import { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Terminal, Play, HardHat, Camera, CheckCircle, XCircle, Info } from 'lucide-react';

type SourceType = 'webcam' | 'rtsp' | 'file';

const DETECTION_CLASSES = [
  { label: 'Person',     color: 'bg-blue-500'  },
  { label: 'Helmet',     color: 'bg-green-500' },
  { label: 'No Helmet',  color: 'bg-red-500'   },
];

const Badge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${ok ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
    {ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
    {label}
  </span>
);

const CCTVTesting = () => {
  const [sourceType, setSourceType] = useState<SourceType>('webcam');
  const [webcamIndex, setWebcamIndex] = useState('0');
  const [rtspUrl, setRtspUrl] = useState('rtsp://user:pass@host/stream');
  const [filePath, setFilePath] = useState('sample.mp4');
  const [confThreshold, setConfThreshold] = useState(0.4);

  const sourceValue =
    sourceType === 'webcam' ? webcamIndex :
    sourceType === 'rtsp'   ? rtspUrl     : filePath;

  const runCommand = `python app.py`;
  const streamlitCommand = `streamlit run app.py`;

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">CCTV Testing</h1>
          <p className="text-muted-foreground">
            Configure and validate the YOLOv11 helmet-detection module before going live.
          </p>
        </div>

        {/* module info */}
        <div className="glass rounded-xl p-5 mb-6 border border-blue-500/20">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-blue-300">About the Detection Module</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            The CCTV module runs as a <span className="text-foreground">Streamlit</span> app backed by{' '}
            <span className="text-foreground">YOLOv11 (Ultralytics)</span>. It detects people, helmets,
            and violations in real-time using IoU-based person tracking and alert streak logic.
          </p>
          <div className="flex flex-wrap gap-2">
            {DETECTION_CLASSES.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/5">
                <span className={`w-2 h-2 rounded-full ${c.color}`} />
                {c.label}
              </span>
            ))}
          </div>
        </div>

        {/* camera source config */}
        <div className="glass rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Camera className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Camera Source</span>
          </div>

          <div className="flex gap-2 mb-4">
            {(['webcam', 'rtsp', 'file'] as SourceType[]).map((t) => (
              <button
                key={t}
                onClick={() => setSourceType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  sourceType === t
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-white/5 text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'rtsp' ? 'RTSP / HTTP' : t === 'file' ? 'Video File' : 'Webcam'}
              </button>
            ))}
          </div>

          {sourceType === 'webcam' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Webcam Index</label>
              <input
                type="number"
                min={0}
                value={webcamIndex}
                onChange={(e) => setWebcamIndex(e.target.value)}
                className="w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          )}
          {sourceType === 'rtsp' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">RTSP / HTTP URL</label>
              <input
                type="text"
                value={rtspUrl}
                onChange={(e) => setRtspUrl(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
              />
            </div>
          )}
          {sourceType === 'file' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">File Path</label>
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
              />
            </div>
          )}

          <div className="mt-4">
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Confidence Threshold — <span className="text-foreground">{confThreshold.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={confThreshold}
              onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>

        {/* run instructions */}
        <div className="glass rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">How to Run the Module</span>
          </div>

          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-muted-foreground mb-1.5">Navigate to the CCTV module directory</p>
                <code className="block bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-green-400">
                  cd CCTV-module
                </code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-muted-foreground mb-1.5">Install dependencies</p>
                <code className="block bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-green-400">
                  pip install streamlit ultralytics opencv-python torch
                </code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-muted-foreground mb-1.5">Launch the Streamlit dashboard</p>
                <code className="block bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-green-400">
                  {streamlitCommand}
                </code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">4</span>
              <div>
                <p className="text-muted-foreground mb-1.5">
                  In the Streamlit sidebar, select your source and set confidence to{' '}
                  <span className="text-foreground font-medium">{confThreshold.toFixed(2)}</span>
                </p>
                <code className="block bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-green-400">
                  Source: {sourceType === 'webcam' ? `Webcam ${sourceValue}` : sourceValue}
                </code>
              </div>
            </li>
          </ol>
        </div>

        {/* checklist */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardHat className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Pre-Flight Checklist</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge ok={false} label="Camera connected"    />
            <Badge ok={false} label="YOLO weights found"  />
            <Badge ok={false} label="Streamlit running"   />
            <Badge ok={false} label="Detection active"    />
            <Badge ok={false} label="Live feed streaming" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            These will update automatically once the detection module is integrated with the FactoryOS backend.
          </p>
        </div>
      </div>
    </Layout>
  );
};

export default CCTVTesting;
