/**
 * Bommen, explosies, schade en bonussen.
 *
 * De propagatieregel komt uit src/lifish/entities/Explosion.cpp: de vlam loopt per richting
 * door tot hij een muur raakt. Een breekbare muur die de vlam tegenhoudt gaat wél kapot maar
 * krijgt géén vlam getekend — vandaar dat `reach` alleen de vrije tegels telt en de muur
 * apart afgehandeld wordt.
 */

import { bomb as BOMB, bonus as BONUS, player as PLAYER } from './constants.js';
import { Dir, versor } from './direction.js';
import { entityTile, gridIndex, inBounds, isBreakable, isFixed } from './grid.js';
import { randomInt, weightedIndex } from './rng.js';
import { SCORE, addScore, addScoreToAll, sound } from './events.js';
import { makeBonus, makeExplosion, makeLetter, spawn } from './entities.js';
import { hurtPlayer } from './players.js';
import { BONUS_WEIGHTS, BonusType, type BonusKind, type Entity, type World } from './types.js';

/** Zeven animatieframes van 0,05 s. src/lifish/entities/Explosion.cpp:57 */
const EXPLOSION_LIFETIME = 0.35;
/** De colliders gaan twee frames eerder uit dan de animatie. */
const EXPLOSION_DAMAGE_TIME = 0.25;
/** Een aangestoken bom gaat vrijwel meteen af. Bomb::ignite() */
const IGNITED_FUSE = 0.05;

export function updateCombat(w: World, dt: number): void {
	for (const e of w.entities) {
		if (e.kind !== 'bomb' || e.dead) continue;
		e.fuseT = (e.fuseT ?? 0) + dt;
		if (e.fuseT >= (e.fuseTime ?? BOMB.DEFAULT_FUSE)) detonate(w, e);
	}

	for (const e of w.entities) {
		if (e.kind !== 'bonus' || e.dead) continue;
		e.t = (e.t ?? 0) + dt;
		if (e.t >= BONUS.EXPIRE_TIME) e.dead = true;
	}

}

function detonate(w: World, bombEnt: Entity): void {
	bombEnt.dead = true;
	const tx = bombEnt.tx ?? 0;
	const ty = bombEnt.ty ?? 0;
	const radius = bombEnt.radius ?? BOMB.DEFAULT_RADIUS;

	const reach: [number, number, number, number] = [0, 0, 0, 0];
	const blockingWalls: { tx: number; ty: number }[] = [];

	for (const dir of [Dir.UP, Dir.LEFT, Dir.DOWN, Dir.RIGHT] as const) {
		const [dx, dy] = versor(dir);
		for (let r = 1; r <= radius; ++r) {
			const nx = tx + dx * r;
			const ny = ty + dy * r;
			if (!inBounds(w, nx, ny) || isFixed(w, nx, ny)) break;
			if (isBreakable(w, nx, ny)) {
				blockingWalls.push({ tx: nx, ty: ny });
				break;
			}
			reach[dir]++;
		}
	}

	const expl = spawn(w, makeExplosion(w, tx, ty, reach, bombEnt.ownerId ?? 1));
	expl.damagedIds = [];

	for (const wall of blockingWalls) destroyBreakable(w, wall.tx, wall.ty, bombEnt.ownerId ?? 1);

	sound(w, 'explosion.ogg');
}

/** Alle tegels waar deze explosie schade doet. */
function explosionTiles(e: Entity): { tx: number; ty: number }[] {
	const tiles = [{ tx: e.tx ?? 0, ty: e.ty ?? 0 }];
	const reach = e.reach ?? [0, 0, 0, 0];
	for (const dir of [Dir.UP, Dir.LEFT, Dir.DOWN, Dir.RIGHT] as const) {
		const [dx, dy] = versor(dir);
		for (let r = 1; r <= reach[dir]; ++r) {
			tiles.push({ tx: (e.tx ?? 0) + dx * r, ty: (e.ty ?? 0) + dy * r });
		}
	}
	return tiles;
}

export function updateExplosions(w: World, dt: number): void {
	for (const expl of w.entities) {
		if (expl.kind !== 'explosion' || expl.dead) continue;

		expl.t = (expl.t ?? 0) + dt;
		expl.animT = expl.t;

		if (expl.t >= EXPLOSION_LIFETIME) {
			expl.dead = true;
			continue;
		}
		if (expl.t > EXPLOSION_DAMAGE_TIME) continue;

		const tiles = explosionTiles(expl);
		const hit = expl.damagedIds ?? (expl.damagedIds = []);

		for (const target of w.entities) {
			if (target.dead || hit.includes(target.id)) continue;

			const { tx, ty } = entityTile(target);
			if (!tiles.some((t) => t.tx === tx && t.ty === ty)) continue;

			switch (target.kind) {
				case 'player':
					hit.push(target.id);
					hurtPlayer(w, target, BOMB.EXPL_DAMAGE);
					break;

				case 'enemy':
					hit.push(target.id);
					killEnemy(w, target, expl.ownerId ?? 1);
					break;

				case 'boss':
					hit.push(target.id);
					damageBoss(w, target, BOMB.EXPL_DAMAGE, expl.ownerId ?? 1);
					break;

				case 'bomb':
					// Kettingreactie: de geraakte bom krijgt een heel korte lont.
					hit.push(target.id);
					target.fuseTime = IGNITED_FUSE;
					target.fuseT = 0;
					break;

				case 'bonus':
					// Een bonus die in de vlam ligt verdwijnt.
					hit.push(target.id);
					target.dead = true;
					break;

				default:
					break;
			}
		}
	}
}

