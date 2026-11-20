import ReactDOM from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import "./styles.css";
import { applyTheme, getStoredTheme } from "./theme";

const initialTheme = getStoredTheme();
applyTheme(initialTheme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <I18nProvider><App initialTheme={initialTheme} /></I18nProvider>
);
