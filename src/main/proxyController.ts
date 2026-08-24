import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { disableSystemProxy, enableSystemProxy } from './proxySystemConfig'
import type { ProxyState, ProxyLogEvent } from '../shared/types'

export type { ProxyStatus, ProxyState, ProxyLogEvent } from '../shared/types'

const DEFAULT_PORT = 8080

/** Управляет дочерним процессом mitmdump: запуск, остановка, разбор stdout */
export class ProxyController extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private state: ProxyState = { status: 'stopped', port: DEFAULT_PORT }
  private stdoutBuffer = ''
  private lastStderr = ''

  getState(): ProxyState {
    return this.state
  }

  private setState(next: ProxyState): void {
    this.state = next
    this.emit('status', this.state)
  }

  /** Путь к standalone-бинарнику mitmdump (PyInstaller) либо к системному в dev-режиме */
  private resolveMitmdumpPath(): string {
    if (is.dev) {
      // out/main/proxyController.js -> корень проекта, два уровня вверх
      return join(__dirname, '..', '..', '.venv', 'bin', 'mitmdump')
    }
    const platformDir = process.platform === 'darwin' ? 'mac' : process.platform
    return join(process.resourcesPath, 'bin', platformDir, 'mitmdump')
  }

  private resolveAddonPath(): string {
    if (is.dev) {
      return join(__dirname, '..', '..', 'resources', 'addon.py')
    }
    return join(process.resourcesPath, 'addon.py')
  }

  start(rulesFilePath: string, port: number = DEFAULT_PORT): void {
    if (this.child) {
      return
    }

    const mitmdumpPath = this.resolveMitmdumpPath()
    if (!existsSync(mitmdumpPath)) {
      this.setState({ status: 'crashed', port, error: `mitmdump не найден: ${mitmdumpPath}` })
      return
    }

    this.setState({ status: 'starting', port })
    this.lastStderr = ''

    const args = [
      '-s',
      this.resolveAddonPath(),
      '--set',
      `rules_file=${rulesFilePath}`,
      '--listen-host',
      '127.0.0.1',
      '--listen-port',
      String(port)
    ]

    this.child = spawn(mitmdumpPath, args)

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString())
    })

    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.lastStderr = text
      this.emit('stderr', text)
    })

    this.child.on('spawn', () => {
      this.setState({ status: 'running', port })
      this.applySystemProxy(port)
    })

    this.child.on('error', (err) => {
      this.setState({ status: 'crashed', port, error: err.message })
      this.child = null
      this.revertSystemProxy()
    })

    this.child.on('exit', (code) => {
      const wasRunning = this.state.status === 'running' || this.state.status === 'starting'
      this.child = null
      if (wasRunning && code !== 0) {
        const isPortBusy = /address already in use|errno 48|errno 98/i.test(this.lastStderr)
        const error = isPortBusy ? `Порт ${port} уже занят другим процессом` : `mitmdump завершился с кодом ${code}`
        this.setState({ status: 'crashed', port, error })
      } else if (this.state.status !== 'stopped') {
        this.setState({ status: 'stopped', port })
      }
      this.revertSystemProxy()
    })
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.setState({ status: 'stopped', port: this.state.port })
      return
    }
    this.child.kill()
    this.setState({ status: 'stopped', port: this.state.port })
    await this.revertSystemProxy()
  }

  /** Включает системный HTTP/HTTPS-прокси macOS на активных сетевых интерфейсах, как это делает Fiddler на Windows */
  private async applySystemProxy(port: number): Promise<void> {
    if (process.platform !== 'darwin') return
    try {
      await enableSystemProxy('127.0.0.1', port)
    } catch (err) {
      // пользователь мог отменить системный диалог авторизации — прокси-сервер всё равно
      // работает, просто трафик нужно будет направить через него вручную
      const message = err instanceof Error ? err.message : String(err)
      this.emit('stderr', `Не удалось включить системный прокси автоматически: ${message}`)
    }
  }

  /** Возвращает системный прокси macOS в состояние до запуска */
  private async revertSystemProxy(): Promise<void> {
    if (process.platform !== 'darwin') return
    try {
      await disableSystemProxy()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('stderr', `Не удалось восстановить системный прокси: ${message}`)
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as ProxyLogEvent
        this.emit('log', parsed)
      } catch {
        // строки без JSON (баннер mitmdump и т.п.) молча пропускаем
      }
    }
  }
}

export const proxyController = new ProxyController()
