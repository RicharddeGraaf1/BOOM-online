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
	nPlayers: number;

	private accumulator = 0;
	private seed: number;

	constructor(levelSet: LevelSet, nPlayers: number, startLevel = 1, seed = Date.now() | 0) {
		this.levelSet = levelSet;
		this.nPlayers = Math.max(1, Math.min(MAX_PLAYERS, nPlayers));
		this.seed = seed;
		this.players = [1, 2, 3, 4].map((id) => newPlayerState(id, id <= nPlayers));
		this.world = createWorld(levelSet, startLevel, this.players, { seed, nPlayers });
	}

	/** Nieuwe wereld voor hetzelfde of een volgend level, met behoud van de spelerstand. */
	loadLevel(levelNum: number): void {
		this.seed = (this.seed * 1103515245 + 12345) | 0;
		this.world = createWorld(this.levelSet, levelNum, this.players, {
			seed: this.seed,
			nPlayers: this.nPlayers,
		});
		this.phase = 'playing';
		this.phaseT = 0;
		this.accumulator = 0;
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
