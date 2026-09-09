/**
 * De wereldstaat.
 *
 * Alles hier is platte data: geen klassen, geen functies, geen verwijzingen naar andere
 * entities. Dat is geen stijlvoorkeur maar een eis — deze staat moet in een snapshot passen
 * die over een WebSocket gaat, en op de server precies zo geüpdatet worden als op de client.
 *
 * Coördinaten zijn speelveld-pixels inclusief de border van één tegel, net als in het
 * origineel: tegel (0,0) van de tilemap ligt op pixel (32,32). Tegelcoördinaten in deze code
 * zijn dus altijd 1..width en 1..height, met 0 en width+1 als muur.
 */

import { bomb as BOMB, player as PLAYER } from './constants.js';
import type { Direction } from './direction.js';
import type { Rng } from './rng.js';
import type { RawEnemy } from './levelset.js';

export type EntityKind =
	| 'player'
	| 'enemy'
	| 'boss'
	| 'bomb'
	| 'explosion'
	| 'breakable'
	| 'coin'
	| 'bonus'
	| 'teleport'
	| 'bullet'
	| 'letter';

export const BonusType = {
	MAX_BOMBS: 0,
	QUICK_FUSE: 1,
	MAX_RANGE: 2,
	SHIELD: 3,
	SPEEDY: 4,
	ZAPPER: 5,
	SUDDEN_DEATH: 6,
	HEALTH_SMALL: 7,
	HEALTH_FULL: 8,
} as const;

export type BonusKind = (typeof BonusType)[keyof typeof BonusType];

/** Relatieve kansen per gesloopte muur. src/lifish/conf/bonus.cpp — laatste is "niets". */
export const BONUS_WEIGHTS = [15, 15, 15, 15, 15, 3, 3, 15, 15, 889] as const;

export interface Entity {
	id: number;
	kind: EntityKind;
	/** linkerbovenhoek in speelveld-pixels */
	x: number;
	y: number;

	// ── beweging ──
	dir: Direction;
	/** de richting waarin de sprite kijkt als er niet bewogen wordt */
	facing: Direction;
	moving: boolean;
	/** pixels per seconde */
	speed: number;
	/** afstand sinds de laatste richtingswissel; de AI stuurt hierop */
	distTravelled: number;
	/** resterende blokkeertijd na een schot (AttackType BLOCKING) */
	blockedT: number;
	/** snelheidsvermenigvuldiger bij een dash-aanval */
	dash: number;

	// ── leven ──
	hp: number;
	maxHp: number;
	dead: boolean;
	/** tijd sinds sterven; entities blijven even staan voor hun doodsanimatie */
	deadT: number;
	/** onkwetsbaar tot deze teller op is */
	shieldT: number;

	// ── per soort ──
	/** player: 1 of 2 */
	playerId?: number;
	/** enemy: 1..10, verwijst naar enemy{n}.png en de definitie in levels.json */
	enemyId?: number;
	/** enemy: in extra game morfen vijanden naar de alien-sprite */
	morphed?: boolean;
	/** enemy/boss: resterende oplaadtijd van het wapen */
	rechargeT?: number;
	/** enemy: doeltegel van een contactaanval, in tegelcoördinaten */
	attackTileX?: number;
	attackTileY?: number;
	/** bomb */
	fuseT?: number;
	fuseTime?: number;
	radius?: number;
	/** id van de speler die de bom legde */
	ownerId?: number;
	/** explosion: hoever de vlam per richting reikt, in tegels (UP, LEFT, DOWN, RIGHT) */
	reach?: [number, number, number, number];
	/** explosion: levensduur */
	t?: number;
	/** explosion: id's die deze explosie al geraakt heeft, zodat schade één keer telt */
	damagedIds?: number[];
	/** breakable/coin/teleport: tegelcoördinaten */
	tx?: number;
	ty?: number;
	/** bonus */
	bonus?: BonusKind;
	/** bullet */
	bulletData?: number;
	damage?: number;
	rangeLeft?: number;
	vx?: number;
	vy?: number;
	/** boss: type */
	bossKind?: 'alien' | 'bigAlien';
	/** boss/enemy: interne timer voor het aanvalspatroon */
	phaseT?: number;
	/** letter: 0..4, samen spellen ze EXTRA */
	letter?: number;
	/** resterende cooldown na een warp; voorkomt heen-en-weer stuiteren tussen twee teleports */
	teleportCd?: number;
	/** één tick lang waar na een warp; de vijand-AI kiest dan een nieuwe richting */
	justWarped?: boolean;
	/** gevraagde bocht die nog niet kon; wordt gepakt zodra de entity op het raster staat */
	queuedDir?: Direction;
	/** animatie-fase, puur cosmetisch maar wel in de snapshot zodat clients gelijk lopen */
	animT: number;
}

