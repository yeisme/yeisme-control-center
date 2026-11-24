import { createRoot } from "react-dom/client";
import { captureBootInviteToken } from "./shared/url-invite";
import { AppRouter } from "./app/router";

captureBootInviteToken();
createRoot(document.getElementById("root")!).render(<AppRouter />);
