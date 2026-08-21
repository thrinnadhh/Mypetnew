export class FakeClock {
  private currentMilliseconds: number;

  constructor(initial: Date | number = 0) {
    this.currentMilliseconds = initial instanceof Date ? initial.getTime() : initial;
  }

  now = (): Date => new Date(this.currentMilliseconds);

  advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error("Clock advance must be a finite non-negative number");
    }
    this.currentMilliseconds += milliseconds;
  }
}
