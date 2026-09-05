/**
 * Tilemap-codering. Transcriptie van src/lifish/entity_type.cpp:5-28 (lifish v1.8.2).
 */

export const Tile = {
	EMPTY: 'empty',
	FIXED: 'fixed',
	BREAKABLE: 'breakable',
	COIN: 'coin',
	PLAYER1: 'player1',
	PLAYER2: 'player2',
	PLAYER3: 'player3',
	PLAYER4: 'player4',
	TELEPORT: 'teleport',
	ENEMY: 'enemy',
	ALIEN_BOSS: 'alienBoss',
	BIG_ALIEN_BOSS: 'bigAlienBoss',
} as const;

export type TileKind = (typeof Tile)[keyof typeof Tile];

/** Een tegel uit de tilemap. Bij `enemy` zegt `enemyId` welk type (1..10). */
export type TileCell =
	| { kind: Exclude<TileKind, 'enemy'> }
	| { kind: 'enemy'; enemyId: number };

const CHAR_TO_CELL: Readonly<Record<string, TileCell>> = {
	'0': { kind: Tile.EMPTY },
	'1': { kind: Tile.FIXED },
	'2': { kind: Tile.BREAKABLE },
	'3': { kind: Tile.COIN },
	X: { kind: Tile.PLAYER1 },
	Y: { kind: Tile.PLAYER2 },
	// Eigen uitbreiding: gegenereerd door packages/assets/spawns.mjs, niet uit het origineel.
	Z: { kind: Tile.PLAYER3 },
	W: { kind: Tile.PLAYER4 },
	'+': { kind: Tile.TELEPORT },
	A: { kind: Tile.ENEMY, enemyId: 1 },
	B: { kind: Tile.ENEMY, enemyId: 2 },
	C: { kind: Tile.ENEMY, enemyId: 3 },
	D: { kind: Tile.ENEMY, enemyId: 4 },
	E: { kind: Tile.ENEMY, enemyId: 5 },
	F: { kind: Tile.ENEMY, enemyId: 6 },
	G: { kind: Tile.ENEMY, enemyId: 7 },
	H: { kind: Tile.ENEMY, enemyId: 8 },
	I: { kind: Tile.ENEMY, enemyId: 9 },
	J: { kind: Tile.ENEMY, enemyId: 10 },
	'*': { kind: Tile.ALIEN_BOSS },
	'/': { kind: Tile.BIG_ALIEN_BOSS },
};

/** Geeft `undefined` bij een onbekend teken — de aanroeper bepaalt of dat fataal is. */
export function cellFromChar(c: string): TileCell | undefined {
	return CHAR_TO_CELL[c];
}

/**
 * Positie van een tegel in speelveld-pixels, inclusief de border van één tegel.
 * Transcriptie van src/lifish/level/LevelLoader.cpp:48.
 */
export function tileToPixel(left: number, top: number): { x: number; y: number } {
	return { x: (left + 1) * 32, y: (top + 1) * 32 };
}
