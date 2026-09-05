import { describe, expect, it } from 'vitest';
import { computeScaling } from './scaling.js';

describe('computeScaling', () => {
	it('kiest een hele factor en houdt de rest als letterbox', () => {
		// 1920x1080 op dpr 1: hoogte is beperkend (1080/480 = 2.25), dus 2x.
		const s = computeScaling(1920, 1080, 1);
		expect(s.scale).toBe(2);
		expect(s.bufferWidth).toBe(1280);
		expect(s.bufferHeight).toBe(960);
	});

	it('rekent de factor in device-pixels, niet in CSS-pixels', () => {
		// Dit is het geval waar naïeve CSS-opschaling misgaat: 1280x800 CSS lijkt 1x, maar op
		// een dpr-2-scherm is er ruimte voor 3x aan echte pixels (1600/480 = 3.33).
		const s = computeScaling(1280, 800, 2);
		expect(s.scale).toBe(3);
		expect(s.bufferWidth).toBe(1920);
		// De CSS-maat compenseert de dpr, zodat 1 backingstore-pixel 1 device-pixel is.
		expect(s.cssWidth).toBe(960);
		expect(s.cssHeight).toBe(720);
	});

	it('zakt nooit onder 1x', () => {
		// Liever afgesneden dan wazig.
		expect(computeScaling(320, 240, 1).scale).toBe(1);
	});

	it('houdt de verhouding exact 4:3', () => {
		for (const [w, h, dpr] of [
			[1920, 1080, 1],
			[2560, 1440, 1],
			[3840, 2160, 1.5],
			[1440, 900, 2],
		] as const) {
			const s = computeScaling(w, h, dpr);
			expect(s.bufferWidth / s.bufferHeight).toBeCloseTo(4 / 3);
			expect(Number.isInteger(s.scale)).toBe(true);
		}
	});
});
