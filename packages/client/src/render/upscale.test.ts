import { describe, expect, it } from 'vitest';
import { scale2x } from './upscale.js';

/** Kleuren als losse waarden; Scale2x vergelijkt alleen op gelijkheid. */
const A = 0xff0000ff;
const B = 0xff00ff00;

function grid(rows: number[][]): { data: Uint32Array; w: number; h: number } {
	const h = rows.length;
	const w = rows[0]!.length;
	const data = new Uint32Array(w * h);
	for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) data[y * w + x] = rows[y]![x]!;
	return { data, w, h };
}

function at(r: { data: Uint32Array; w: number }, x: number, y: number): number {
	return r.data[y * r.w + x]!;
}

describe('scale2x', () => {
	it('verdubbelt de afmetingen', () => {
		const src = grid([
			[A, A],
			[A, A],
		]);
		const out = scale2x(src.data, src.w, src.h);
		expect(out.w).toBe(4);
		expect(out.h).toBe(4);
	});

	it('laat een vlak van één kleur ongemoeid', () => {
		const src = grid([
			[A, A, A],
			[A, A, A],
			[A, A, A],
		]);
		const out = scale2x(src.data, src.w, src.h);
		expect([...out.data].every((v) => v === A)).toBe(true);
	});

	it('rondt een diagonale trap af', () => {
		// B ligt linksboven van het midden; de regel vult dan alleen de linkerbovenhoek.
		const src = grid([
			[B, B, A],
			[B, A, A],
			[A, A, A],
		]);
		const out = scale2x(src.data, src.w, src.h);
		// Middenpixel (1,1) wordt vier subpixels op (2,2)..(3,3).
		expect(at(out, 2, 2)).toBe(B); // linksboven: buren boven en links zijn beide B
		expect(at(out, 3, 2)).toBe(A);
		expect(at(out, 2, 3)).toBe(A);
		expect(at(out, 3, 3)).toBe(A);
	});

	it('verzint nooit een kleur die niet in het origineel zat', () => {
		const src = grid([
			[B, A, B],
			[A, B, A],
			[B, A, B],
		]);
		const out = scale2x(src.data, src.w, src.h);
		for (const v of out.data) expect(v === A || v === B).toBe(true);
	});
});
