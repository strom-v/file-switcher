import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ru from './ru.json'
import en from './en.json'

// язык задаётся языком системы (ru/en); ручное переключение убрано
i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en }
  },
  lng: navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

export default i18n
