/**
 * De wereld: opbouw uit een level, en de tick die alles vooruit zet.
 *
 * De update-volgorde is die van het origineel (BaseLevelManager::update gevolgd door de
 * game_logic-functies): eerst invoer en beweging, dan wapens, dan bommen en explosies, dan
 * oprapen, dan opruimen en tot slot de wincondities.
 */

import {
	DT,
	EXTRA_GAME_DURATION,
	bomb as BOMB,
	enemy as ENEMY,
	player as PLAYER,
} from './constants.js';
import { Dir } from './direction.js';
import { gridIndex } from './grid.js';
import { makeRng } from './rng.js';
import { Tile, tileToPixel } from './tiles.js';
import type { Level, LevelSet } from './levelset.js';
import { defaultPowers, type Entity, type PlayerState, type World } from './types.js';
import { emit } from './events.js';
import {
	makeBoss,
	makeBreakable,
	makeCoin,
	makeEnemy,
	makePlayer,
	makeTeleport,
	spawn,
} from './entities.js';
import { updateCombat, updateExplosions, updateSpeedy } from './combat.js';
import { updateEnemies, updateBosses, updateBullets } from './ai.js';
import { updatePlayers } from './players.js';
import { clearWarpFlags } from './teleport.js';
import type { PlayerInput } from './types.js';

/** Bij hoeveel resterende seconden de klok gaat waarschuwen en daarna versnelt. */
const HURRY_UP_WARN_AT = 60;
const HURRY_UP_AT = 30;

export function newPlayerState(id: number, present: boolean): PlayerState {
	return {
		id,
		score: 0,
		// src/lifish/entities/Player.hpp:32 — het leven waarmee je speelt telt mee, dus
		// INITIAL_LIVES van 3 betekent er twee in reserve.
		remainingLives: PLAYER.INITIAL_LIVES - 1,
		continues: PLAYER.INITIAL_CONTINUES,
		letters: [false, false, false, false, false],
		powers: defaultPowers(),
		life: PLAYER.MAX_LIFE,
		out: false,
		present,
	};
}

export interface WorldOptions {
	seed: number;
}

export function createWorld(
	levelSet: LevelSet,
	levelNum: number,
	players: PlayerState[],
	opts: WorldOptions,
): World {
	const level = levelSet.levels.find((l) => l.num === levelNum) ?? levelSet.levels[0]!;

	const w: World = {
		tick: 0,
		levelNum: level.num,
		width: level.width,
		height: level.height,
		tileIDs: level.tileIDs,
		fixed: new Uint8Array((level.width + 2) * (level.height + 2)),
		breakable: new Uint8Array((level.width + 2) * (level.height + 2)),
		entities: [],
		nextId: 1,
		rng: makeRng(opts.seed),
		timeLeft: level.time,
		hurryUp: false,
		hurryUpWarned: false,
		extraGame: false,
		extraGameTriggered: false,
		extraGameT: 0,
		players,
		enemyDefs: levelSet.enemies,
		status: 'playing',
		hadCoins: false,
		clearedT: 0,
		events: [],
	};

	// De border is één tegel dik en altijd massief.
	for (let tx = 0; tx < w.width + 2; ++tx) {
		w.fixed[gridIndex(w, tx, 0)] = 1;
		w.fixed[gridIndex(w, tx, w.height + 1)] = 1;
	}
	for (let ty = 0; ty < w.height + 2; ++ty) {
		w.fixed[gridIndex(w, 0, ty)] = 1;
		w.fixed[gridIndex(w, w.width + 1, ty)] = 1;
	}

	loadTiles(w, level);

	// Zeven levels (10, 20, 30 ... 70) hebben helemaal geen munten. Zonder deze vlag is
	// "alle munten weg" daar vanaf de eerste tick waar en brandt de extra game op voordat
	// de speler een toets heeft aangeraakt. Het origineel kent dat probleem ook
	// (LevelManager::_shouldTriggerExtraGame kijkt alleen of er munten liggen); dit is een
	// bewuste afwijking, want een bonusronde die begint voordat het level begint is niet
	// wat er bedoeld kan zijn.
	w.hadCoins = w.entities.some((e) => e.kind === 'coin');

	return w;
}

/**
 * Wie er spawnt, hangt af van `PlayerState.present` en niet van een aantal. Dat verschil doet
 * ertoe zodra iemand halverwege een potje meedoet of eruit stapt: dan is de bezetting niet
 * meer "de eerste N", maar bijvoorbeeld speler 1 en 3.
 */
