import { Layout } from '@/components/layout/Layout';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApiStore } from '@/store/useApiStore';
import { format, addDays } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import Map, { Marker, Popup, Source, Layer } from 'react-map-gl';
import type { LineLayer } from 'react-map-gl';
import { getFactoryCoordinates, getFactoryCity } from '@/lib/factoryLocations';
import type { FactoryOrder } from '@/store/useApiStore';
import {
  MapPin,
  Package,
  Clock,
  IndianRupee,
  Truck,
  Factory,
  CalendarDays,
  ArrowRight,
} from 'lucide-react';

// ── Hub: FactoryCOM main facility (Nagpur — geographic centre of India) ─────
const HUB: [number, number] = [79.088, 21.146];

const STATUS_COLOR: Record<string, string> = {
  completed:        '#22c55e',
  'in-production':  '#3b82f6',
  'in-transit':     '#f59e0b',
  'out-for-delivery':'#8b5cf6',
  placed:           '#6b7280',
  cancelled:        '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  completed:        'Completed',
  'in-production':  'In Production',
  'in-transit':     'In Transit',
  'out-for-delivery':'Out for Delivery',
  placed:           'Placed',
  cancelled:        'Cancelled',
};

function getStatusColor(status: string) {
  return STATUS_COLOR[status] ?? '#6b7280';
}

