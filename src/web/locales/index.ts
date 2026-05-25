import { en } from './en';
import { ptBR } from './pt-BR';

const locales: Record<string, Record<string, string>> = {
  en,
  'pt-BR': ptBR,
};

export function getTranslations(locale: string): Record<string, string> {
  return locales[locale] || locales['en'];
}

export function getSupportedLocales(): { value: string; label: string }[] {
  return [
    { value: 'en', label: en['lang.en'] },
    { value: 'pt-BR', label: en['lang.ptBR'] },
  ];
}

export { en, ptBR };
