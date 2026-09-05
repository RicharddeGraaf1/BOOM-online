/**
 * Een kamer: één spelsessie met maximaal twee spelers.
 *
 * De server is autoritatief. Hij draait exact dezelfde `@boom/sim` als de browser, op een
 * vaste klok van 60 Hz, en stuurt 20 keer per seconde een snapshot. Clients sturen alleen
 * invoer — nooit posities.
 */

import { MAX_PLAYERS, NO_INPUT, type LevelSet, type PlayerInput } from '@boom/sim';
import { Game, SNAPSHOT_HZ, takeSnapshot, type ServerMessage } from '@boom/sim';


export interface Member {
	playerId: number;
	name: string;
	ready: boolean;
	input: PlayerInput;
	send: (msg: ServerMessage) => void;
	close: () => void;
}

const TICK_MS = 1000 / 60;
const SNAPSHOT_EVERY = Math.round(60 / SNAPSHOT_HZ);

/** Een kamer zonder spelers wordt na deze tijd opgeruimd. */
export const EMPTY_ROOM_TTL_MS = 60_000;

export class Room {
	readonly code: string;
	readonly members = new Map<number, Member>();

	game: Game | null = null;
	started = false;
	emptySince: number | null = Date.now();

	private readonly levelSet: LevelSet;
	private timer: NodeJS.Timeout | null = null;
	private tickCount = 0;
	private lastTick = 0;

	constructor(code: string, levelSet: LevelSet) {
		this.code = code;
		this.levelSet = levelSet;
	}

	/** Geeft het laagste vrije speler-id, of null als de kamer vol zit. */
	freeSlot(): number | null {
		for (let id = 1; id <= MAX_PLAYERS; ++id) if (!this.members.has(id)) return id;
		return null;
	}

	add(member: Member): void {
		this.members.set(member.playerId, member);
		this.emptySince = null;
		this.broadcastLobby();
	}

	remove(playerId: number): void {
		this.members.delete(playerId);
		if (this.members.size === 0) {
			this.stop();
			this.emptySince = Date.now();
		} else {
			this.broadcastLobby();
		}
	}

	setInput(playerId: number, input: PlayerInput): void {
		const m = this.members.get(playerId);
		if (m) m.input = input;
	}

	setReady(playerId: number, ready: boolean): void {
		const m = this.members.get(playerId);
		if (!m) return;
		m.ready = ready;
		this.broadcastLobby();
	}

	broadcast(msg: ServerMessage): void {
		for (const m of this.members.values()) m.send(msg);
	}

	broadcastLobby(): void {
		this.broadcast({
			t: 'lobby',
			members: [...this.members.values()].map((m) => ({
				playerId: m.playerId,
				name: m.name,
				ready: m.ready,
			})),
			host: Math.min(...[...this.members.keys()], 1),
		});
	}

	start(nPlayers: number): void {
		if (this.started) return;
		this.started = true;

		const seed = (Math.random() * 0x7fffffff) | 0;
		this.game = new Game(this.levelSet, Math.max(1, Math.min(MAX_PLAYERS, nPlayers)), 1, seed);
		this.announceLevel();

		this.lastTick = Date.now();
		this.timer = setInterval(() => this.tick(), TICK_MS);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.started = false;
		this.game = null;
	}

	private announceLevel(): void {
		if (!this.game) return;
		this.broadcast({
			t: 'level',
			levelNum: this.game.world.levelNum,
			seed: 0,
			nPlayers: this.game.nPlayers,
			players: this.game.players.map((p) => ({ ...p, letters: [...p.letters] as never })),
		});
	}

	private tick(): void {
		const game = this.game;
		if (!game) return;

		const now = Date.now();
		const dt = Math.min(0.25, (now - this.lastTick) / 1000);
		this.lastTick = now;

		const before = game.world.levelNum;
		const inputs: (PlayerInput | undefined)[] = [];
		for (let id = 1; id <= MAX_PLAYERS; ++id) inputs.push(this.members.get(id)?.input);
		if (!inputs[0]) inputs[0] = { ...NO_INPUT };

		game.advance(dt, inputs);

		if (game.world.levelNum !== before) this.announceLevel();

		if (++this.tickCount % SNAPSHOT_EVERY === 0) {
			this.broadcast({ t: 'snap', snap: takeSnapshot(game.world) });
		}
	}
}
