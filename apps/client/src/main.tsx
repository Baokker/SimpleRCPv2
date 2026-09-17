import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { applyTheme, getStoredTheme } from "./theme";

const initialTheme = getStoredTheme();
applyTheme(initialTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <App initialTheme={initialTheme} />
);
