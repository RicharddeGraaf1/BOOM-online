/**
 * Richtingen. De volgorde is die van het origineel (src/core/Direction.hpp) en wordt
 * op meer plekken als index gebruikt — o.a. in de explosiepropagatie en het zichtsysteem.
 */

export const Dir = {
	UP: 0,
	LEFT: 1,
	DOWN: 2,
	RIGHT: 3,
	NONE: 4,
} as const;

export type Direction = (typeof Dir)[keyof typeof Dir];

/** De vier echte richtingen, in de volgorde die ai_helpers.cpp aanhoudt. */
export const DIRECTIONS: readonly Direction[] = [Dir.UP, Dir.RIGHT, Dir.DOWN, Dir.LEFT];

const VERSORS: readonly (readonly [number, number])[] = [
	[0, -1], // UP
	[-1, 0], // LEFT
	[0, 1], // DOWN
	[1, 0], // RIGHT
	[0, 0], // NONE
];

export function versor(d: Direction): readonly [number, number] {
	return VERSORS[d] ?? VERSORS[Dir.NONE]!;
}

export function opposite(d: Direction): Direction {
	switch (d) {
		case Dir.UP:
			return Dir.DOWN;
		case Dir.DOWN:
			return Dir.UP;
		case Dir.LEFT:
			return Dir.RIGHT;
		case Dir.RIGHT:
			return Dir.LEFT;
		default:
			return Dir.NONE;
	}
}

export function isVertical(d: Direction): boolean {
	return d === Dir.UP || d === Dir.DOWN;
}

export function dirName(d: Direction): 'up' | 'down' | 'left' | 'right' {
	switch (d) {
		case Dir.UP:
			return 'up';
		case Dir.LEFT:
			return 'left';
		case Dir.RIGHT:
			return 'right';
		default:
			return 'down';
	}
}