function loadTiles(w: World, level: Level): void {
	for (let top = 0; top < level.height; ++top) {
		for (let left = 0; left < level.width; ++left) {
			const cell = level.cells[top * level.width + left];
			if (!cell) continue;
			const { x, y } = tileToPixel(left, top);
			const tx = left + 1;
			const ty = top + 1;

			switch (cell.kind) {
				case Tile.FIXED:
					w.fixed[gridIndex(w, tx, ty)] = 1;
					break;
				case Tile.BREAKABLE:
					w.breakable[gridIndex(w, tx, ty)] = 1;
					spawn(w, makeBreakable(w, tx, ty));
					break;
				case Tile.COIN:
					spawn(w, makeCoin(w, tx, ty));
					break;
				case Tile.TELEPORT:
					spawn(w, makeTeleport(w, tx, ty));
					break;
				case Tile.PLAYER1:
					spawnPlayerAt(w, 1, x, y);
					break;
				case Tile.PLAYER2:
					spawnPlayerAt(w, 2, x, y);
					break;
				case Tile.PLAYER3:
					spawnPlayerAt(w, 3, x, y);
					break;
				case Tile.PLAYER4:
					spawnPlayerAt(w, 4, x, y);
					break;
				case Tile.ENEMY:
					spawn(w, makeEnemy(w, cell.enemyId, x, y));
					break;
				case Tile.ALIEN_BOSS:
					spawn(w, makeBoss(w, 'alien', tx, ty));
					break;
				case Tile.BIG_ALIEN_BOSS:
					spawn(w, makeBoss(w, 'bigAlien', tx, ty));
					break;
				default:
					break;
			}
		}
	}
}

function spawnPlayerAt(w: World, playerId: number, x: number, y: number): void {
	const ps = w.players[playerId - 1];
	if (!ps || ps.out || !ps.present) return;
	const p = spawn(w, makePlayer(w, playerId, x, y));
	p.hp = ps.life > 0 ? ps.life : PLAYER.MAX_LIFE;
	// Kort onkwetsbaar bij de start van een level, zodat je niet meteen in een vijand loopt.
	p.shieldT = PLAYER.RESURRECT_SHIELD_TIME;
	w.events.push({ t: 'fx', name: 'flash', x, y });
}

export function playersAlive(w: World): Entity[] {
	return w.entities.filter((e) => e.kind === 'player' && !e.dead);
}

export function findPlayerEntity(w: World, playerId: number): Entity | undefined {
	return w.entities.find((e) => e.kind === 'player' && e.playerId === playerId);
}

/** Eén simulatiestap. `inputs` is geïndexeerd op speler-id (1-based → index 0 en 1). */
/**
 * Hoe lang je na het laatste vijandje nog rond mag lopen. Het origineel wacht vier seconden
 * voordat het naar het tussenscherm gaat (WinLoseHandler::_handleWin) — juist genoeg om de
 * letter op te rapen die dat laatste vijandje liet vallen.
 */
export const LEVEL_CLEAR_GRACE = 4;

/** Hoe lang een opgeraapte munt blijft liggen om zijn draai te laten zien. */
export const COIN_GRAB_TIME = 0.6;

export function update(w: World, inputs: (PlayerInput | undefined)[], dt = DT): void {
	w.events.length = 0;
	// Bij 'cleared' loopt de wereld gewoon door: je kunt nog lopen en oprapen.
	if (w.status === 'retry' || w.status === 'gameover') return;

	w.tick++;
	if (w.status === 'cleared') w.clearedT += dt;

	// Animatieklok op één plek. Stond dit per systeem, dan animeerden munten en teleports
	// niet omdat ze in geen enkel systeem langskwamen — precies wat er gebeurd was.
	for (const e of w.entities) e.animT += dt;

	updateClock(w, dt);
	updateSpeedy(w, dt);
	updatePlayers(w, inputs, dt);
	updateEnemies(w, dt);
	updateBosses(w, dt);
	updateBullets(w, dt);
	updateCombat(w, dt);
	updateExplosions(w, dt);
	clearWarpFlags(w);
	cleanup(w);
	if (w.status === 'playing') checkConditions(w);
}

function updateClock(w: World, dt: number): void {
	if (w.timeLeft > 0) {
		w.timeLeft = Math.max(0, w.timeLeft - dt);
	}

	if (!w.hurryUpWarned && w.timeLeft <= HURRY_UP_WARN_AT) {
		w.hurryUpWarned = true;
		emit(w, { t: 'text', name: 'hurryUp' });
		emit(w, { t: 'sound', name: 'hurryup.ogg' });
	} else if (!w.hurryUp && w.timeLeft <= HURRY_UP_AT) {
		triggerHurryUp(w);
	}

	if (w.extraGame) {
		w.extraGameT -= dt;
		if (w.extraGameT <= 0) endExtraGame(w);
	} else if (!w.extraGameTriggered && w.hadCoins && noCoinsLeft(w)) {
		triggerExtraGame(w);
	}
}

