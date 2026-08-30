import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { VylineApp } from "./pages/VylineApp.js";

const LoginPage = lazy(() =>
  import("./pages/LoginPage.js").then((module) => ({ default: module.LoginPage })),
);
const SubdevicePage = lazy(() =>
  import("./pages/SubdevicePage.js").then((module) => ({ default: module.SubdevicePage })),
);
const PrDemoPage = lazy(() =>
  import("./pages/PrDemoPage.js").then((module) => ({ default: module.PrDemoPage })),
);

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/pr-demo" element={<PrDemoPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/subdevice" element={<SubdevicePage />} />
          <Route path="/*" element={<VylineApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
