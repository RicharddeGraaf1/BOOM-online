/**
 * Fabriekjes voor entities. Alle waarden komen uit de C++-constanten in constants.ts.
 */

import { Dir, type Direction } from './direction.js';
import { TILE_SIZE, bomb as BOMB, enemy as ENEMY, player as PLAYER } from './constants.js';
import type { BonusKind, Entity, EntityKind, World } from './types.js';

function base(id: number, kind: EntityKind, x: number, y: number): Entity {
	return {
		id,
		kind,
		x,
		y,
		dir: Dir.NONE,
		facing: Dir.DOWN,
		moving: false,
		speed: 0,
		distTravelled: 0,
		blockedT: 0,
		dash: 0,
		hp: 1,
		maxHp: 1,
		dead: false,
		deadT: 0,
		shieldT: 0,
		animT: 0,
	};
}

export function newId(w: World): number {
	return w.nextId++;
}

export function spawn(w: World, e: Entity): Entity {
	w.entities.push(e);
	return e;
}

export function makePlayer(w: World, playerId: number, x: number, y: number): Entity {
	const e = base(newId(w), 'player', x, y);
	e.playerId = playerId;
	e.speed = PLAYER.DEFAULT_SPEED;
	e.hp = PLAYER.MAX_LIFE;
	e.maxHp = PLAYER.MAX_LIFE;
	return e;
}

export function makeEnemy(w: World, enemyId: number, x: number, y: number): Entity {
	const def = w.enemyDefs[enemyId - 1];
	const e = base(newId(w), 'enemy', x, y);
	e.enemyId = enemyId;
	e.speed = ENEMY.BASE_SPEED * (def?.speed ?? 1);
	e.hp = ENEMY.BASE_LIFE;
	e.maxHp = ENEMY.BASE_LIFE;
	e.dir = Dir.DOWN;
	e.moving = true;
	e.rechargeT = 0;
	e.morphed = false;
	e.attackTileX = -1;
	e.attackTileY = -1;
	return e;
}

export function makeBreakable(w: World, tx: number, ty: number): Entity {
	const e = base(newId(w), 'breakable', tx * TILE_SIZE, ty * TILE_SIZE);
	e.tx = tx;
	e.ty = ty;
	return e;
}

export function makeCoin(w: World, tx: number, ty: number): Entity {
	const e = base(newId(w), 'coin', tx * TILE_SIZE, ty * TILE_SIZE);
	e.tx = tx;
	e.ty = ty;
	return e;
}

export function makeTeleport(w: World, tx: number, ty: number): Entity {
	const e = base(newId(w), 'teleport', tx * TILE_SIZE, ty * TILE_SIZE);
	e.tx = tx;
	e.ty = ty;
	return e;
}

export function makeBomb(
	w: World,
	tx: number,
	ty: number,
	ownerId: number,
	fuseTime: number,
	radius: number,
): Entity {
	const e = base(newId(w), 'bomb', tx * TILE_SIZE, ty * TILE_SIZE);
	e.tx = tx;
	e.ty = ty;
	e.ownerId = ownerId;
	e.fuseT = 0;
	e.fuseTime = fuseTime;
	e.radius = radius;
	return e;
}

export function makeExplosion(
	w: World,
	tx: number,
	ty: number,
	reach: [number, number, number, number],
	ownerId: number,
): Entity {
	const e = base(newId(w), 'explosion', tx * TILE_SIZE, ty * TILE_SIZE);
	e.tx = tx;
	e.ty = ty;
	e.reach = reach;
	e.ownerId = ownerId;
	e.t = 0;
	e.damage = BOMB.EXPL_DAMAGE;
	return e;
}

export function makeBonus(w: World, tx: number, ty: number, kind: BonusKind): Entity {
	const e = base(newId(w), 'bonus', tx * TILE_SIZE, ty * TILE_SIZE);
	e.tx = tx;
	e.ty = ty;
	e.bonus = kind;
	e.t = 0;
	return e;
}

export function makeLetter(w: World, x: number, y: number, letter: number): Entity {
	const e = base(newId(w), 'letter', x, y);
	e.letter = letter;
	e.t = 0;
	return e;
}

export function makeBullet(
	w: World,
	x: number,
	y: number,
	dirOrAngle: Direction | number,
	dataId: number,
	damage: number,
	speed: number,
	range: number,
	free = false,
): Entity {
	const e = base(newId(w), 'bullet', x, y);
	e.bulletData = dataId;
	e.damage = damage;
	e.speed = speed;
	e.rangeLeft = range;
	if (free) {
		const angle = dirOrAngle as number;
		e.vx = Math.cos(angle);
		e.vy = Math.sin(angle);
		e.dir = Dir.NONE;
	} else {
		const d = dirOrAngle as Direction;
		e.dir = d;
		e.facing = d;
		e.vx = d === Dir.LEFT ? -1 : d === Dir.RIGHT ? 1 : 0;
		e.vy = d === Dir.UP ? -1 : d === Dir.DOWN ? 1 : 0;
	}
	return e;
}

export function makeBoss(
	w: World,
	kind: 'alien' | 'bigAlien',
	tx: number,
	ty: number,
): Entity {
	const e = base(newId(w), 'boss', tx * TILE_SIZE, ty * TILE_SIZE);
	e.bossKind = kind;
	e.hp = kind === 'alien' ? 20 : 40;
	e.maxHp = e.hp;
	e.speed = kind === 'alien' ? 0 : 90;
	e.rechargeT = 0;
	e.phaseT = 0;
	e.dir = kind === 'alien' ? Dir.NONE : Dir.LEFT;
	e.moving = kind !== 'alien';
	return e;
}