/** Transcriptie van LevelManager::_triggerHurryUp: vijanden verdubbelen in tempo en vuurkracht. */
function triggerHurryUp(w: World): void {
	w.hurryUp = true;
	for (const e of w.entities) {
		if (e.kind === 'enemy') {
			const def = w.enemyDefs[(e.enemyId ?? 1) - 1];
			e.speed = ENEMY.BASE_SPEED * (def?.speed ?? 1) * 2;
		} else if (e.kind === 'boss') {
			e.speed *= 1.5;
		}
	}
}

function noCoinsLeft(w: World): boolean {
	return !w.entities.some((e) => e.kind === 'coin' && !e.dead);
}

function triggerExtraGame(w: World): void {
	w.extraGame = true;
	w.extraGameTriggered = true;
	w.extraGameT = EXTRA_GAME_DURATION;
	for (const e of w.entities) if (e.kind === 'enemy' && !e.dead) e.morphed = true;
	emit(w, { t: 'text', name: 'extraGame' });
	emit(w, { t: 'sound', name: 'extragame.ogg' });
}

function endExtraGame(w: World): void {
	w.extraGame = false;
	for (const e of w.entities) {
		// Een alien die al ligt te sterven blijft een alien; anders wisselt hij halverwege
		// zijn doodsanimatie terug naar het beestje dat hij ooit was.
		if (e.kind === 'enemy' && !e.dead) e.morphed = false;
		else if (e.kind === 'letter' && !e.dead) e.dead = true;
	}
}

/** Verwijdert entities die hun doodsanimatie hebben uitgespeeld. */
function cleanup(w: World): void {
	let write = 0;
	for (let read = 0; read < w.entities.length; ++read) {
		const e = w.entities[read]!;
		if (e.dead) {
			e.deadT += DT;
			const linger = deathLinger(e);
			if (e.deadT >= linger) {
				if (e.kind === 'breakable' && e.tx !== undefined && e.ty !== undefined)
					w.breakable[gridIndex(w, e.tx, e.ty)] = 0;
				continue;
			}
		}
		w.entities[write++] = e;
	}
	w.entities.length = write;
}

function deathLinger(e: Entity): number {
	switch (e.kind) {
		case 'enemy':
			return ENEMY.DEATH_TIME;
		case 'boss':
			return 4;
		case 'player':
			return PLAYER.DEATH_TIME;
		case 'breakable':
			// Vier frames sloopanimatie op 0,08 s.
			return 0.32;
		case 'coin':
			// Blijft na het oppakken nog even liggen om zijn draai af te maken. Het origineel
			// houdt hem drie seconden aan (Coin.cpp:20), maar een munt die nog ronddraait
			// terwijl je al weg bent leest als een fout; drie omwentelingen is genoeg.
			return COIN_GRAB_TIME;
		case 'explosion':
			return 0;
		default:
			return 0.2;
	}
}

function checkConditions(w: World): void {
	// Dode spelers herrijzen zolang ze levens hebben.
	let living = 0;
	for (const ps of w.players) {
		if (!ps.present || ps.out) continue;
		const ent = findPlayerEntity(w, ps.id);
		if (!ent) continue;
		if (ent.dead && ent.deadT >= PLAYER.DEATH_TIME * 0.6) {
			if (ps.remainingLives > 0) {
				ps.remainingLives--;
				ps.life = PLAYER.MAX_LIFE;
				ent.dead = false;
				ent.deadT = 0;
				ent.hp = PLAYER.MAX_LIFE;
				ent.shieldT = PLAYER.RESURRECT_SHIELD_TIME;
				ent.dir = Dir.NONE;
				ent.facing = Dir.DOWN;
				ent.moving = false;
				living++;
			} else {
				ps.out = true;
			}
		} else if (!ent.dead) {
			living++;
		}
	}

	if (living === 0) {
		const anyContinues = w.players.some((p) => p.present && p.continues > 0);
		w.status = anyContinues ? 'retry' : 'gameover';
		emit(w, { t: 'text', name: 'gameOver' });
		emit(w, { t: 'sound', name: 'gameover.ogg' });
		return;
	}

	// Level gehaald zodra er geen vijandige entities meer leven.
	const foes = w.entities.some((e) => (e.kind === 'enemy' || e.kind === 'boss') && !e.dead);
	if (!foes) {
		w.status = 'cleared';
		w.clearedT = 0;
		emit(w, { t: 'text', name: 'levelClear' });
		emit(w, { t: 'sound', name: 'levelclear.ogg' });
	}

	// Tijd op is in BOOM geen game over: de klok blijft op nul staan en de hurry-up maakt
	// het level vanzelf moordend. Zo laten.
}
