/**
 * Deterministische pseudo-random generator.
 *
 * Het origineel gebruikt `std::mt19937` met een niet-vastgelegde seed; dat kan hier niet, want
 * server en client moeten dezelfde wereld uitrekenen. Mulberry32: één 32-bits woord staat, dus
 * de hele generator past in een snapshot.
 */

export interface Rng {
	s: number;
}

export function makeRng(seed: number): Rng {
	// Een seed van 0 laat mulberry32 in een korte cyclus vallen.
	return { s: (seed | 0) === 0 ? 0x9e3779b9 : seed | 0 };
}

/** Float in [0, 1). */
export function random(rng: Rng): number {
	rng.s = (rng.s + 0x6d2b79f5) | 0;
	let t = rng.s;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Geheel getal in [lo, hi], beide inclusief — zoals std::uniform_int_distribution. */
export function randomInt(rng: Rng, lo: number, hi: number): number {
	return lo + Math.floor(random(rng) * (hi - lo + 1));
}

export function randomFloat(rng: Rng, lo: number, hi: number): number {
	return lo + random(rng) * (hi - lo);
}

export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
	if (items.length === 0) return undefined;
	return items[randomInt(rng, 0, items.length - 1)];
}

/**
 * Trekt een index uit een discrete verdeling met gewichten, zoals
 * std::discrete_distribution. Gebruikt voor de bonuskans per gesloopte muur.
 */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
	let total = 0;
	for (const w of weights) total += w;
	let r = random(rng) * total;
	for (let i = 0; i < weights.length; ++i) {
		r -= weights[i]!;
		if (r < 0) return i;
	}
	return weights.length - 1;
}
