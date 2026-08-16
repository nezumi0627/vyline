import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

createRoot(root).render(<App />);
