export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface Logger {
  log(entry: LogEntry): void;
}
export interface fileLog {
    logConsoleOutput(entry: LogEntry): void;
}
