import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { PublicGuide } from "./pages/guide/PublicGuide";

createRoot(document.getElementById("root")!).render(<PublicGuide />);