export function destroyBreakable(w: World, tx: number, ty: number, byPlayer: number): void {
	const wall = w.entities.find(
		(e) => e.kind === 'breakable' && !e.dead && e.tx === tx && e.ty === ty,
	);
	if (!wall) return;

	wall.dead = true;
	wall.deadT = 0;
	// Meteen uit het botsingsraster halen; de sloopanimatie loopt daarna nog even door.
	w.breakable[gridIndex(w, tx, ty)] = 0;
	addScore(w, byPlayer, SCORE.BREAKABLE, wall.x, wall.y);

	const roll = weightedIndex(w.rng, BONUS_WEIGHTS as unknown as number[]);
	if (roll < BONUS.N_BONUS_TYPES) {
		spawn(w, makeBonus(w, tx, ty, roll as BonusKind));
	}
}

export function killEnemy(w: World, enemy: Entity, byPlayer: number): void {
	if (enemy.dead) return;
	enemy.hp = 0;
	enemy.dead = true;
	enemy.deadT = 0;
	enemy.moving = false;
	enemy.dir = Dir.NONE;

	addScore(w, byPlayer, SCORE.enemy(enemy.enemyId ?? 1), enemy.x, enemy.y);
	sound(w, enemy.morphed ? 'alien_death.ogg' : `enemy${enemy.enemyId ?? 1}_death.ogg`);

	// In de extra game laat een gemorfde vijand een EXTRA-letter vallen.
	if (enemy.morphed) {
		spawn(w, makeLetter(w, enemy.x, enemy.y, randomInt(w.rng, 0, 4)));
	}
}

function damageBoss(w: World, boss: Entity, damage: number, byPlayer: number): void {
	if (boss.dead || boss.shieldT > 0) return;
	boss.hp -= damage;
	boss.shieldT = 0.4;
	if (boss.hp <= 0) {
		boss.hp = 0;
		boss.dead = true;
		boss.deadT = 0;
		boss.moving = false;
		const value = boss.bossKind === 'bigAlien' ? SCORE.BIG_ALIEN_BOSS : SCORE.ALIEN_BOSS;
		addScore(w, byPlayer, value, boss.x, boss.y);
		sound(w, boss.bossKind === 'bigAlien' ? 'big_alien_boss_death.ogg' : 'alienboss_death.ogg');
	} else {
		sound(w, boss.bossKind === 'bigAlien' ? 'big_alien_boss_hurt.ogg' : 'alienboss_hurt.ogg');
	}
}

/** Transcriptie van lif::triggerBonus (src/lifish/bonus_type.cpp:42). */
export function applyBonus(w: World, player: Entity, kind: BonusKind): void {
	const ps = w.players[(player.playerId ?? 1) - 1];
	if (!ps) return;
	const powers = ps.powers;

	switch (kind) {
		case BonusType.MAX_BOMBS:
			if (powers.maxBombs < PLAYER.MAX_MAX_BOMBS) powers.maxBombs++;
			break;

		case BonusType.QUICK_FUSE:
			if (powers.bombFuseTime === BOMB.DEFAULT_FUSE) {
				powers.bombFuseTime = BOMB.QUICK_FUSE;
				// Ook de bommen die al liggen worden sneller.
				for (const b of w.entities)
					if (b.kind === 'bomb' && !b.dead && b.ownerId === player.playerId)
						b.fuseTime = BOMB.QUICK_FUSE;
			}
			break;

		case BonusType.MAX_RANGE:
			if (powers.bombRadius < BOMB.MAX_RADIUS) {
				powers.bombRadius++;
				for (const b of w.entities)
					if (b.kind === 'bomb' && !b.dead && b.ownerId === player.playerId)
						b.radius = powers.bombRadius;
			}
			break;

		case BonusType.SHIELD:
			player.shieldT = BONUS.SHIELD_DURATION;
			break;

		case BonusType.SPEEDY:
			player.dash = 2;
			player.shieldT = Math.max(player.shieldT, 0);
			// De duur wordt bijgehouden op de speler; zie updateSpeedy hieronder.
			player.phaseT = BONUS.SPEEDY_DURATION;
			break;

		case BonusType.ZAPPER:
			// Alle breekbare muren tegelijk slopen, punten naar iedereen.
			for (const e of [...w.entities]) {
				if (e.kind !== 'breakable' || e.dead) continue;
				e.dead = true;
				e.deadT = 0;
				if (e.tx !== undefined && e.ty !== undefined)
					w.breakable[gridIndex(w, e.tx, e.ty)] = 0;
				addScoreToAll(w, SCORE.BREAKABLE, e.x, e.y);
			}
			break;

		case BonusType.SUDDEN_DEATH:
			for (const e of [...w.entities]) {
				if (e.kind !== 'enemy' || e.dead) continue;
				killEnemy(w, e, player.playerId ?? 1);
			}
			break;

		case BonusType.HEALTH_FULL:
			player.hp = PLAYER.MAX_LIFE;
			break;

		case BonusType.HEALTH_SMALL:
			player.hp = Math.min(PLAYER.MAX_LIFE, player.hp + 2);
			break;

		default:
			break;
	}
	ps.life = player.hp;
}

/** Telt de speedy-bonus af. Apart omdat hij op de speler-entity leeft, niet op de bonus. */
export function updateSpeedy(w: World, dt: number): void {
	for (const e of w.entities) {
		if (e.kind !== 'player' || e.dash <= 0) continue;
		e.phaseT = (e.phaseT ?? 0) - dt;
		if (e.phaseT <= 0) e.dash = 0;
	}
}
