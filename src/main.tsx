import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./fonts.css";
import "./styles.css";

// Launched from the iPhone home screen: styles.css sizes the app by the screen
// there, since iOS reports the page height short by the status bar.
if ((navigator as Navigator & { standalone?: boolean }).standalone) document.documentElement.classList.add("standalone");

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
