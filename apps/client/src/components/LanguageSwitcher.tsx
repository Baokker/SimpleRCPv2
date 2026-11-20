import { useI18n } from "../i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="language-switcher" role="group" aria-label={t("language")}>
      <button type="button" lang="zh-CN" aria-pressed={locale === "zh-CN"} onClick={() => setLocale("zh-CN")}>中文</button>
      <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>English</button>
    </div>
  );
}
