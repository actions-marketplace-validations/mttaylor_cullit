export type LogLevel = 'quiet' | 'normal' | 'verbose';

export interface Logger {
  info(msg: string): void;
  verbose(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(level: LogLevel = 'normal'): Logger {
  return {
    info(msg: string) {
      if (level !== 'quiet') console.log(msg);
    },
    verbose(msg: string) {
      if (level === 'verbose') console.log(msg);
    },
    warn(msg: string) {
      if (level !== 'quiet') console.warn(msg);
    },
    error(msg: string) {
      console.error(msg);
    },
  };
}
