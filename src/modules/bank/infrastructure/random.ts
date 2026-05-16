/**
 * Tiny seam for randomness so tests can swap deterministic implementations.
 */
export abstract class Random {
  /** Returns a number in [0, 1). */
  abstract next(): number;
}

export class MathRandom extends Random {
  next(): number {
    return Math.random();
  }
}
