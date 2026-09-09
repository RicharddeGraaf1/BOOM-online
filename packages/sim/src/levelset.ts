/**
 * Inlezen van `levels.json` — het originele formaat van lifish/LifishEdit blijft de bron.
 * Zie src/lifish/level/LevelSet.cpp voor de C++-kant.
 */

import { cellFromChar, type TileCell } from './tiles.js';

// ── Het formaat zoals het op schijf staat ────────────────────────────────────

export interface RawTrack {
	name: string;
	author: string;
	loop: { start: number; length: number };
}

export interface RawEnemyAttack {
	/** o.a. 'simple' | 'blocking' | 'contact' | 'ranged' */
	type: string[];
	/** verwijst naar de bullet-data-tabel (conf/bullet.cpp) */
	id?: number;
	fireRate: number;
	blockTime?: number;
	/**
	 * Schade bij aanraking. Ontbreekt het veld, dan geldt de standaard uit Attack.hpp: 1.
	 * (De lader van lifish maakt er 0 van; zie de toelichting bij checkBodyContact.)
	 */
	contactDamage?: number;
	tileRange?: number;
}

export interface RawEnemy {
	name: string;
	/** index in ai_functions.cpp */
	ai: number;
	/** vermenigvuldiger op enemy.BASE_SPEED */
	speed: number;
	attack: RawEnemyAttack;
}

export interface RawLevel {
	num: number;
	/** seconden op de klok */
	time: number;
	/** 1-based index in `tracks` */
	music: number;
	width: number;
	height: number;
	tileIDs: { bg: number; border: number; fixed: number; breakable: number };
	tilemap: string;
	effects: string[];
}

export interface RawLevelSet {
	name: string;
	author: string;
	difficulty: string;
	created: string;
	comment: string;
	tracks: RawTrack[];
	enemies: RawEnemy[];
	levels: RawLevel[];
}

// ── Het formaat waar de simulatie mee werkt ──────────────────────────────────

export interface Level {
	num: number;
	time: number;
	music: number;
	width: number;
	height: number;
	tileIDs: RawLevel['tileIDs'];
	/** row-major, lengte width * height */
	cells: TileCell[];
}

export interface LevelSet {
	name: string;
	author: string;
	tracks: RawTrack[];
	enemies: RawEnemy[];
	levels: Level[];
}

export function parseLevel(raw: RawLevel): Level {
	const expected = raw.width * raw.height;
	const cells: TileCell[] = [];

	for (let i = 0; i < expected; ++i) {
		const c = raw.tilemap[i];
		if (c === undefined)
			throw new Error(`Level ${raw.num}: tilemap is te kort (${raw.tilemap.length}, verwacht ${expected})`);
		const cell = cellFromChar(c);
		if (cell === undefined)
			throw new Error(`Level ${raw.num}: onbekend tilemap-teken '${c}' op positie ${i}`);
		cells.push(cell);
	}

	return {
		num: raw.num,
		time: raw.time,
		music: raw.music,
		width: raw.width,
		height: raw.height,
		tileIDs: raw.tileIDs,
		cells,
	};
}

export function parseLevelSet(raw: RawLevelSet): LevelSet {
	return {
		name: raw.name,
		author: raw.author,
		tracks: raw.tracks,
		enemies: raw.enemies,
		levels: raw.levels.map(parseLevel),
	};
}

/** Tegel op (left, top), of `undefined` buiten het speelveld. */
export function tileAt(level: Level, left: number, top: number): TileCell | undefined {
	if (left < 0 || top < 0 || left >= level.width || top >= level.height) return undefined;
	return level.cells[top * level.width + left];
}
