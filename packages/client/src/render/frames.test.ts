import { describe, expect, it } from 'vitest';
import { Dir } from '@boom/sim';
import { ALIEN_DEATH, alienCell, enemyCell, letterCell, playerRow } from './frames.js';

/**
 * De cijfers hieronder zijn geen aannames: ze zijn nagerekend tegen de C++-bron én tegen de
 * PNG's zelf (welke vakjes daadwerkelijk pixels bevatten). Precies daar ging het telkens mis.
 */

describe('letterCell', () => {
	/**
	 * extra_letters.png heeft twintig frames op een raster van 10 bij 2: per letter één
	 * rustende vorm plus drie morf-frames. Letter i begint op index i*4.
	 */
	it('geeft de rustende vorm van elke letter', () => {
		expect(letterCell(0, 0)).toEqual({ col: 0, row: 0 });
		expect(letterCell(1, 0)).toEqual({ col: 4, row: 0 });
		expect(letterCell(2, 0)).toEqual({ col: 8, row: 0 });
		expect(letterCell(3, 0)).toEqual({ col: 2, row: 1 });
		expect(letterCell(4, 0)).toEqual({ col: 6, row: 1 });
	});

	it('loopt tijdens de morf naar de vorm van de volgende letter', () => {
		// De laatste morf-frame van letter i is de rustende vorm van letter i+1.
		for (let i = 0; i < 4; ++i) {
			expect(letterCell(i, 4)).toEqual(letterCell(i + 1, 0));
		}
		// En de laatste letter morft terug naar de eerste.
		expect(letterCell(4, 4)).toEqual(letterCell(0, 0));
	});

	it('blijft binnen het raster van 10 bij 2', () => {
		for (let letter = 0; letter < 5; ++letter) {
			for (let step = 0; step <= 4; ++step) {
				const { col, row } = letterCell(letter, step);
				expect(col).toBeGreaterThanOrEqual(0);
				expect(col).toBeLessThan(10);
				expect(row === 0 || row === 1).toBe(true);
			}
		}
	});
});

describe('alienCell', () => {
	it('loopt bij naar rechts over de rijgrens heen', () => {
		expect(alienCell(Dir.RIGHT, 0)).toEqual({ col: 8, row: 0 });
		expect(alienCell(Dir.RIGHT, 1)).toEqual({ col: 0, row: 1 });
		expect(alienCell(Dir.RIGHT, 3)).toEqual({ col: 2, row: 1 });
	});

	it('houdt de vier looprichtingen uit elkaar', () => {
		expect(alienCell(Dir.DOWN, 0)).toEqual({ col: 0, row: 0 });
		expect(alienCell(Dir.UP, 0)).toEqual({ col: 4, row: 0 });
		expect(alienCell(Dir.LEFT, 0)).toEqual({ col: 3, row: 1 });
	});

	it('gebruikt voor sterven vakjes die niet met een looprichting botsen', () => {
		// Kolom 7 en 8 van rij 1 zijn de enige die geen enkele loopanimatie aandoet.
		const walking = new Set<string>();
		for (const dir of [Dir.UP, Dir.DOWN, Dir.LEFT, Dir.RIGHT] as const) {
			for (let f = 0; f < 4; ++f) {
				const c = alienCell(dir, f);
				walking.add(`${c.col},${c.row}`);
			}
		}
		for (const c of ALIEN_DEATH) expect(walking.has(`${c.col},${c.row}`)).toBe(false);
	});
});

describe('enemyCell', () => {
	it('deelt rij 0 tussen omlaag en omhoog, rij 1 tussen rechts en links', () => {
		expect(enemyCell(Dir.DOWN, 0)).toEqual({ col: 0, row: 0 });
		expect(enemyCell(Dir.UP, 0)).toEqual({ col: 4, row: 0 });
		expect(enemyCell(Dir.RIGHT, 0)).toEqual({ col: 0, row: 1 });
		expect(enemyCell(Dir.LEFT, 0)).toEqual({ col: 4, row: 1 });
	});

	it('blijft binnen de acht kolommen', () => {
		for (const dir of [Dir.UP, Dir.DOWN, Dir.LEFT, Dir.RIGHT] as const) {
			for (let f = 0; f < 4; ++f) expect(enemyCell(dir, f).col).toBeLessThan(8);
		}
	});
});

describe('playerRow', () => {
	it('geeft elke richting een eigen rij', () => {
		const rows = [Dir.DOWN, Dir.UP, Dir.RIGHT, Dir.LEFT].map(playerRow);
		expect(new Set(rows).size).toBe(4);
		expect(Math.max(...rows)).toBeLessThan(5);
	});
});
