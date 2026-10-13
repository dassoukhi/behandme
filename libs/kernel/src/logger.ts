/** What shared code needs from a logger. Nest's `Logger` satisfies it. */
export interface Logger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
