import type { Clock } from "@lib/kernel";

/** A clock that moves only when told to. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
