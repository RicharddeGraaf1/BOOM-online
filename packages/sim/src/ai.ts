/**
 * Vijanden, hun AI, hun kogels en de twee bosses.
 *
 * De vijf AI-routines zijn een transcriptie van src/lifish/ai_functions.cpp. De macro's
 * daar (HANDLE_NOT_MOVING, HANDLE_UNALIGNED, NEW_DIRECTION, SAME_DIRECTION) zijn hier
 * gewone code geworden; de beslisvolgorde is per routine één op één overgenomen, want
 * juist die volgorde bepaalt hoe een vijand aanvoelt.
 *
 * levels.json bepaalt per vijand welke routine draait:
 *   0 ai_random · 1 ai_random_forward · 2 ai_random_forward_haunt (mean-o-taur)
 *   3 ai_follow · 4 ai_follow_dash (ghost)
 */

import { BULLET_BASE_SPEED, TILE_SIZE } from './constants.js';
import { DIRECTIONS, Dir, opposite, versor, type Direction } from './direction.js';
import { entityTile, inBounds, isWall, manhattan } from './grid.js';
import { moveEntity, nearGrid, trySetDirection, canGo } from './movement.js';
import { randomInt } from './rng.js';
import { sound } from './events.js';
import { makeBullet, spawn } from './entities.js';
import { hurtPlayer } from './players.js';
import { teleportStep } from './teleport.js';
import type { RawEnemyAttack } from './levelset.js';
import type { Entity, World } from './types.js';

const OPPOSITE_NOT_LAST_CHOICE = 2;

function hasType(attack: RawEnemyAttack | undefined, name: string): boolean {
	return attack?.type.includes(name) ?? false;
}

/**
 * Bezette tegels: vijanden zijn massief voor elkaar (collision_layers.cpp:78-84).
 *
 * Eén raster per tick in plaats van één per vijand. Met tien vijanden scheelt dat negen
 * allocaties per tick, en dit draait 60 keer per seconde per kamer op de server.
 */
const blockerGrids = new WeakMap<World, { tick: number; grid: Uint8Array }>();

function occupancyGrid(w: World): Uint8Array {
	const cached = blockerGrids.get(w);
	if (cached && cached.tick === w.tick) return cached.grid;

	const grid = cached?.grid ?? new Uint8Array((w.width + 2) * (w.height + 2));
	grid.fill(0);
	for (const e of w.entities) {
		if (e.dead) continue;
		if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
		const { tx, ty } = entityTile(e);
		if (inBounds(w, tx, ty)) grid[ty * (w.width + 2) + tx] = 1;
	}
	blockerGrids.set(w, { tick: w.tick, grid });
	return grid;
}

/** Transcriptie van lif::ai::selectRandomViable. */
function selectRandomViable(
	w: World,
	e: Entity,
	opp: Direction,
	flags = 0,
	blockers?: Uint8Array,
): Direction {
	const viable: Direction[] = [];
	for (const d of DIRECTIONS) if (d !== opp && canGo(w, e, d, blockers)) viable.push(d);
	if (viable.length === 0 || flags & OPPOSITE_NOT_LAST_CHOICE) viable.push(opp);
	return viable[randomInt(w.rng, 0, viable.length - 1)]!;
}

/**
 * Ziet deze entity een levende speler, en zo ja in welke richting? Transcriptie van
 * lif::ai::seeingPlayer: het zicht loopt langs de assen tot de eerste muur.
 */
function seeingPlayer(w: World, e: Entity, maxTiles = 100): Direction {
	const from = entityTile(e);
	let best: Direction = Dir.NONE;
	let bestDist = Infinity;

	for (const d of DIRECTIONS) {
		const [dx, dy] = versor(d);
		for (let r = 1; r <= maxTiles; ++r) {
			const tx = from.tx + dx * r;
			const ty = from.ty + dy * r;
			if (isWall(w, tx, ty)) break;
			for (const p of w.entities) {
				if (p.kind !== 'player' || p.dead) continue;
				const pt = entityTile(p);
				if (pt.tx === tx && pt.ty === ty && r < bestDist) {
					bestDist = r;
					best = d;
				}
			}
		}
	}
	return best;
}

