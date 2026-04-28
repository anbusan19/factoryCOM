import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import DigitalTwin from "./pages/DigitalTwin";
import Procurement from "./pages/Procurement";
import FactoryOptions from "./pages/FactoryOptions";
import Orders from "./pages/Orders";
import Workforce from "./pages/Workforce";
import FileViewer from "./pages/FileViewer";
import QualityControl from "./pages/QualityControl";
import NotFound from "./pages/NotFound";
import Warehouse from "./pages/Warehouse";
import ManagerChat from "./pages/ManagerChat";
import CCTVDashboard from "./pages/CCTVDashboard";
import CCTVTesting from "./pages/CCTVTesting";
import Suppliers from "./pages/Suppliers";
import ManagerPortal from "./pages/ManagerPortal";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/digital-twin" element={<DigitalTwin />} />
          <Route path="/procurement" element={<Procurement />} />
          <Route path="/factory-options" element={<FactoryOptions />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/warehouse" element={<Warehouse />} />
          <Route path="/workforce" element={<Workforce />} />
          <Route path="/file-viewer" element={<FileViewer />} />
          <Route path="/quality-control" element={<QualityControl />} />
          <Route path="/manager-chat" element={<ManagerChat />} />
          <Route path="/cctv" element={<CCTVDashboard />} />
          <Route path="/cctv-testing" element={<CCTVTesting />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/manager" element={<ManagerPortal />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
