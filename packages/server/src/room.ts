/**
 * Een kamer: één spelsessie met maximaal twee spelers.
 *
 * De server is autoritatief. Hij draait exact dezelfde `@boom/sim` als de browser, op een
 * vaste klok van 60 Hz, en stuurt 20 keer per seconde een snapshot. Clients sturen alleen
 * invoer — nooit posities.
 */

import { MAX_PLAYERS, NO_INPUT, newPlayerState, type LevelSet, type PlayerInput } from '@boom/sim';
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
	/** De wereld waarover we het laatst een `level`-bericht stuurden. */
	private announcedWorld: unknown = null;

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

		// Loopt er al een potje? Dan mag hij meekijken en doet hij mee vanaf het volgende
		// level. Het `level`-bericht laat zijn client de wereld opbouwen, zodat de snapshots
		// die zo binnenkomen ergens op geplakt kunnen worden.
		if (this.started && this.game) {
			this.game.join(member.playerId);
			member.send(this.levelMessage());
		}
	}

	remove(playerId: number): void {
		this.members.delete(playerId);
		this.game?.leave(playerId);
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

	/**
	 * Wie er meedoen bepalen we hier uit de kamer zelf, niet uit het meegestuurde aantal.
	 * De bezetting kan namelijk gaten hebben — als speler 2 weggaat en speler 3 blijft, is
	 * "twee spelers" niet hetzelfde als "speler 1 en 2".
	 */
	start(): void {
		if (this.started || this.members.size === 0) return;
		this.started = true;

		const seed = (Math.random() * 0x7fffffff) | 0;
		const players = [1, 2, 3, 4].map((id) => newPlayerState(id, this.members.has(id)));
		this.game = new Game(this.levelSet, this.members.size, 1, seed, players);
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

	private levelMessage(): ServerMessage {
		const game = this.game!;
		return {
			t: 'level',
			levelNum: game.world.levelNum,
			seed: 0,
			nPlayers: game.nPlayers,
			players: game.players.map((p) => ({ ...p, letters: [...p.letters] as never })),
		};
	}

	private announceLevel(): void {
		if (!this.game) return;
		this.announcedWorld = this.game.world;
		this.broadcast(this.levelMessage());
	}

	private tick(): void {
		const game = this.game;
		if (!game) return;

		const now = Date.now();
		const dt = Math.min(0.25, (now - this.lastTick) / 1000);
		this.lastTick = now;

		const inputs: (PlayerInput | undefined)[] = [];
		for (let id = 1; id <= MAX_PLAYERS; ++id) inputs.push(this.members.get(id)?.input);
		if (!inputs[0]) inputs[0] = { ...NO_INPUT };

		game.advance(dt, inputs);

		// Vergelijken op de wereld zelf en niet op het levelnummer: bij een retry blijft dat
		// nummer gelijk terwijl er wel degelijk een nieuwe wereld staat — en juist dan is er
		// misschien iemand bijgekomen die erin hoort.
		if (game.world !== this.announcedWorld) this.announceLevel();

		if (++this.tickCount % SNAPSHOT_EVERY === 0) {
			this.broadcast({ t: 'snap', snap: takeSnapshot(game.world) });
		}
	}
}
