import { describe, expect, it, vi } from 'vitest';
import { NO_INPUT, parseLevelSet, type RawLevelSet, type ServerMessage } from '@boom/sim';
import { Room } from './room.js';

/**
 * Een klein levelset zonder sockets: de kamer weet niet dat er een WebSocket bestaat, dus
 * we voeden hem gewoon een `send` die alles opvangt.
 */
function levelSet(): ReturnType<typeof parseLevelSet> {
	const raw: RawLevelSet = {
		name: 'test',
		author: 'test',
		difficulty: 'test',
		created: '',
		comment: '',
		tracks: [],
		enemies: [
			{ name: 'dummy', ai: 1, speed: 1, attack: { type: ['simple'], id: 1, fireRate: 1 } },
		],
		levels: [
			{
				num: 1,
				time: 120,
				music: 1,
				width: 5,
				height: 3,
				tileIDs: { bg: 1, border: 1, fixed: 1, breakable: 1 },
				tilemap: 'X00000Y000000A0',
				effects: [],
			},
		],
	};
	return parseLevelSet(raw);
}

function member(playerId: number, sink: ServerMessage[]) {
	return {
		playerId,
		name: `Speler ${playerId}`,
		ready: false,
		input: { ...NO_INPUT },
		send: (msg: ServerMessage) => sink.push(msg),
		close: () => undefined,
	};
}

describe('Room', () => {
	it('deelt oplopende speler-ids uit en zit vol bij vier', () => {
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];

		for (let id = 1; id <= 4; ++id) {
			expect(room.freeSlot()).toBe(id);
			room.add(member(id, sink));
		}
		expect(room.freeSlot()).toBeNull();
	});

	it('geeft een vrijgekomen slot opnieuw uit', () => {
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];
		for (let id = 1; id <= 4; ++id) room.add(member(id, sink));

		room.remove(2);
		expect(room.freeSlot()).toBe(2);
	});

	it('meldt de wachtkamer aan iedereen zodra er iemand bij komt', () => {
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];
		room.add(member(1, sink));
		room.add(member(2, sink));

		const lobbies = sink.filter((m) => m.t === 'lobby');
		expect(lobbies.length).toBeGreaterThanOrEqual(2);
		expect(lobbies.at(-1)).toMatchObject({ t: 'lobby' });
	});

	it('stuurt na de start een level en daarna snapshots', async () => {
		vi.useRealTimers();
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];
		room.add(member(1, sink));

		room.start();
		expect(sink.some((m) => m.t === 'level')).toBe(true);

		// 20 snapshots per seconde: na een kwart seconde moeten er een paar binnen zijn.
		await new Promise((r) => setTimeout(r, 300));
		room.stop();

		const snaps = sink.filter((m) => m.t === 'snap');
		expect(snaps.length).toBeGreaterThan(1);

		const first = snaps[0]!;
		if (first.t !== 'snap') throw new Error('geen snapshot');
		expect(first.snap.entities.some((e) => e.kind === 'player')).toBe(true);
		expect(first.snap.meta.levelNum).toBe(1);
	});

	it('laat een late binnenkomer meekijken en pas bij het volgende level meedoen', async () => {
		const room = new Room('TEST', levelSet());
		const first: ServerMessage[] = [];
		room.add(member(1, first));
		room.start();

		const late: ServerMessage[] = [];
		room.add(member(2, late));

		// Hij krijgt meteen het huidige level, zodat zijn client de wereld kan opbouwen.
		const level = late.find((m) => m.t === 'level');
		expect(level).toBeDefined();
		if (level?.t !== 'level') throw new Error('geen level');

		// Maar hij staat nog niet in het veld: dat gebeurt bij de levelwissel.
		expect(level.players[1]?.present).toBe(false);
		expect(room.game?.isPending(2)).toBe(true);

		room.game?.loadLevel(2);
		expect(room.game?.players[1]?.present).toBe(true);
		expect(room.game?.playerIds).toEqual([1, 2]);
		room.stop();
	});

	it('haalt een vertrekkende speler meteen uit het veld', () => {
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];
		room.add(member(1, sink));
		room.add(member(2, sink));
		room.start();

		expect(room.game?.playerIds).toEqual([1, 2]);
		const before = room.game!.world.entities.filter((e) => e.kind === 'player').length;
		expect(before).toBe(2);

		room.remove(2);
		expect(room.game?.playerIds).toEqual([1]);
		expect(room.game!.world.entities.filter((e) => e.kind === 'player')).toHaveLength(1);
		room.stop();
	});

	it('stopt de klok zodra de laatste speler weg is', async () => {
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];
		room.add(member(1, sink));
		room.start();

		room.remove(1);
		expect(room.started).toBe(false);
		expect(room.emptySince).not.toBeNull();

		const before = sink.length;
		await new Promise((r) => setTimeout(r, 120));
		expect(sink.length).toBe(before);
	});
});
