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
				tilemap: 'X000000000000A0',
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

		room.start(1);
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

	it('stopt de klok zodra de laatste speler weg is', async () => {
		const room = new Room('TEST', levelSet());
		const sink: ServerMessage[] = [];
		room.add(member(1, sink));
		room.start(1);

		room.remove(1);
		expect(room.started).toBe(false);
		expect(room.emptySince).not.toBeNull();

		const before = sink.length;
		await new Promise((r) => setTimeout(r, 120));
		expect(sink.length).toBe(before);
	});
});
