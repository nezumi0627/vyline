import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage.js";
import { VylineApp } from "./pages/VylineApp.js";
import { SubdevicePage } from "./pages/SubdevicePage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/subdevice" element={<SubdevicePage />} />
        <Route path="/*" element={<VylineApp />} />
      </Routes>
    </BrowserRouter>
  );
}
