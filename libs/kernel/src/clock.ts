/** Source of the current time, injected so that time-dependent rules can be tested. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
