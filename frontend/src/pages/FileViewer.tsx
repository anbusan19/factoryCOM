import { useState, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { Button } from '@/components/ui/button';
import { Upload, FileText, X, RotateCcw, ZoomIn, Move } from 'lucide-react';
import { ModelViewer } from '@/components/fileviewer/ModelViewer';
import { DefectAnalysisPanel } from '@/components/fileviewer/DefectAnalysisPanel';
import { Layout } from '@/components/layout/Layout';
import { analyzeModel, DefectAnalysis } from '@/lib/defectAnalysis';
import * as THREE from 'three';

const FileViewer = () => {
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileType, setFileType] = useState<'gltf' | 'stl' | null>(null);
  const [analysis, setAnalysis] = useState<DefectAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['gltf', 'glb', 'stl'].includes(ext)) {
      alert('Please upload a GLTF (.gltf, .glb) or STL (.stl) file');
      return;
    }

    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setFileName(file.name);
    setFileType(ext === 'stl' ? 'stl' : 'gltf');
  };

  const clearModel = () => {
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    setModelUrl(null);
    setFileName('');
    setFileType(null);
    setAnalysis(null);
  };

  const handleModelLoad = useCallback((object: THREE.Object3D) => {
    setAnalysis(analyzeModel(object));
  }, []);

  return (
    <Layout>
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">3D Model Viewer</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Upload and inspect GLTF / STL files
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <Upload className="w-4 h-4" />
                Upload Model
              </Button>
              {modelUrl && (
                <Button onClick={clearModel} variant="outline" className="gap-2">
                  <X className="w-4 h-4" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".gltf,.glb,.stl"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

            {/* 3D Canvas */}
            <div className="lg:col-span-3">
              <div className="rounded-xl border border-border bg-[#f2f2f0] h-[600px] overflow-hidden relative">
                {modelUrl ? (
                  <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[10, 10, 5]} intensity={1.2} />
                    <ModelViewer url={modelUrl} type={fileType!} onModelLoad={handleModelLoad} />
                    <OrbitControls enablePan enableZoom enableRotate />
                    <Environment preset="studio" />
                  </Canvas>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div
                      className="text-center cursor-pointer group"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="w-20 h-20 rounded-2xl bg-white border-2 border-dashed border-gray-300 group-hover:border-gray-400 flex items-center justify-center mx-auto mb-4 transition-colors">
                        <FileText className="w-9 h-9 text-gray-400 group-hover:text-gray-500 transition-colors" />
                      </div>
                      <p className="text-gray-700 font-semibold text-base font-condensed tracking-wide">
                        No model loaded
                      </p>
                      <p className="text-gray-400 text-sm mt-1">
                        Click to upload a GLTF or STL file
                      </p>
                    </div>
                  </div>
                )}

                {/* Canvas filename badge */}
                {modelUrl && fileName && (
                  <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-sm">
                    <FileText className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-mono text-gray-700 max-w-[200px] truncate">{fileName}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel */}
            <div className="space-y-4">
              <DefectAnalysisPanel analysis={analysis} />

              {/* File Info */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 font-condensed tracking-wide uppercase">
                  File Info
                </h3>
                {fileName ? (
                  <div className="space-y-2.5">
                    <InfoRow label="Name" value={fileName} mono />
                    <InfoRow label="Type" value={fileType?.toUpperCase() ?? '—'} mono />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No file selected</p>
                )}
              </div>

              {/* Controls */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 font-condensed tracking-wide uppercase">
                  Controls
                </h3>
                <div className="space-y-2">
                  <ControlRow icon={<RotateCcw className="w-3.5 h-3.5" />} label="Left drag" action="Rotate" />
                  <ControlRow icon={<Move className="w-3.5 h-3.5" />} label="Right drag" action="Pan" />
                  <ControlRow icon={<ZoomIn className="w-3.5 h-3.5" />} label="Scroll" action="Zoom" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

// ── Small helpers ──────────────────────────────────────────────────────────

const InfoRow = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div>
    <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
    <p className={`text-sm text-foreground mt-0.5 break-all ${mono ? 'font-mono' : ''}`}>{value}</p>
  </div>
);

const ControlRow = ({
  icon,
  label,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  action: string;
}) => (
  <div className="flex items-center gap-2.5 text-sm">
    <span className="text-muted-foreground">{icon}</span>
    <span className="text-muted-foreground">{label}:</span>
    <span className="font-medium text-foreground">{action}</span>
  </div>
);

export default FileViewer;