export function updateEnemies(w: World, dt: number): void {
	for (const e of w.entities) {
		if (e.kind !== 'enemy') continue;

		e.animT += dt;
		if (e.shieldT > 0) e.shieldT = Math.max(0, e.shieldT - dt);
		if (e.rechargeT !== undefined && e.rechargeT > 0) e.rechargeT -= dt;
		if (e.dead) continue;

		const def = w.enemyDefs[(e.enemyId ?? 1) - 1];
		const attack = def?.attack;
		// De eigen tegel telt niet als blokkade; anders zou een vijand zichzelf klemzetten.
		const blockers = occupancyGrid(w);
		const own = entityTile(e);
		const ownIdx = inBounds(w, own.tx, own.ty) ? own.ty * (w.width + 2) + own.tx : -1;
		if (ownIdx >= 0) blockers[ownIdx] = 0;

		// Contactschade: een vijand die een speler raakt doet meteen pijn.
		if (hasType(attack, 'contact')) checkContactDamage(w, e, attack);

		steer(w, e, def?.ai ?? 0, blockers, attack);

		const res = moveEntity(w, e, dt, blockers);
		if (res.blocked) {
			// Tegen een muur: de meeste routines keren om zodra dat gebeurt.
			e.distTravelled = Number.MAX_SAFE_INTEGER;
		}

		if (attack && !hasType(attack, 'contact')) tryShoot(w, e, attack);

		teleportStep(w, e, dt);
		if (ownIdx >= 0) blockers[ownIdx] = 1;
	}
}

function steer(
	w: World,
	e: Entity,
	ai: number,
	blockers: Uint8Array,
	attack: RawEnemyAttack | undefined,
): void {
	if (!e.moving) return;
	if (!nearGrid(e)) return;

	const cur = e.dir;
	const opp = opposite(cur);
	const blocked = !canGo(w, e, cur, blockers);

	switch (ai) {
		// ── 0: ai_random ──────────────────────────────────────────────
		// Dwaalt rond en kiest op elk kruispunt opnieuw, met een voorkeur om door te lopen.
		case 0: {
			if (!blocked) {
				if (e.distTravelled < TILE_SIZE) return;
				if (e.distTravelled < 2 * TILE_SIZE && randomInt(w.rng, 0, 10) <= 4) return;
			}
			const options: Direction[] = [];
			for (const d of DIRECTIONS) if (canGo(w, e, d, blockers)) options.push(d);
			const next =
				options.length === 0
					? DIRECTIONS[randomInt(w.rng, 0, 3)]!
					: options[randomInt(w.rng, 0, options.length - 1)]!;
			trySetDirection(e, next);
			return;
		}

		// ── 1: ai_random_forward ──────────────────────────────────────
		// Loopt door tot hij niet verder kan, dan een willekeurige andere kant op.
		case 1: {
			if (blocked) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
				return;
			}
			if (e.justWarped) {
				trySetDirection(e, selectRandomViable(w, e, opp, OPPOSITE_NOT_LAST_CHOICE, blockers));
				return;
			}
			if (e.distTravelled > TILE_SIZE / 2 || e.distTravelled === 0) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
			}
			return;
		}

		// ── 2: ai_random_forward_haunt (mean-o-taur) ──────────────────
		// Zet na een contactaanval koers naar de tegel waar hij toesloeg.
		case 2: {
			const hunting = (e.attackTileX ?? -1) > 0;
			if (hunting) {
				const here = entityTile(e);
				let dir: Direction = Dir.DOWN;
				if ((e.attackTileX ?? 0) < here.tx) dir = Dir.LEFT;
				else if ((e.attackTileX ?? 0) > here.tx) dir = Dir.RIGHT;
				else if ((e.attackTileY ?? 0) < here.ty) dir = Dir.UP;
				e.attackTileX = -1;
				trySetDirection(e, dir);
				return;
			}
			if (blocked) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
				return;
			}
			if (e.distTravelled > TILE_SIZE / 2 || e.distTravelled === 0) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
			}
			return;
		}

		// ── 3: ai_follow ──────────────────────────────────────────────
		// Als hij een speler in het vizier krijgt, gaat hij erop af.
		case 3: {
			if (blocked) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
				return;
			}
			const sp = seeingPlayer(w, e);
			if (sp !== Dir.NONE) {
				trySetDirection(e, sp);
				return;
			}
			if (e.justWarped) {
				trySetDirection(e, selectRandomViable(w, e, opp, OPPOSITE_NOT_LAST_CHOICE, blockers));
				return;
			}
			if (e.distTravelled > TILE_SIZE / 2 || e.distTravelled === 0) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
			}
			return;
		}

		// ── 4: ai_follow_dash (ghost) ─────────────────────────────────
		// Ziet hij je, dan zet hij een sprint in en blijft doorstormen tot hij ergens tegenaan komt.
		default: {
			if (blocked || e.justWarped) {
				e.dash = 0;
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
				return;
			}
			if (e.dash > 0) return;

			const sp = seeingPlayer(w, e, attack?.tileRange ?? 100);
			if (sp !== Dir.NONE) {
				if ((e.rechargeT ?? 0) <= 0 && !e.morphed) {
					e.dash = 3;
					e.rechargeT = 1 / (attack?.fireRate ?? 1);
					sound(w, `enemy${e.enemyId ?? 1}_attack.ogg`);
				}
				trySetDirection(e, sp);
				return;
			}
			if (e.distTravelled > TILE_SIZE / 2 || e.distTravelled === 0) {
				trySetDirection(e, selectRandomViable(w, e, opp, 0, blockers));
			}
			return;
		}
	}
}

