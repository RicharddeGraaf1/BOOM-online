/**
 * Bouwt het beeld van één level: achtergrond, muren, munten, spawns, vijanden, border.
 *
 * Nog geen simulatie — dit is de statische weergave waarmee we in fase 0 controleren dat de
 * asset-pipeline en de opschaling kloppen. De tekenvolgorde is wel al die van het origineel
 * (src/lifish/level/LevelRenderer.cpp): eerst de achtergrond, dan de entities op oplopende
 * z-index, dan de border eroverheen.
 */

import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import {
	GAME_HEIGHT,
	GAME_WIDTH,
	TILE_SIZE,
	tileToPixel,
	zindex,
	type Level,
} from '@boom/sim';
import { frame, loadSheet, tile } from './textures.js';
import { snap } from './scaling.js';

/** Sheets die per level verschillen, gecachet op bestandsnaam. */
const sheetCache = new Map<string, Promise<Texture>>();

function sheet(file: string): Promise<Texture> {
	let p = sheetCache.get(file);
	if (!p) {
		p = loadSheet(file);
		sheetCache.set(file, p);
	}
	return p;
}

function place(texture: Texture, x: number, y: number, z: number): Sprite {
	const s = new Sprite(texture);
	// Hele game-pixels: zie de toelichting bij snap() in scaling.ts.
	s.x = snap(x);
	s.y = snap(y);
	s.zIndex = z;
	return s;
}

/**
 * De z-index-conventie van het origineel is omgekeerd aan die van Pixi: daar wordt z >= 0
 * ONDER de border getekend en z < 0 erboven (hoe negatiever, hoe hoger). We houden de
 * originele waarden aan in de sim en vertalen ze hier één keer.
 */
const BORDER_Z = 1000;
function toPixiZ(lifishZ: number): number {
	return lifishZ >= 0 ? lifishZ : BORDER_Z - lifishZ;
}

export async function buildLevelView(level: Level): Promise<Container> {
	const view = new Container();
	view.sortableChildren = true;

	const ids = level.tileIDs;

	const [bgTex, borderTex, fixedTex, breakableTex, coinTex, teleportTex, p1Tex, p2Tex] =
		await Promise.all([
			sheet(`bg${ids.bg}.png`),
			sheet(`border${ids.border}.png`),
			sheet('fixed.png'),
			sheet('breakable.png'),
			sheet('coin.png'),
			sheet('teleport.png'),
			sheet('player1.png'),
			sheet('player2.png'),
		]);

	// Achtergrond: een 32x32 tegel die over het hele speelveld herhaalt, ook onder de border.
	// src/lifish/entities/Level.cpp:58-60.
	const bg = new TilingSprite({ texture: bgTex, width: GAME_WIDTH, height: GAME_HEIGHT });
	bg.zIndex = -1;
	view.addChild(bg);

	// De vijandsheets die dit level nodig heeft, in één keer.
	const enemyIds = new Set<number>();
	for (const cell of level.cells) if (cell.kind === 'enemy') enemyIds.add(cell.enemyId);
	const enemyTex = new Map<number, Texture>();
	await Promise.all(
		[...enemyIds].map(async (id) => enemyTex.set(id, await sheet(`enemy${id}.png`))),
	);

	const hasBoss = level.cells.some((c) => c.kind === 'alienBoss');
	const hasBigBoss = level.cells.some((c) => c.kind === 'bigAlienBoss');
	const alienBossTex = hasBoss ? await sheet('alien_boss.png') : null;
	const bigBossTex = hasBigBoss ? await sheet('big_alien_boss.png') : null;

	for (let top = 0; top < level.height; ++top) {
		for (let left = 0; left < level.width; ++left) {
			const cell = level.cells[top * level.width + left];
			if (!cell) continue;
			const { x, y } = tileToPixel(left, top);

			switch (cell.kind) {
				case 'empty':
					break;

				// fixed.png is 8x1: kolom = tileID - 1. src/lifish/entities/FixedWall.cpp:18-20.
				case 'fixed':
					view.addChild(place(tile(fixedTex, ids.fixed - 1), x, y, toPixiZ(zindex.WALLS)));
					break;

				// breakable.png is 4x8: rij = tileID - 1, kolom 0 is heel.
				// src/lifish/entities/BreakableWall.cpp:50-54.
				case 'breakable':
					view.addChild(
						place(tile(breakableTex, 0, ids.breakable - 1), x, y, toPixiZ(zindex.WALLS)),
					);
					break;

				case 'coin':
					view.addChild(place(tile(coinTex, 0), x, y, toPixiZ(zindex.COINS)));
					break;

				case 'teleport':
					view.addChild(place(tile(teleportTex, 0), x, y, toPixiZ(zindex.TELEPORTS)));
					break;

				// Rij 0 is 'down'; frame 0 is idle. src/lifish/entities/Player.cpp:313-321.
				case 'player1':
					view.addChild(place(tile(p1Tex, 0, 0), x, y, toPixiZ(zindex.PLAYERS)));
					break;
				case 'player2':
					view.addChild(place(tile(p2Tex, 0, 0), x, y, toPixiZ(zindex.PLAYERS)));
					break;

				// idle_down = frame (0,0). src/lifish/entities/Enemy.cpp:143.
				case 'enemy': {
					const t = enemyTex.get(cell.enemyId);
					if (t) view.addChild(place(tile(t, 0, 0), x, y, toPixiZ(zindex.ENEMIES)));
					break;
				}

				// 3x3 tegels, één frame dat de hele sheet beslaat.
				// src/lifish/entities/AlienBoss.cpp:29-35.
				case 'alienBoss':
					if (alienBossTex)
						view.addChild(place(alienBossTex, x, y, toPixiZ(zindex.BOSSES)));
					break;

				// 5x5 tegels op een 4x4-raster van 160x160.
				// src/lifish/entities/BigAlienBoss.cpp:34,54.
				case 'bigAlienBoss':
					if (bigBossTex) {
						const size = 5 * TILE_SIZE;
						view.addChild(
							place(frame(bigBossTex, 0, 0, size, size), x, y, toPixiZ(zindex.BOSSES)),
						);
					}
					break;
			}
		}
	}

	// De border is een 544x480 frame met een transparant midden, en gaat over de entities heen.
	const border = new Sprite(borderTex);
	border.zIndex = BORDER_Z;
	view.addChild(border);

	return view;
}
