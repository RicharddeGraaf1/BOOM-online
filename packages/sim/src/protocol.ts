/**
 * Het netwerkprotocol.
 *
 * Model: de server is autoritatief. Clients sturen alléén invoer; de server rekent de wereld
 * uit en stuurt 20x per seconde een snapshot. De client simuleert intussen zelf door op 60 Hz
 * (prediction) en corrigeert op elke snapshot.
 *
 * Een snapshot bevat de hele entitylijst. Dat mag: een level heeft rond de 50 entities, dus
 * een snapshot is ongeveer een kilobyte. Delta-compressie zou hier alleen complexiteit
 * toevoegen aan iets dat al ruim onder de bandbreedte zit.
 */

import type { Entity, GameEvent, PlayerInput, PlayerState, World, WorldStatus } from './types.js';
import type { LevelSetVariant } from './game.js';

export const SNAPSHOT_HZ = 20;
export const PROTOCOL_VERSION = 1;

// ── Client → server ─────────────────────────────────────────────────────

export type ClientMessage =
	| { t: 'hello'; version: number; room: string; name: string }
	| { t: 'input'; tick: number; input: PlayerInput }
	| { t: 'ready' }
	| { t: 'start'; nPlayers: number };

// ── Server → client ─────────────────────────────────────────────────────

export interface LobbyMember {
	playerId: number;
	name: string;
	ready: boolean;
}

export interface WorldMeta {
	tick: number;
	levelNum: number;
	timeLeft: number;
	status: WorldStatus;
	hurryUp: boolean;
	extraGame: boolean;
	extraGameT: number;
}

export interface Snapshot {
	meta: WorldMeta;
	entities: Entity[];
	players: PlayerState[];
	events: GameEvent[];
}

export type ServerMessage =
	| { t: 'welcome'; playerId: number; room: string; version: number }
	| { t: 'lobby'; members: LobbyMember[]; host: number }
	| {
			t: 'level';
			levelNum: number;
			seed: number;
			nPlayers: number;
			players: PlayerState[];
			/** Welke levelset de server speelt; de client moet dezelfde nemen of het loopt uiteen. */
			variant: LevelSetVariant;
	  }
	| { t: 'snap'; snap: Snapshot }
	| { t: 'error'; message: string };

// ── Snapshots ───────────────────────────────────────────────────────────

export function takeSnapshot(w: World): Snapshot {
	return {
		meta: {
			tick: w.tick,
			levelNum: w.levelNum,
			timeLeft: w.timeLeft,
			status: w.status,
			hurryUp: w.hurryUp,
			extraGame: w.extraGame,
			extraGameT: w.extraGameT,
		},
		// Structured clone: de ontvanger mag deze objecten muteren zonder de bron te raken.
		entities: w.entities.map((e) => ({ ...e })),
		players: w.players.map((p) => ({ ...p, letters: [...p.letters] as PlayerState['letters'] })),
		events: [...w.events],
	};
}

/**
 * Zet de wereld terug op wat de server zegt.
 *
 * De muurrasters gaan bewust niet mee: die veranderen alleen als een breekbare muur sneuvelt,
 * en dat leiden we hier af uit de entitylijst. Scheelt elke snapshot een paar honderd bytes.
 */
export function applySnapshot(w: World, snap: Snapshot): void {
	w.tick = snap.meta.tick;
	w.levelNum = snap.meta.levelNum;
	w.timeLeft = snap.meta.timeLeft;
	w.status = snap.meta.status;
	w.hurryUp = snap.meta.hurryUp;
	w.extraGame = snap.meta.extraGame;
	w.extraGameT = snap.meta.extraGameT;

	w.entities = snap.entities.map((e) => ({ ...e }));
	w.players = snap.players.map((p) => ({ ...p, letters: [...p.letters] as PlayerState['letters'] }));
	w.events = [...snap.events];

	// Muurraster opnieuw opbouwen uit de levende breekbare muren.
	w.breakable.fill(0);
	for (const e of w.entities) {
		if (e.kind !== 'breakable' || e.dead) continue;
		if (e.tx === undefined || e.ty === undefined) continue;
		w.breakable[e.ty * (w.width + 2) + e.tx] = 1;
	}
}

/**
 * Verzacht de correctie voor de eigen speler.
 *
 * Zonder dit springt je poppetje bij elke snapshot terug naar waar de server hem zag, wat bij
 * 20 Hz zichtbaar schokt. Bij kleine afwijkingen houden we de voorspelde positie aan; pas
 * boven een halve tegel geeft de client toe. De server blijft de baas — dit stelt de
 * correctie alleen uit tot ze onvermijdelijk is.
 */
export const RECONCILE_THRESHOLD = 16;

export function reconcileLocalPlayer(
	predicted: Entity | undefined,
	authoritative: Entity | undefined,
): void {
	if (!predicted || !authoritative) return;
	const dx = authoritative.x - predicted.x;
	const dy = authoritative.y - predicted.y;
	if (Math.abs(dx) + Math.abs(dy) < RECONCILE_THRESHOLD) {
		authoritative.x = predicted.x;
		authoritative.y = predicted.y;
		authoritative.dir = predicted.dir;
		authoritative.facing = predicted.facing;
		authoritative.moving = predicted.moving;
	}
}
