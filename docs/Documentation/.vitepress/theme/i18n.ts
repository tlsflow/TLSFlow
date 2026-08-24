export type DocLocale = "zh-CN" | "en-US" | "fr-FR" | "ja-JP" | "ko-KR" | "pt-BR" | "ru-RU" | "zh-TW";

export type TranslationStatus = "current" | "needs_sync" | "missing" | "not_applicable";

export const DOC_LOCALES: readonly DocLocale[] = [
  "zh-CN",
  "en-US",
  "fr-FR",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "ru-RU",
  "zh-TW"
];

const localePrefixes: Record<DocLocale, string> = {
  "zh-CN": "",
  "en-US": "en",
  "fr-FR": "fr",
  "ja-JP": "ja",
  "ko-KR": "ko",
  "pt-BR": "pt",
  "ru-RU": "ru",
  "zh-TW": "zh-TW"
};

export function localePrefix(locale: DocLocale) {
  return localePrefixes[locale];
}

export function relativePathToLink(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized === "index.md") {
    return "/";
  }

  const withoutIndex = normalized.replace(/(^|\/)index\.md$/, "$1");
  return `/${withoutIndex.replace(/\.md$/, "")}`;
}

export function getAlternateLink(relativePath: string, targetLocale: DocLocale) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = localePrefix(targetLocale);
  const sourcePath = normalized.replace(/^(en|fr|ja|ko|pt|ru|zh-TW)\//, "");
  const targetPath = prefix ? `${prefix}/${sourcePath}` : sourcePath;
  return relativePathToLink(targetPath);
}

export function getTranslationStatus(sourceLocale: DocLocale, targetLocale: DocLocale, isSynchronized: boolean): TranslationStatus {
  if (sourceLocale === targetLocale) {
    return "current";
  }

  return isSynchronized ? "current" : "needs_sync";
}