// ── Status badge helper ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = getStatusColor(status);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ background: color + '1a', color, border: `1px solid ${color}40` }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function PaymentBadge({ status }: { status?: 'paid' | 'pending' | 'not-paid' }) {
  switch (status) {
    case 'paid':
      return <Badge className="bg-success text-success-foreground">Paid</Badge>;
    case 'not-paid':
      return <Badge variant="destructive">Not Paid</Badge>;
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

// ── Orders page ───────────────────────────────────────────────────────────────

const Orders = () => {
  const { factoryOrders, fetchFactoryOrders, updateFactoryOrder } = useApiStore();

  useEffect(() => {
    fetchFactoryOrders();
  }, [fetchFactoryOrders]);

  // Auto-advance order statuses for demo
  useEffect(() => {
    const timers: number[] = [];
    factoryOrders.forEach((o, idx) => {
      if (o.status === 'placed') {
        const t1 = window.setTimeout(() => {
          updateFactoryOrder(o.id, { status: 'in-transit' as any });
          const t2 = window.setTimeout(() => {
            updateFactoryOrder(o.id, { status: 'out-for-delivery' as any });
            const t3 = window.setTimeout(() => {
              updateFactoryOrder(o.id, { status: 'completed' as any });
            }, 45000);
            timers.push(t3);
          }, 20000);
          timers.push(t2);
        }, 10000 + idx * 200);
        timers.push(t1);
      }
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [factoryOrders, updateFactoryOrder]);

  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [popupInfo, setPopupInfo] = useState<FactoryOrder | null>(null);
  const [hoverInfo, setHoverInfo] = useState<FactoryOrder | null>(null);
  const [trackingFor, setTrackingFor] = useState<string | null>(null);

  const activeOrder = useMemo(
    () => factoryOrders.find((o) => o.id === trackingFor) ?? null,
    [factoryOrders, trackingFor],
  );

  const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

  const mapViewState = useMemo(() => ({
    longitude: 78.5,
    latitude: 22.0,
    zoom: 4.5,
  }), []);

  // ── Build GeoJSON route lines ───────────────────────────────────────────────
  const routeGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: factoryOrders.map((order) => {
      const factory = getFactoryCoordinates(order.factoryName);
      return {
        type: 'Feature' as const,
        properties: {
          status: order.status,
          color: getStatusColor(order.status),
          active: order.status === 'in-transit' || order.status === 'out-for-delivery',
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [factory, HUB],
        },
      };
    }),
  }), [factoryOrders]);

  // Two layers: solid for settled statuses, dashed for moving
  const baseLineLayer: LineLayer = {
    id: 'routes-base',
    type: 'line',
    filter: ['!', ['get', 'active']],
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.8,
      'line-opacity': 0.45,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  };

  const activeLineLayer: LineLayer = {
    id: 'routes-active',
    type: 'line',
    filter: ['get', 'active'],
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2.5,
      'line-opacity': 0.85,
      'line-dasharray': [4, 3],
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  };

  // ── Tracking timeline ───────────────────────────────────────────────────────
  const trackingEvents = useMemo(() => {
    if (!activeOrder) return [] as { label: string; date: Date; done: boolean }[];
    const placed = activeOrder.createdAt;
    return [
      { label: 'Order Placed',      date: placed,                              done: true },
      { label: 'In Transit',        date: addDays(placed, 1),                  done: ['in-transit','out-for-delivery','completed'].includes(activeOrder.status as string) },
      { label: 'Out for Delivery',  date: addDays(placed, 2),                  done: ['out-for-delivery','completed'].includes(activeOrder.status as string) },
      { label: 'Delivered',         date: addDays(placed, activeOrder.leadTimeDays), done: activeOrder.status === 'completed' },
    ];
  }, [activeOrder]);

  const [progressNow, setProgressNow] = useState(0);
  useEffect(() => {
    if (!trackingFor) return;
    let elapsed = 0;
    const total = 75000;
    const tick = window.setInterval(() => {
      elapsed += 1000;
      setProgressNow(Math.min(1, elapsed / total));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [trackingFor]);

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Orders</h1>
          <p className="text-muted-foreground">Manufacturing orders placed with supplier factories</p>
        </div>

        <Card className="glass p-6">
          <h3 className="text-lg font-semibold mb-6">Placed Orders</h3>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'table' | 'map')}>
            <TabsList className="mb-6">
              <TabsTrigger value="table">Table View</TabsTrigger>
              <TabsTrigger value="map">Map View</TabsTrigger>
            </TabsList>

            {/* ── Table ──────────────────────────────────────────────────── */}
            <TabsContent value="table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Factory</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Unit Price</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Lead Time</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factoryOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.id}</TableCell>
                      <TableCell className="font-medium">{o.factoryName}</TableCell>
                      <TableCell className="text-muted-foreground">{getFactoryCity(o.factoryName)} · {o.area}</TableCell>
                      <TableCell>{o.quantity}</TableCell>
                      <TableCell>₹{o.unitPrice.toFixed(2)}</TableCell>
                      <TableCell className="font-semibold">₹{o.totalPrice.toFixed(2)}</TableCell>
                      <TableCell>{o.leadTimeDays}d</TableCell>
                      <TableCell>{format(o.createdAt, 'MMM dd, yyyy')}</TableCell>
                      <TableCell><PaymentBadge status={o.paymentStatus} /></TableCell>
                      <TableCell>
                        <button onClick={() => setTrackingFor(o.id)}>
                          <StatusBadge status={o.status} />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            {/* ── Map ────────────────────────────────────────────────────── */}
            <TabsContent value="map">
              <div className="relative h-[600px] w-full rounded-xl border border-border shadow-sm [&_.mapboxgl-map]:!overflow-visible">
                <Map
                  mapboxAccessToken={MAPBOX_TOKEN}
                  initialViewState={mapViewState}
                  style={{ width: '100%', height: '100%' }}
                  mapStyle="mapbox://styles/mapbox/light-v11"
                >
                  {/* Route lines */}
                  <Source id="routes" type="geojson" data={routeGeoJSON}>
                    <Layer {...baseLineLayer} />
                    <Layer {...activeLineLayer} />
                  </Source>

                  {/* Hub marker — FactoryCOM HQ */}
                  <Marker longitude={HUB[0]} latitude={HUB[1]} anchor="center">
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: '#0f172a',
                        border: '3px solid white',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="FactoryCOM HQ"
                    >
                      <Factory size={16} color="white" />
                    </div>
                  </Marker>

                  {/* Factory order markers */}
                  {factoryOrders.map((order) => {
                    const [lng, lat] = getFactoryCoordinates(order.factoryName);
                    const color = getStatusColor(order.status);
                    const isMoving = order.status === 'in-transit' || order.status === 'out-for-delivery';
                    return (
                      <Marker
                        key={order.id}
                        longitude={lng}
                        latitude={lat}
                        anchor="bottom"
                        onClick={(e) => {
                          e.originalEvent.stopPropagation();
                          setPopupInfo(order);
                          setHoverInfo(null);
                        }}
                      >
                        <div
                          className="cursor-pointer flex flex-col items-center"
                          onMouseEnter={() => setHoverInfo(order)}
                          onMouseLeave={() => setHoverInfo(null)}
                        >
                          {/* Pin head */}
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: '50% 50% 50% 0',
                              transform: 'rotate(-45deg)',
                              background: color,
                              border: '2.5px solid white',
                              boxShadow: `0 2px 8px ${color}66`,
                              outline: isMoving ? `2px solid ${color}` : 'none',
                              outlineOffset: 3,
                            }}
                          />
                        </div>
                      </Marker>
                    );
                  })}

                  {/* Hover card */}
                  {hoverInfo && !popupInfo && (
                    <Popup
                      longitude={getFactoryCoordinates(hoverInfo.factoryName)[0]}
                      latitude={getFactoryCoordinates(hoverInfo.factoryName)[1]}
                      anchor="bottom"
                      offset={40}
                      closeButton={false}
                      closeOnClick={false}
                      className="!p-0 !rounded-xl !overflow-visible"
                    >
                      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 w-[200px]">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <p className="font-semibold text-sm text-gray-900 leading-tight">
                              {hoverInfo.factoryName}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {getFactoryCity(hoverInfo.factoryName)} · {hoverInfo.area}
                            </p>
                          </div>
                          <StatusBadge status={hoverInfo.status} />
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 border-t border-gray-100 pt-2">
                          <span>Qty</span>
                          <span className="font-medium text-gray-800 text-right">{hoverInfo.quantity}</span>
                          <span>Total</span>
                          <span className="font-medium text-gray-800 text-right">₹{hoverInfo.totalPrice.toFixed(0)}</span>
                          <span>Lead time</span>
                          <span className="font-medium text-gray-800 text-right">{hoverInfo.leadTimeDays}d</span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2 text-center">Click marker to view full details</p>
                      </div>
                    </Popup>
                  )}

                  {/* Click popup — full details */}
                  {popupInfo && (
                    <Popup
                      longitude={getFactoryCoordinates(popupInfo.factoryName)[0]}
                      latitude={getFactoryCoordinates(popupInfo.factoryName)[1]}
                      anchor="top"
                      offset={10}
                      maxWidth="300px"
                      onClose={() => setPopupInfo(null)}
                      closeButton={true}
                      closeOnClick={false}
                      className="!p-0 !rounded-xl !overflow-visible"
                    >
                      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-[280px]">
                        {/* Header */}
                        <div
                          className="px-4 py-3 border-b border-gray-100"
                          style={{ borderTop: `3px solid ${getStatusColor(popupInfo.status)}` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-bold text-gray-900 text-sm leading-tight">
                                {popupInfo.factoryName}
                              </p>
                              <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                                <MapPin className="w-3 h-3" />
                                {getFactoryCity(popupInfo.factoryName)} · {popupInfo.area}
                              </div>
                            </div>
                            <StatusBadge status={popupInfo.status} />
                          </div>
                        </div>

                        {/* Body */}
                        <div className="px-4 py-3 space-y-2.5">
                          <DetailRow icon={<Package className="w-3.5 h-3.5" />} label="Order ID" value={popupInfo.id} mono />
                          <DetailRow icon={<Package className="w-3.5 h-3.5" />} label="Quantity" value={String(popupInfo.quantity)} />
                          <DetailRow
                            icon={<IndianRupee className="w-3.5 h-3.5" />}
                            label="Total"
                            value={`₹${popupInfo.totalPrice.toFixed(2)}`}
                            highlight
                          />
                          <DetailRow
                            icon={<Clock className="w-3.5 h-3.5" />}
                            label="Lead Time"
                            value={`${popupInfo.leadTimeDays} days`}
                          />
                          <DetailRow
                            icon={<CalendarDays className="w-3.5 h-3.5" />}
                            label="Created"
                            value={format(popupInfo.createdAt, 'MMM dd, yyyy')}
                          />

                          {/* Route */}
                          <div className="flex items-center gap-2 py-2 bg-gray-50 rounded-lg px-3 text-xs text-gray-600 border border-gray-100">
                            <MapPin className="w-3 h-3 shrink-0 text-gray-400" />
                            <span className="truncate">{getFactoryCity(popupInfo.factoryName)}</span>
                            <ArrowRight className="w-3 h-3 shrink-0 text-gray-300" />
                            <Factory className="w-3 h-3 shrink-0 text-gray-800" />
                            <span className="font-medium text-gray-800">FactoryCOM HQ</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <PaymentBadge status={popupInfo.paymentStatus} />
                            <button
                              className="text-xs font-semibold flex items-center gap-1 text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                              onClick={() => {
                                setTrackingFor(popupInfo.id);
                                setPopupInfo(null);
                              }}
                            >
                              <Truck className="w-3 h-3" />
                              Track Order
                            </button>
                          </div>
                        </div>
                      </div>
                    </Popup>
                  )}
                </Map>

                {/* Legend */}
                <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl px-4 py-3 shadow-md">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Legend</p>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                    {Object.entries(STATUS_LABEL).map(([key, label]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: STATUS_COLOR[key], boxShadow: `0 0 4px ${STATUS_COLOR[key]}80` }}
                        />
                        <span className="text-[11px] text-gray-600">{label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-1.5 col-span-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#0f172a] shrink-0" />
                      <span className="text-[11px] text-gray-600">FactoryCOM HQ</span>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-3 text-[10px] text-gray-400">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-6 border-t-2 border-gray-400 border-dashed" /> Active route
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-6 border-t border-gray-300" /> Settled
                    </span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>

        {/* Tracking dialog */}
        <Dialog open={!!trackingFor} onOpenChange={(open) => !open && setTrackingFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Order Tracking</DialogTitle>
              <DialogDescription>Live tracking for order {activeOrder?.id}</DialogDescription>
            </DialogHeader>
            {activeOrder && (
              <div className="space-y-1 pt-2">
                {trackingEvents.map((ev, i) => {
                  const segCount = trackingEvents.length - 1;
                  const segProgress = progressNow * segCount;
                  const isLast = i === trackingEvents.length - 1;
                  const circleFilled = i === 0 || segProgress >= i;
                  const segFill = Math.min(1, Math.max(0, segProgress - i));
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className="w-3.5 h-3.5 rounded-full border-2 mt-0.5 shrink-0"
                          style={{
                            borderColor: circleFilled ? '#22c55e' : '#d1d5db',
                            background: circleFilled ? '#22c55e' : 'white',
                          }}
                        />
                        {!isLast && (
                          <div className="relative w-[2px] h-10 bg-gray-200 rounded mt-1 overflow-hidden">
                            <div
                              className="absolute left-0 top-0 w-full bg-green-500 transition-all duration-500"
                              style={{ height: `${segFill * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="pb-4">
                        <p className={`text-sm font-medium ${circleFilled ? 'text-gray-900' : 'text-gray-400'}`}>
                          {ev.label}
                        </p>
                        <p className="text-xs text-muted-foreground">{format(ev.date, 'MMM dd, yyyy')}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

// ── Small helper ──────────────────────────────────────────────────────────────

const DetailRow = ({
  icon,
  label,
  value,
  mono,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
      <span className="text-gray-400">{icon}</span>
      {label}
    </div>
    <span
      className={`text-xs text-right ${highlight ? 'font-bold text-gray-900' : 'text-gray-700'} ${mono ? 'font-mono' : ''}`}
    >
      {value}
    </span>
  </div>
);

export default Orders;
