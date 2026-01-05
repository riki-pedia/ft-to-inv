export interface LogOptions {
  color?: 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  level?: 'info' | 'warn' | 'error'
}
export interface Logger {
  log(message: string, options?: LogOptions): void
}
