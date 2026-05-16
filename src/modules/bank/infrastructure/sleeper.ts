export abstract class Sleeper {
  abstract sleep(ms: number): Promise<void>;
}

export class RealSleeper extends Sleeper {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
