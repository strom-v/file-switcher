import { defineConfig } from 'vitest/config'

// unit-тесты чистых функций main/shared/renderer — без запуска Electron и без DOM.
// Файлы тестов: src/**/*.test.ts. Модули, которым нужен 'electron' (logStore), мокают его через vi.mock.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