function checkContactDamage(w: World, e: Entity, attack: RawEnemyAttack | undefined): void {
	if (e.morphed || (e.rechargeT ?? 0) > 0) return;
	for (const p of w.entities) {
		if (p.kind !== 'player' || p.dead || p.shieldT > 0) continue;
		if (manhattan(p.x, p.y, e.x, e.y) > 20) continue;

		hurtPlayer(w, p, attack?.contactDamage ?? 1);
		e.rechargeT = 1 / (attack?.fireRate ?? 1);
		sound(w, `enemy${e.enemyId ?? 1}_attack.ogg`);

		// Onthoud waar de speler stond; ai_random_forward_haunt jaagt daarop.
		const t = entityTile(p);
		e.attackTileX = t.tx;
		e.attackTileY = t.ty;
		return;
	}
}

function tryShoot(w: World, e: Entity, attack: RawEnemyAttack): void {
	if (e.morphed || (e.rechargeT ?? 0) > 0 || e.dir === Dir.NONE) return;

	const range = attack.tileRange !== undefined ? attack.tileRange : 100;
	const sp = seeingPlayer(w, e, range);
	// Alleen schieten in de richting waarin hij kijkt, net als Enemy::_checkShoot.
	if (sp !== e.dir) return;

	const bulletId = attack.id ?? 1;
	spawn(
		w,
		makeBullet(
			w,
			e.x,
			e.y,
			e.dir,
			bulletId,
			1,
			BULLET_BASE_SPEED,
			attack.tileRange !== undefined ? attack.tileRange * TILE_SIZE : -1,
		),
	);
	e.rechargeT = 1 / (attack.fireRate || 1);
	sound(w, `bullet${bulletId}_shot.ogg`);

	// AttackType BLOCKING: de vijand staat stil terwijl hij vuurt.
	if (hasType(attack, 'blocking')) e.blockedT = (attack.blockTime ?? 0) / 1000;
}

export function updateBullets(w: World, dt: number): void {
	for (const b of w.entities) {
		if (b.kind !== 'bullet' || b.dead) continue;

		b.animT += dt;
		const step = b.speed * dt;
		b.x += (b.vx ?? 0) * step;
		b.y += (b.vy ?? 0) * step;

		if (b.rangeLeft !== undefined && b.rangeLeft >= 0) {
			b.rangeLeft -= step;
			if (b.rangeLeft <= 0) {
				b.dead = true;
				continue;
			}
		}

		// Muren houden kogels tegen.
		const { tx, ty } = entityTile(b);
		if (isWall(w, tx, ty)) {
			b.dead = true;
			sound(w, `bullet${b.bulletData ?? 1}_hit.ogg`);
			continue;
		}

		for (const p of w.entities) {
			if (p.kind !== 'player' || p.dead) continue;
			if (manhattan(p.x, p.y, b.x, b.y) > 18) continue;
			hurtPlayer(w, p, b.damage ?? 1);
			b.dead = true;
			sound(w, `bullet${b.bulletData ?? 1}_hit.ogg`);
			break;
		}
	}
}

// ── Bosses ──────────────────────────────────────────────────────────────

/** src/lifish/conf/boss.hpp: de alien boss wisselt tussen wel en niet kunnen schieten. */
const ALIEN_BOSS = {
	CAN_SHOOT_INTERVAL: 1.2,
	CANNOT_SHOOT_INTERVAL: 2.4,
	SHOOT_SHORT_INTERVAL: 0.4,
	SIGHT_RADIUS: 9,
	SIZE_TILES: 3,
} as const;

const BIG_ALIEN_BOSS = {
	SIZE_TILES: 5,
	SHOOT_INTERVAL: 1.6,
} as const;

