export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "simplercp.theme";

export function getStoredTheme(): ThemeMode {
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
    ? "light"
    : "dark";
}

export function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
