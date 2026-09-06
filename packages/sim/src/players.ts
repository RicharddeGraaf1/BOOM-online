/**
 * Spelers: invoer, bommen leggen, oprapen, teleporteren.
 */

import { player as PLAYER } from './constants.js';
import { Dir, type Direction } from './direction.js';
import { entityTile, manhattan } from './grid.js';
import { moveEntity, trySetDirection } from './movement.js';
import { SCORE, addScore, sound } from './events.js';
import { makeBomb, spawn } from './entities.js';
import { applyBonus } from './combat.js';
import { teleportStep } from './teleport.js';
import { defaultPowers, type Entity, type PlayerInput, type World } from './types.js';

/** Hoe dicht twee 32x32-entities op elkaar moeten staan om als "aanraking" te tellen. */
const PICKUP_DIST = 20;

function inputDirection(input: PlayerInput): Direction {
	// Bij twee tegelijk ingedrukte richtingen wint de laatst genoemde, net als in het
	// origineel waar de eventvolgorde bepaalt wie er wint.
	if (input.up) return Dir.UP;
	if (input.down) return Dir.DOWN;
	if (input.left) return Dir.LEFT;
	if (input.right) return Dir.RIGHT;
	return Dir.NONE;
}

export function updatePlayers(w: World, inputs: (PlayerInput | undefined)[], dt: number): void {
	for (const e of w.entities) {
		if (e.kind !== 'player') continue;

		e.animT += dt;
		if (e.shieldT > 0) e.shieldT = Math.max(0, e.shieldT - dt);

		if (e.dead) continue;

		const ps = w.players[(e.playerId ?? 1) - 1];
		const input = inputs[(e.playerId ?? 1) - 1];

		// Speedy-bonus: het origineel zet dash op 2 zolang de bonus loopt.
		const speedy = (e.dash ?? 0) > 0;
		e.speed = PLAYER.DEFAULT_SPEED;
		e.dash = speedy ? 2 : 0;

		if (input) {
			const want = inputDirection(input);
			if (want === Dir.NONE) {
				e.moving = false;
			} else {
				if (!trySetDirection(e, want)) {
					// Richtingwissel geweigerd omdat we niet uitgelijnd staan: gewoon doorlopen.
					e.moving = true;
				} else {
					e.moving = true;
				}
			}
			if (input.bomb && ps) tryDeployBomb(w, e, ps.powers);
		} else {
			e.moving = false;
		}

		moveEntity(w, e, dt);
		teleportStep(w, e, dt);
		handlePickups(w, e);

		if (ps) ps.life = e.hp;
	}
}

function tryDeployBomb(
	w: World,
	player: Entity,
	powers: { maxBombs: number; bombRadius: number; bombFuseTime: number },
): void {
	const { tx, ty } = entityTile(player);

	let mine = 0;
	for (const b of w.entities) {
		if (b.kind !== 'bomb' || b.dead) continue;
		if (b.ownerId === player.playerId) mine++;
		if (b.tx === tx && b.ty === ty) return; // hier ligt er al een
	}
	if (mine >= powers.maxBombs) return;

	spawn(w, makeBomb(w, tx, ty, player.playerId ?? 1, powers.bombFuseTime, powers.bombRadius));
	sound(w, 'fuse.ogg');
}

function handlePickups(w: World, player: Entity): void {
	const ps = w.players[(player.playerId ?? 1) - 1];
	if (!ps) return;

	for (const e of w.entities) {
		if (e.dead) continue;
		if (manhattan(e.x, e.y, player.x, player.y) > PICKUP_DIST) continue;

		switch (e.kind) {
			case 'bonus':
				e.dead = true;
				applyBonus(w, player, e.bonus ?? 0);
				addScore(w, player.playerId ?? 1, SCORE.BONUS, e.x, e.y);
				sound(w, 'bonus_grab.ogg');
				break;

			case 'coin':
				e.dead = true;
				addScore(w, player.playerId ?? 1, SCORE.COIN, e.x, e.y);
				sound(w, 'coin.ogg');
				break;

			case 'letter': {
				e.dead = true;
				const idx = e.letter ?? 0;
				ps.letters[idx] = true;
				addScore(w, player.playerId ?? 1, SCORE.LETTER, e.x, e.y);
				sound(w, 'letter.ogg');
				if (ps.letters.every(Boolean)) {
					ps.letters = [false, false, false, false, false];
					ps.remainingLives++;
					sound(w, 'extra_life.ogg');
				}
				break;
			}

			default:
				break;
		}
	}
}

/** Brengt schade toe aan een speler, tenzij die een schild heeft. */
export function hurtPlayer(w: World, player: Entity, damage: number): void {
	if (player.dead || player.shieldT > 0) return;
	player.hp -= damage;
	if (player.hp <= 0) {
		player.hp = 0;
		player.dead = true;
		player.deadT = 0;
		player.moving = false;
		player.dir = Dir.NONE;
		player.dash = 0;

		// Bij sterven raak je je opgeraapte krachten kwijt, maar niet je EXTRA-letters.
		// src/lifish/entities/Player.cpp:157-161 (`info.reset(false)`).
		const ps = w.players[(player.playerId ?? 1) - 1];
		if (ps) ps.powers = defaultPowers();

		sound(w, `player${player.playerId ?? 1}_death.ogg`);
	} else {
		player.shieldT = PLAYER.DAMAGE_SHIELD_TIME;
		sound(w, `player${player.playerId ?? 1}_hurt.ogg`);
	}
}

/** Voor de HUD: het aantal bommen dat deze speler nog kan leggen. */
export function bombsAvailable(w: World, playerId: number): number {
	const ps = w.players[playerId - 1];
	if (!ps) return 0;
	let used = 0;
	for (const b of w.entities) if (b.kind === 'bomb' && !b.dead && b.ownerId === playerId) used++;
	return Math.max(0, ps.powers.maxBombs - used);
}