export function updateBosses(w: World, dt: number): void {
	for (const b of w.entities) {
		if (b.kind !== 'boss') continue;
		b.animT += dt;
		if (b.shieldT > 0) b.shieldT = Math.max(0, b.shieldT - dt);
		if (b.dead) continue;

		b.phaseT = (b.phaseT ?? 0) + dt;
		if (b.rechargeT !== undefined && b.rechargeT > 0) b.rechargeT -= dt;

		if (b.bossKind === 'alien') updateAlienBoss(w, b, dt);
		else updateBigAlienBoss(w, b, dt);

		// Een boss doet pijn bij aanraking.
		const size = (b.bossKind === 'alien' ? ALIEN_BOSS.SIZE_TILES : BIG_ALIEN_BOSS.SIZE_TILES) * TILE_SIZE;
		for (const p of w.entities) {
			if (p.kind !== 'player' || p.dead || p.shieldT > 0) continue;
			if (p.x + TILE_SIZE < b.x || p.x > b.x + size) continue;
			if (p.y + TILE_SIZE < b.y || p.y > b.y + size) continue;
			hurtPlayer(w, p, 2);
		}
	}
}

/** Staat stil en beschiet spelers die binnen zicht komen, in salvo's. */
function updateAlienBoss(w: World, b: Entity, _dt: number): void {
	const cycle = ALIEN_BOSS.CAN_SHOOT_INTERVAL + ALIEN_BOSS.CANNOT_SHOOT_INTERVAL;
	const inShootWindow = (b.phaseT ?? 0) % cycle < ALIEN_BOSS.CAN_SHOOT_INTERVAL;
	if (!inShootWindow || (b.rechargeT ?? 0) > 0) return;

	const center = { x: b.x + (ALIEN_BOSS.SIZE_TILES * TILE_SIZE) / 2, y: b.y + (ALIEN_BOSS.SIZE_TILES * TILE_SIZE) / 2 };
	let target: Entity | undefined;
	let bestDist = Infinity;
	for (const p of w.entities) {
		if (p.kind !== 'player' || p.dead) continue;
		const d = manhattan(p.x, p.y, center.x, center.y);
		if (d < bestDist) {
			bestDist = d;
			target = p;
		}
	}
	if (!target || bestDist > ALIEN_BOSS.SIGHT_RADIUS * TILE_SIZE) return;

	const angle = Math.atan2(target.y - center.y, target.x - center.x);
	spawn(w, makeBullet(w, center.x - 10, center.y - 10, angle, 101, 2, BULLET_BASE_SPEED * 1.2, -1, true));
	b.rechargeT = ALIEN_BOSS.SHOOT_SHORT_INTERVAL;
	sound(w, 'bullet101_shot.ogg');
}

/** Loopt rond over het speelveld en vuurt in vier richtingen tegelijk. */
function updateBigAlienBoss(w: World, b: Entity, dt: number): void {
	const size = BIG_ALIEN_BOSS.SIZE_TILES;

	// Botsingen zijn hier grof: de boss is 5x5 tegels en loopt gewoon over alles heen,
	// net als in het origineel, waar hij breekbare muren vernietigt door erover te lopen.
	b.x += (b.dir === Dir.LEFT ? -1 : b.dir === Dir.RIGHT ? 1 : 0) * b.speed * dt;
	b.y += (b.dir === Dir.UP ? -1 : b.dir === Dir.DOWN ? 1 : 0) * b.speed * dt;

	const minX = TILE_SIZE;
	const minY = TILE_SIZE;
	const maxX = (w.width + 1 - size) * TILE_SIZE;
	const maxY = (w.height + 1 - size) * TILE_SIZE;

	if (b.x <= minX || b.x >= maxX || b.y <= minY || b.y >= maxY) {
		b.x = Math.min(maxX, Math.max(minX, b.x));
		b.y = Math.min(maxY, Math.max(minY, b.y));
		b.dir = DIRECTIONS[randomInt(w.rng, 0, 3)]!;
	}

	// Muren onder de boss worden verpulverd.
	const t = entityTile(b);
	for (let dy = 0; dy < size; ++dy) {
		for (let dx = 0; dx < size; ++dx) {
			const tx = t.tx + dx;
			const ty = t.ty + dy;
			if (!inBounds(w, tx, ty)) continue;
			const idx = ty * (w.width + 2) + tx;
			if (w.breakable[idx] === 1) {
				w.breakable[idx] = 0;
				const wall = w.entities.find(
					(e) => e.kind === 'breakable' && !e.dead && e.tx === tx && e.ty === ty,
				);
				if (wall) {
					wall.dead = true;
					wall.deadT = 0;
				}
			}
		}
	}

	if ((b.rechargeT ?? 0) > 0) return;
	const cx = b.x + (size * TILE_SIZE) / 2 - 10;
	const cy = b.y + (size * TILE_SIZE) / 2 - 10;
	for (const d of DIRECTIONS) {
		spawn(w, makeBullet(w, cx, cy, d, 101, 2, BULLET_BASE_SPEED * 1.1, -1));
	}
	b.rechargeT = BIG_ALIEN_BOSS.SHOOT_INTERVAL;
	sound(w, 'bullet101_shot.ogg');
}
