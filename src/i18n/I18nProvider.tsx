"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Locale, TranslationMap } from "./types";

const STORAGE_KEY = "lumina-locale";
const DEFAULT_LOCALE: Locale = "en-US";

function getStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isSupportedLocale(stored)) return stored as Locale;
  } catch {}
  return DEFAULT_LOCALE;
}

function isSupportedLocale(locale: string): locale is Locale {
  return [
    "en-US",
    "zh-CN",
    "ja-JP",
    "ko-KR",
    "ru-RU",
    "ar-SA",
    "he-IL",
    "es-ES",
    "pt-BR",
  ].includes(locale);
}

const RTL_LOCALES = new Set(["ar-SA", "he-IL"]);

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  translations: TranslationMap;
  isLoaded: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [translations, setTranslations] = useState<TranslationMap>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const cacheRef = useRef<Map<string, TranslationMap>>(new Map());
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const initial = getStoredLocale();
    loadLocale(initial);
    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const loadLocale = useCallback(async (loc: Locale) => {
    const cached = cacheRef.current.get(loc);
    if (cached) {
      if (mountedRef.current) {
        setTranslations(cached);
        setIsLoaded(true);
      }
      return;
    }

    try {
      const mod = await import(`./locales/${loc}.json`);
      const map = mod.default || mod;
      cacheRef.current.set(loc, map);
      if (mountedRef.current) {
        setTranslations(map);
        setIsLoaded(true);
      }
    } catch {
      if (loc !== DEFAULT_LOCALE) {
        const fallback = cacheRef.current.get(DEFAULT_LOCALE);
        if (fallback) {
          if (mountedRef.current) {
            setTranslations(fallback);
            setIsLoaded(true);
          }
          return;
        }
        try {
          const fallbackMod = await import(`./locales/${DEFAULT_LOCALE}.json`);
          const fallbackMap = fallbackMod.default || fallbackMod;
          cacheRef.current.set(DEFAULT_LOCALE, fallbackMap);
          if (mountedRef.current) {
            setTranslations(fallbackMap);
            setIsLoaded(true);
          }
        } catch {}
      }
    }
  }, []);

  const setLocale = useCallback(
    (newLocale: Locale) => {
      setLocaleState(newLocale);
      setIsLoaded(false);
      try {
        localStorage.setItem(STORAGE_KEY, newLocale);
      } catch {}
      loadLocale(newLocale);

      if (RTL_LOCALES.has(newLocale)) {
        document.documentElement.dir = "rtl";
      } else {
        document.documentElement.dir = "ltr";
      }
    },
    [loadLocale],
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let value = translations[key];
      if (value === undefined) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`[i18n] Missing translation key: "${key}" for locale "${locale}"`);
        }
        value = key;
      }

      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(`{${k}}`, String(v));
        }
      }

      return value;
    },
    [translations, locale],
  );

  return (
    <I18nContext.Provider
      value={{ locale, setLocale, t, translations, isLoaded }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18nContext() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18nContext must be used within an I18nProvider");
  }
  return ctx;
}
