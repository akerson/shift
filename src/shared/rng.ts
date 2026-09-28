// Seeded, deterministic RNG. Identical output in Node and every browser.

/** cyrb128 string hash → four 32-bit seeds. */
export function hashSeed(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface Rng {
  /** Unsigned 32-bit integer. */
  u32(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [0, 1). Avoid in the simulation — integer maths only there. */
  float(): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
  chance(numerator: number, denominator: number): boolean;
}

/** sfc32 PRNG. */
export function createRng(seed: string): Rng {
  let [a, b, c, d] = hashSeed(seed);
  const u32 = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 15; i++) u32();

  const int = (min: number, max: number): number => {
    const range = max - min + 1;
    if (range <= 0) throw new Error(`bad range [${min}, ${max}]`);
    // Rejection sampling for an unbiased result.
    const limit = Math.floor(0x100000000 / range) * range;
    let x = u32();
    while (x >= limit) x = u32();
    return min + (x % range);
  };

  return {
    u32,
    int,
    float: () => u32() / 0x100000000,
    pick: (arr) => {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[int(0, arr.length - 1)]!;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = int(0, i);
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      }
      return arr;
    },
    chance: (n, dnm) => int(0, dnm - 1) < n,
  };
}

/** The seed string for a given day's puzzle. */
export function dailySeed(date: string, generatorVersion: string): string {
  return `shift:${generatorVersion}:${date}`;
}
