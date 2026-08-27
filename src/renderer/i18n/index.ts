import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './ru.json'
import en from './en.json'
import zh from './zh.json'

export type SupportedLanguage = 'ru' | 'en' | 'zh'

const LANGUAGE_STORAGE_KEY = 'file-switcher:language'

function getInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (stored === 'ru' || stored === 'en' || stored === 'zh') {
    return stored
  }
  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith('ru')) return 'ru'
  if (browserLang.startsWith('zh')) return 'zh'
  return 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
    zh: { translation: zh }
  },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

export function setLanguage(lang: SupportedLanguage): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  i18n.changeLanguage(lang)
}

export default i18n
