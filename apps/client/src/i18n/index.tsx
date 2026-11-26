import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { defaultLocale, translator, type Locale, type Translate } from "./messages";
import { readLocalStorage, writeLocalStorage } from "../localStorage";

const storageKey = "simplercp.locale";
const LanguageContext = createContext<{
  locale: Locale;
  t: Translate;
  setLocale(locale: Locale): void;
} | null>(null);

function storedLocale(): Locale {
  return readLocalStorage(storageKey) === "en" ? "en" : defaultLocale;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(storedLocale);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    t: translator(locale),
    setLocale(nextLocale: Locale) {
      setLocale(writeLocalStorage(storageKey, nextLocale) ? nextLocale : defaultLocale);
    }
  }), [locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("I18nProvider is required");
  return context;
}
