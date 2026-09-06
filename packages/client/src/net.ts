/**
 * De netclient.
 *
 * Werkwijze: de client draait de volledige simulatie zelf door (prediction) en overschrijft
 * die 20 keer per seconde met de snapshot van de server. Alles behalve de eigen speler neemt
 * de serverstaat gewoon over; voor de eigen speler wordt een kleine afwijking genegeerd,
 * zodat je poppetje niet bij elke snapshot een sprongetje maakt.
 *
 * De server blijft de baas — dit stelt de correctie alleen uit tot ze groot genoeg is om
 * er echt toe te doen.
 */

import {
	Game,
	applySnapshot,
	reconcileLocalPlayer,
	type ClientMessage,
	type LevelSets,
	type PlayerInput,
	type PlayerState,
	type ServerMessage,
} from '@boom/sim';

export type NetPhase = 'connecting' | 'lobby' | 'playing' | 'closed' | 'error';

export interface NetLobby {
	members: { playerId: number; name: string; ready: boolean }[];
	host: number;
}

export interface NetHandlers {
	onPhase: (phase: NetPhase, detail?: string) => void;
	onLobby: (lobby: NetLobby) => void;
	onLevel: (game: Game) => void;
}

export class NetClient {
	playerId = 0;
	room = '';
	phase: NetPhase = 'connecting';
	lobby: NetLobby = { members: [], host: 1 };
	game: Game | null = null;

	private ws: WebSocket | null = null;
	private readonly sets: LevelSets;
	private readonly handlers: NetHandlers;
	private lastSent = '';

	constructor(sets: LevelSets, handlers: NetHandlers) {
		this.sets = sets;
		this.handlers = handlers;
	}

	connect(room: string, name: string): void {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		// In dev draait Vite op een andere poort dan de server; VITE_SERVER wijst hem aan.
		const base = import.meta.env['VITE_SERVER'] ?? `${proto}//${location.host}`;
		this.ws = new WebSocket(`${base}/ws`);

		this.ws.onopen = () => {
			this.send({ t: 'hello', version: 1, room, name });
		};
		this.ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as ServerMessage);
		this.ws.onclose = () => this.setPhase('closed');
		this.ws.onerror = () => this.setPhase('error', 'verbinding mislukt');
	}

	disconnect(): void {
		this.ws?.close();
		this.ws = null;
		this.game = null;
	}

	/** Waar zolang je nog op de levelwissel wacht om mee te mogen doen. */
	get waitingForNextLevel(): boolean {
		if (!this.game || this.playerId === 0) return false;
		return this.game.players[this.playerId - 1]?.present === false;
	}

	private setPhase(phase: NetPhase, detail?: string): void {
		this.phase = phase;
		this.handlers.onPhase(phase, detail);
	}

	private send(msg: ClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
	}

	ready(): void {
		this.send({ t: 'ready' });
	}

	start(nPlayers: number): void {
		this.send({ t: 'start', nPlayers });
	}

	/** Stuurt de invoer alleen als hij veranderd is; dat scheelt het merendeel van de pakketjes. */
	sendInput(tick: number, input: PlayerInput): void {
		const key = `${input.up ? 1 : 0}${input.down ? 1 : 0}${input.left ? 1 : 0}${input.right ? 1 : 0}${input.bomb ? 1 : 0}`;
		if (key === this.lastSent) return;
		this.lastSent = key;
		this.send({ t: 'input', tick, input });
	}

	private handle(msg: ServerMessage): void {
		switch (msg.t) {
			case 'welcome':
				this.playerId = msg.playerId;
				this.room = msg.room;
				this.setPhase('lobby');
				break;

			case 'lobby':
				this.lobby = msg;
				this.handlers.onLobby(msg);
				break;

			case 'level': {
				// De client bouwt zijn eigen wereld op uit hetzelfde level; de server-snapshots
				// corrigeren hem daarna. De seed doet er niet toe: alle willekeur die telt komt
				// via de snapshots binnen. De spelerstand gaat wél mee de constructor in, want
				// daaraan hangt wie er spawnt — kom je halverwege binnen, dan sta je nog niet
				// in het veld en kijk je eerst mee.
				const players = msg.players.map(
					(p) => ({ ...p, letters: [...p.letters] }) as PlayerState,
				);
				if (msg.variant === 'fourPlayer' && !this.sets.fourPlayer) {
					// Zonder dezelfde set rekenen we aan een ander level dan de server.
					this.setPhase('error', 'levels4p.json ontbreekt — draai `npm run spawns`');
					break;
				}

				const game = new Game({
					levelSet: this.sets.original,
					...(this.sets.fourPlayer ? { fourPlayerSet: this.sets.fourPlayer } : {}),
					players,
					startLevel: msg.levelNum,
					seed: 1,
				});
				this.game = game;
				this.setPhase('playing');
				this.handlers.onLevel(game);
				break;
			}

			case 'snap': {
				if (!this.game) break;
				const world = this.game.world;
				const local = world.entities.find(
					(e) => e.kind === 'player' && e.playerId === this.playerId,
				);
				const predicted = local ? { ...local } : undefined;

				applySnapshot(world, msg.snap);
				this.game.players = world.players;

				const authoritative = world.entities.find(
					(e) => e.kind === 'player' && e.playerId === this.playerId,
				);
				reconcileLocalPlayer(predicted, authoritative);
				break;
			}

			case 'error':
				this.setPhase('error', msg.message);
				break;

			default:
				break;
		}
	}
}
