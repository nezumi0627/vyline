import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { VylineApp } from "./pages/VylineApp.js";
import { useTranslation } from "react-i18next";

const LoginPage = lazy(() =>
  import("./pages/LoginPage.js").then((module) => ({ default: module.LoginPage })),
);
const SubdevicePage = lazy(() =>
  import("./pages/SubdevicePage.js").then((module) => ({ default: module.SubdevicePage })),
);
const PrDemoPage = lazy(() =>
  import("./pages/PrDemoPage.js").then((module) => ({ default: module.PrDemoPage })),
);
const UiCatalogPage = lazy(() =>
  import("./pages/UiCatalogPage.js").then((module) => ({ default: module.UiCatalogPage })),
);
const LayoutPreviewPage = lazy(() =>
  import("./pages/LayoutPreviewPage.js").then((module) => ({ default: module.LayoutPreviewPage })),
);

export function App() {
  // Subscribe once at the router root so non-hook leaf components also refresh
  // when the locale changes; active chat and draft stores are left untouched.
  useTranslation();
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          {import.meta.env.DEV && <Route path="/" element={<LayoutPreviewPage />} />}
          {import.meta.env.DEV && <Route path="/layout-preview" element={<LayoutPreviewPage />} />}
          <Route path="/pr-demo" element={<PrDemoPage />} />
          <Route path="/ui-catalog" element={<UiCatalogPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/subdevice" element={<SubdevicePage />} />
          <Route path="/app/*" element={<VylineApp />} />
          <Route path="/*" element={<VylineApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
