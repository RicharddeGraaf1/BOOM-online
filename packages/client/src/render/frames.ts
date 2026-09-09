/**
 * Waar iets in een sprite-sheet staat.
 *
 * Puur rekenwerk, zonder Pixi, zodat het te testen is zonder GPU. Dat is geen luxe: de
 * indelingen van deze sheets zijn allesbehalve regelmatig, en elke keer dat ik ze uit de
 * C++-rechthoeken afleidde zonder ze na te rekenen zat er iets fout — een letter die
 * halverwege zijn morf bleef staan, een alien die stierf als het beestje dat hij ooit was.
 */

import { Dir, type Direction } from '@boom/sim';

export interface Cell {
	col: number;
	row: number;
}

/** Rij in player{n}.png per kijkrichting. src/lifish/entities/Player.cpp:269-279 */
export function playerRow(dir: Direction): number {
	switch (dir) {
		case Dir.UP:
			return 1;
		case Dir.RIGHT:
			return 2;
		case Dir.LEFT:
			return 3;
		default:
			return 0;
	}
}

/**
 * enemy{n}.png is 8 bij 3. Down en up delen rij 0, right en left rij 1, elk met vier frames.
 * src/lifish/entities/Enemy.cpp:120-141
 */
export function enemyCell(dir: Direction, frame: number): Cell {
	switch (dir) {
		case Dir.UP:
			return { col: 4 + frame, row: 0 };
		case Dir.RIGHT:
			return { col: frame, row: 1 };
		case Dir.LEFT:
			return { col: 4 + frame, row: 1 };
		default:
			return { col: frame, row: 0 };
	}
}

/**
 * aliensprite.png is 9 bij 2 en loopt over de rijgrens heen: walk_right begint op kolom 8
 * van rij 0 en gaat verder op rij 1. src/lifish/components/AlienSprite.cpp:24-49
 */
export function alienCell(dir: Direction, frame: number): Cell {
	switch (dir) {
		case Dir.UP:
			return { col: 4 + frame, row: 0 };
		case Dir.RIGHT:
			return frame === 0 ? { col: 8, row: 0 } : { col: frame - 1, row: 1 };
		case Dir.LEFT:
			return { col: 3 + frame, row: 1 };
		default:
			return { col: frame, row: 0 };
	}
}

/** De twee sterfframes van de alien: kolom 7 en 8 op rij 1. */
export const ALIEN_DEATH: readonly Cell[] = [
	{ col: 7, row: 1 },
	{ col: 8, row: 1 },
];

/**
 * extra_letters.png bevat geen vijf letters maar twintig frames op een raster van 10 bij 2:
 * per letter één volledige vorm plus drie frames die naar de volgende letter morfen. Letter
 * i begint op index i*4. Op kolom `i` kijken — wat ik deed — levert dus een half omgevormde
 * letter op. src/lifish/entities/Letter.cpp:61-77
 *
 * `step` is 0 voor de rustende vorm en 1..4 tijdens de overgang.
 */
export function letterCell(letter: number, step: number): Cell {
	const idx = (letter * 4 + step) % 20;
	return { col: idx % 10, row: Math.floor(idx / 10) };
}
