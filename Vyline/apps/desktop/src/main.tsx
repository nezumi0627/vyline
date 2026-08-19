import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";
import { initCustomFont } from "./lib/customFont.js";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

void initCustomFont();

createRoot(root).render(<App />);
