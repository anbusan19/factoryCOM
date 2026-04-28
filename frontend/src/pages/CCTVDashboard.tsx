import { Layout } from '@/components/layout/Layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Video, VideoOff, AlertTriangle, HardHat, Users, Wifi, ExternalLink, MonitorPlay } from 'lucide-react';

const STREAMLIT_URL = 'http://192.168.20.222:8501/?embed=true';

const CAMERAS = [
  { id: 'CAM-01', name: 'Zone A — Assembly Line', location: 'Building 1, Floor 1' },
  { id: 'CAM-02', name: 'Zone B — Welding Bay',   location: 'Building 1, Floor 1' },
  { id: 'CAM-03', name: 'Zone C — Paint Shop',    location: 'Building 2, Floor 1' },
  { id: 'CAM-04', name: 'Zone D — Packaging',     location: 'Building 2, Floor 2' },
  { id: 'CAM-05', name: 'Entrance Gate',           location: 'Main Entrance'       },
  { id: 'CAM-06', name: 'Exit Gate',               location: 'Main Exit'           },
];

const StatCard = ({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) => (
  <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 shadow-sm">
    <div className={`p-3 rounded-lg ${color}`}>
      <Icon className="w-5 h-5 text-white" />
    </div>
    <div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  </div>
);

const NoSignalFeed = ({ cam }: { cam: (typeof CAMERAS)[number] }) => (
  <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col shadow-sm">
    <div className="relative bg-gray-100 aspect-video flex flex-col items-center justify-center select-none">
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.5) 2px, rgba(0,0,0,0.5) 4px)',
        }}
      />
      <VideoOff className="w-10 h-10 text-gray-400 mb-2" />
      <span className="text-gray-400 text-xs font-mono tracking-widest uppercase">No Signal</span>
      <span className="absolute top-2 left-2 font-mono text-xs text-gray-500 bg-white/80 px-1.5 py-0.5 rounded border border-gray-200">
        {cam.id}
      </span>
      <span className="absolute top-2 right-2 flex items-center gap-1 text-xs text-red-500 bg-white/80 px-1.5 py-0.5 rounded border border-red-100">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        OFFLINE
      </span>
    </div>
    <div className="px-3 py-2 flex items-center justify-between border-t border-border">
      <div>
        <p className="text-sm font-medium leading-tight">{cam.name}</p>
        <p className="text-xs text-muted-foreground">{cam.location}</p>
      </div>
      <Video className="w-4 h-4 text-muted-foreground shrink-0" />
    </div>
  </div>
);

const CCTVDashboard = () => (
  <Layout>
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2">CCTV Dashboard</h1>
          <p className="text-muted-foreground">
            Live helmet-compliance monitoring — powered by YOLOv11
          </p>
        </div>
        <a
          href="http://192.168.20.222:8501"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in new tab
        </a>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Cameras"     value={CAMERAS.length} icon={Video}         color="bg-blue-600"   />
        <StatCard label="Active Feeds"      value={0}              icon={Wifi}          color="bg-green-600"  />
        <StatCard label="People Detected"   value={0}              icon={Users}         color="bg-violet-600" />
        <StatCard label="Helmet Violations" value={0}              icon={AlertTriangle} color="bg-red-600"    />
      </div>

      <Tabs defaultValue="detector">
        <TabsList className="mb-6">
          <TabsTrigger value="detector" className="gap-1.5">
            <MonitorPlay className="w-3.5 h-3.5" />
            Live Detector
          </TabsTrigger>
          <TabsTrigger value="cameras" className="gap-1.5">
            <Video className="w-3.5 h-3.5" />
            Camera Grid
          </TabsTrigger>
        </TabsList>

        {/* ── Live Detector (Streamlit embed) ────────────────────────── */}
        <TabsContent value="detector">
          <div className="rounded-xl border border-border overflow-hidden shadow-sm" style={{ height: '78vh' }}>
            <iframe
              src={STREAMLIT_URL}
              title="CCTV Helmet Detector"
              width="100%"
              height="100%"
              style={{ border: 'none', display: 'block' }}
              allow="camera; microphone"
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Helmet detection module running on Streamlit Cloud · YOLOv11 inference
          </p>
        </TabsContent>

        {/* ── Camera Grid (static / future RTSP feeds) ────────────────── */}
        <TabsContent value="cameras">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAMERAS.map((cam) => (
              <NoSignalFeed key={cam.id} cam={cam} />
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-5 flex items-start gap-3">
            <HardHat className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-yellow-800 mb-1">Helmet Detection Module Ready</p>
              <p className="text-xs text-yellow-700">
                Use the <strong>Live Detector</strong> tab to run the YOLOv11 helmet-compliance detector.
                Connect your webcam or RTSP stream directly inside the detector. Camera grid feeds will populate
                once RTSP sources are configured in the backend.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  </Layout>
);

export default CCTVDashboard;
