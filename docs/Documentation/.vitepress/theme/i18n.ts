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

const localePrefixValues = Object.values(localePrefixes).filter(Boolean);

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

export function documentKey(relativePath: string) {
  // 去掉版本和语言前缀后，剩余路径就是稳定文档键。
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  const versionIndex = /^v\d+\.\d+\.\d+$/.test(segments[0] ?? "") ? 1 : 0;
  const localeIndex = localePrefixValues.includes(segments[versionIndex] ?? "") ? versionIndex + 1 : versionIndex;
  return segments.slice(localeIndex).join("/");
}

export function getAlternateLink(relativePath: string, targetLocale: DocLocale) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  const version = /^v\d+\.\d+\.\d+$/.test(segments[0] ?? "") ? segments[0] : "";
  const sourcePath = documentKey(relativePath);
  const prefix = localePrefix(targetLocale);
  const targetPath = [version, prefix, sourcePath].filter(Boolean).join("/");
  return relativePathToLink(targetPath);
}

export function getTranslationStatus(sourceLocale: DocLocale, targetLocale: DocLocale, isSynchronized: boolean): TranslationStatus {
  if (sourceLocale === targetLocale) {
    return "current";
  }

  return isSynchronized ? "current" : "needs_sync";
}