/** Persistente spelerdata: gaat mee van level naar level. */
export interface PlayerState {
	id: number;
	score: number;
	remainingLives: number;
	continues: number;
	/** welke van de vijf EXTRA-letters verzameld zijn */
	letters: [boolean, boolean, boolean, boolean, boolean];
	powers: {
		maxBombs: number;
		bombRadius: number;
		bombFuseTime: number;
	};
	/** blijft staan terwijl de speler dood is, zodat de HUD iets kan tonen */
	life: number;
	/** speler is definitief uitgespeeld (geen levens en geen continues meer) */
	out: boolean;
	/** verbonden speler in een online sessie; solo is dit altijd waar voor speler 1 */
	present: boolean;
}

/** De krachten waarmee een speler begint, en waarop hij bij dood terugvalt. */
export function defaultPowers(): PlayerState['powers'] {
	return {
		// src/lifish/entities/Player.hpp:19-24 — je begint met vijf bommen, niet met één.
		maxBombs: PLAYER.DEFAULT_MAX_BOMBS,
		bombRadius: BOMB.DEFAULT_RADIUS,
		bombFuseTime: BOMB.DEFAULT_FUSE,
	};
}

export type GameEvent =
	| { t: 'sound'; name: string }
	| { t: 'fx'; name: 'flash' | 'teleport'; x: number; y: number }
	| { t: 'points'; value: number; x: number; y: number; boss?: boolean }
	| { t: 'text'; name: 'hurryUp' | 'extraGame' | 'gameOver' | 'levelClear' };

export type WorldStatus = 'playing' | 'cleared' | 'retry' | 'gameover';

export interface World {
	tick: number;
	levelNum: number;
	width: number;
	height: number;
	tileIDs: { bg: number; border: number; fixed: number; breakable: number };

	/**
	 * Vaste muren, inclusief de border. Index (ty * (width + 2) + tx) met tx, ty in
	 * 0..width+1 en 0..height+1. Verandert nooit tijdens een level, dus dit hoeft niet
	 * in elke snapshot mee.
	 */
	fixed: Uint8Array;
	/** Spiegel van de levende breekbare muren, voor botsingen in O(1). */
	breakable: Uint8Array;

	entities: Entity[];
	nextId: number;
	rng: Rng;

	/** resterende leveltijd in seconden */
	timeLeft: number;
	hurryUp: boolean;
	hurryUpWarned: boolean;
	extraGame: boolean;
	extraGameTriggered: boolean;
	extraGameT: number;
	/** Had dit level überhaupt munten? Zo niet, dan is er geen extra game te verdienen. */
	hadCoins: boolean;
	/** Seconden sinds het laatste vijandje viel; zolang die loopt speel je gewoon door. */
	clearedT: number;

	players: PlayerState[];
	enemyDefs: RawEnemy[];

	status: WorldStatus;
	/** wordt elke tick geleegd; de renderer en het geluid lezen hem uit */
	events: GameEvent[];
}

/** Wat een speler per tick doet. Dit is alles wat over de lijn hoeft. */
export interface PlayerInput {
	up: boolean;
	down: boolean;
	left: boolean;
	right: boolean;
	bomb: boolean;
}

export const NO_INPUT: PlayerInput = {
	up: false,
	down: false,
	left: false,
	right: false,
	bomb: false,
};
