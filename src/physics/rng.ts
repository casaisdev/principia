/**
 * mulberry32 - a tiny, fast, seedable PRNG. Seeding makes the random presets
 * (e.g. "chaos") reproducible, so a given seed always yields the same system
 * and can later be shared via the URL.
 *
 * @returns a function producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform float in [min, max). */
export function range(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng()
}
