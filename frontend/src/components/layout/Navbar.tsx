import { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Bot,
  Cctv,
  FlaskConical,
  ChevronDown,
  LayoutDashboard,
  Box,
  ShoppingCart,
  Package,
  Users,
  FileSearch,
  ShieldCheck,
  Building2,
  MoreHorizontal,
  BriefcaseBusiness,
} from 'lucide-react';

// Primary nav — always visible
const PRIMARY = [
  { to: '/',             end: true,  label: 'Dashboard',     icon: LayoutDashboard },
  { to: '/digital-twin', end: false, label: 'Digital Twin',  icon: Box },
  { to: '/orders',       end: false, label: 'Orders',        icon: ShoppingCart },
  { to: '/warehouse',    end: false, label: 'Warehouse',     icon: Package },
  { to: '/workforce',    end: false, label: 'Workforce',     icon: Users },
];

// Secondary nav — lives in "More" dropdown
const SECONDARY = [
  { to: '/procurement',    label: 'Procurement',    icon: ShoppingCart },
  { to: '/suppliers',      label: 'Suppliers',      icon: Building2 },
  { to: '/file-viewer',    label: 'File Viewer',    icon: FileSearch },
  { to: '/quality-control',label: 'Quality Control',icon: ShieldCheck },
  { to: '/manager',        label: 'Manager',        icon: BriefcaseBusiness },
  { to: '/manager-chat',   label: 'Manager AI',     icon: Bot },
  { to: '/cctv',           label: 'CCTV',           icon: Cctv },
  { to: '/cctv-testing',   label: 'CCTV Testing',   icon: FlaskConical },
];

const linkBase =
  'relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium font-condensed tracking-widest uppercase transition-colors duration-150';

const activeClass = 'text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-foreground after:rounded-t';
const inactiveClass = 'text-muted-foreground hover:text-foreground';

export const Navbar = () => {
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-b border-border shadow-sm">
      <nav className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center gap-8">

        {/* Brand */}
        <NavLink to="/" className="flex items-center gap-2.5 shrink-0 group">
          <img
            src="/factoryOS.png"
            alt="FactoryCOM Logo"
            className="w-8 h-8 rounded-md"
          />
          <span className="font-condensed text-xl font-bold tracking-widest text-foreground uppercase">
            Factory<span className="text-gray-400">COM</span>
          </span>
        </NavLink>

        {/* Divider */}
        <div className="h-5 w-px bg-border shrink-0" />

        {/* Primary links */}
        <div className="flex items-stretch h-full gap-0.5">
          {PRIMARY.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `${linkBase} ${isActive ? activeClass : inactiveClass}`
              }
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* More dropdown */}
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className={`${linkBase} ${inactiveClass} select-none`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
            More
            <ChevronDown
              className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-border rounded-xl shadow-lg overflow-hidden z-50 py-1">
              {SECONDARY.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-condensed tracking-wider uppercase transition-colors ${
                      isActive
                        ? 'bg-gray-100 text-foreground font-semibold'
                        : 'text-muted-foreground hover:bg-gray-50 hover:text-foreground'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>
    </header>
  );
};
