/**
 * De spelsessie: vaste timestep, levelvoortgang, levens en continues.
 *
 * De klok is bewust losgekoppeld van het beeldscherm. `advance(realDt)` verzamelt verstreken
 * tijd en doet daar hele stappen van 1/60 s mee — nooit een halve. Een browser die even
 * hapert loopt daarna in, en een 144 Hz-scherm rekent niet 144 keer per seconde. Zonder die
 * scheiding kan dezelfde wereld op twee machines niet hetzelfde uitkomen, en dan is netcode
 * bij voorbaat kansloos.
 */

import { DT, MAX_PLAYERS } from './constants.js';
import { createWorld, newPlayerState, update } from './world.js';
import { NO_INPUT, type PlayerInput, type PlayerState, type World } from './types.js';
import type { LevelSet } from './levelset.js';

/** Hoe lang het scherm tussen twee levels blijft staan. */
export const INTERLEVEL_TIME = 2.5;

/** Meer dan een kwart seconde inhalen doen we niet: liever traag dan een sprong. */
const MAX_CATCHUP = 0.25;

export type Phase = 'playing' | 'interlevel' | 'gameover';

export class Game {
	readonly levelSet: LevelSet;
	players: PlayerState[];
	world: World;
	phase: Phase = 'playing';
	phaseT = 0;

	/**
	 * Wie er meedoen vanaf het volgende level. Iemand die halverwege een potje binnenkomt
	 * kijkt eerst mee en spawnt bij de levelwissel — midden in een level laten verschijnen
	 * is oneerlijk voor wie er al staat, en vaak ook gewoon dodelijk.
	 */
	private readonly pendingJoins = new Set<number>();

	private accumulator = 0;
	private seed: number;

	/**
	 * `players` meegeven is voor de netclient: die moet exact de spelerstand van de server
	 * overnemen vóórdat de wereld gebouwd wordt, want daaraan hangt wie er spawnt.
	 */
	constructor(
		levelSet: LevelSet,
		nPlayers: number,
		startLevel = 1,
		seed = Date.now() | 0,
		players?: PlayerState[],
	) {
		this.levelSet = levelSet;
		this.seed = seed;
		const count = Math.max(1, Math.min(MAX_PLAYERS, nPlayers));
		this.players = players ?? [1, 2, 3, 4].map((id) => newPlayerState(id, id <= count));
		this.world = createWorld(levelSet, startLevel, this.players, { seed });
	}

	/** Het aantal spelers dat nu meedoet. Afgeleid, want de bezetting kan gaten hebben. */
	get nPlayers(): number {
		return this.players.filter((p) => p.present).length;
	}

	/** De id's die meedoen; niet per se aaneengesloten. */
	get playerIds(): number[] {
		return this.players.filter((p) => p.present).map((p) => p.id);
	}

	/** Meld iemand aan. Hij doet mee vanaf het volgende level. */
	join(playerId: number): void {
		if (playerId < 1 || playerId > MAX_PLAYERS) return;
		if (this.players[playerId - 1]?.present) return;
		this.pendingJoins.add(playerId);
	}

	/** Wacht deze speler nog op de levelwissel? */
	isPending(playerId: number): boolean {
		return this.pendingJoins.has(playerId);
	}

	/**
	 * Meld iemand af. Zijn poppetje verdwijnt meteen uit het veld — een stilstaand lichaam
	 * laten staan tot een vijand er tegenaan loopt is nergens goed voor.
	 */
	leave(playerId: number): void {
		this.pendingJoins.delete(playerId);
		const ps = this.players[playerId - 1];
		if (ps) ps.present = false;
		this.world.entities = this.world.entities.filter(
			(e) => !(e.kind === 'player' && e.playerId === playerId),
		);
	}

	/** Nieuwe wereld voor hetzelfde of een volgend level, met behoud van de spelerstand. */
	loadLevel(levelNum: number): void {
		this.applyPendingJoins();
		this.seed = (this.seed * 1103515245 + 12345) | 0;
		this.world = createWorld(this.levelSet, levelNum, this.players, { seed: this.seed });
		this.phase = 'playing';
		this.phaseT = 0;
		this.accumulator = 0;
	}

	/** Een nieuwkomer begint met een schone lei: eigen levens, continues en score. */
	private applyPendingJoins(): void {
		for (const id of this.pendingJoins) this.players[id - 1] = newPlayerState(id, true);
		this.pendingJoins.clear();
	}

	/**
	 * Zet de sessie vooruit met de echte verstreken tijd. Geeft terug hoeveel simulatiestappen
	 * er gezet zijn, zodat de aanroeper weet of er iets veranderd is.
	 */
	advance(realDt: number, inputs: (PlayerInput | undefined)[]): number {
		this.accumulator += Math.min(realDt, MAX_CATCHUP);

		let steps = 0;
		while (this.accumulator >= DT) {
			this.accumulator -= DT;
			this.step(inputs);
			steps++;
		}
		return steps;
	}

	private step(inputs: (PlayerInput | undefined)[]): void {
		if (this.phase === 'interlevel') {
			this.phaseT += DT;
			if (this.phaseT >= INTERLEVEL_TIME) this.finishInterlevel();
			return;
		}
		if (this.phase === 'gameover') return;

		update(this.world, inputs);

		switch (this.world.status) {
			case 'cleared':
				this.phase = 'interlevel';
				this.phaseT = 0;
				break;
			case 'retry':
				this.phase = 'interlevel';
				this.phaseT = 0;
				break;
			case 'gameover':
				this.phase = 'gameover';
				break;
			default:
				break;
		}
	}

	private finishInterlevel(): void {
		if (this.world.status === 'retry') {
			// Een continue kost een muntje: levens terug, score blijft staan.
			let used = false;
			for (const ps of this.players) {
				if (!ps.present || ps.continues <= 0) continue;
				ps.continues--;
				ps.remainingLives = 2;
				ps.out = false;
				ps.life = 16;
				used = true;
			}
			if (!used) {
				this.phase = 'gameover';
				return;
			}
			this.loadLevel(this.world.levelNum);
			return;
		}

		const next = this.world.levelNum + 1;
		if (next > this.levelSet.levels.length) {
			// Uitgespeeld. Het origineel begint dan weer bij level 1; wij ook.
			this.loadLevel(1);
			return;
		}
		this.loadLevel(next);
	}

	/** Muziektrack die bij het huidige level hoort. */
	get track(): number {
		const level = this.levelSet.levels.find((l) => l.num === this.world.levelNum);
		return level?.music ?? 1;
	}

	static noInput(): PlayerInput {
		return { ...NO_INPUT };
	}
}
