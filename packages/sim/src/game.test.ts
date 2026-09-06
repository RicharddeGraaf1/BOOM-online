import { describe, expect, it } from 'vitest';
import { Game, variantFor } from './game.js';
import { parseLevelSet, type LevelSet, type RawLevelSet } from './levelset.js';
import { bomb as BOMB, player as PLAYER } from './constants.js';
import { NO_INPUT, type PlayerInput } from './types.js';

/** Een klein veld; `withExtraSpawns` zet er ook plekken voor speler 3 en 4 in. */
function makeSet(withExtraSpawns: boolean): LevelSet {
	const tilemap = withExtraSpawns ? 'X0Y0Z0W00000A00' : 'X0Y000000000A00';
	const raw: RawLevelSet = {
		name: 't',
		author: 't',
		difficulty: 't',
		created: '',
		comment: '',
		tracks: [],
		enemies: [
			{ name: 'dummy', ai: 1, speed: 1, attack: { type: ['simple'], id: 1, fireRate: 1 } },
		],
		levels: [1, 2].map((num) => ({
			num,
			time: 120,
			music: 1,
			width: 5,
			height: 3,
			tileIDs: { bg: 1, border: 1, fixed: 1, breakable: 1 },
			tilemap,
			effects: [],
		})),
	};
	return parseLevelSet(raw);
}

function press(over: Partial<PlayerInput>): PlayerInput {
	return { ...NO_INPUT, ...over };
}

const sets = () => ({ original: makeSet(false), fourPlayer: makeSet(true) });

describe('welke levelset er gespeeld wordt', () => {
	it('houdt de originele maps zolang er hooguit twee spelers zijn', () => {
		expect(variantFor(1, sets())).toBe('original');
		expect(variantFor(2, sets())).toBe('original');
	});

	it('schakelt over vanaf drie spelers', () => {
		expect(variantFor(3, sets())).toBe('fourPlayer');
		expect(variantFor(4, sets())).toBe('fourPlayer');
	});

	it('blijft op de originele set als de vierspelersset ontbreekt', () => {
		const only = { original: makeSet(false) };
		expect(variantFor(4, only)).toBe('original');
	});

	it('kiest bij de start de set die bij het aantal spelers hoort', () => {
		const s = sets();
		const two = new Game({ levelSet: s.original, fourPlayerSet: s.fourPlayer, nPlayers: 2 });
		expect(two.variant).toBe('original');

		const three = new Game({ levelSet: s.original, fourPlayerSet: s.fourPlayer, nPlayers: 3 });
		expect(three.variant).toBe('fourPlayer');
	});

	/**
	 * Halverwege een level van set wisselen zou de wereld onder de spelers vandaan trekken.
	 * De omschakeling hoort dus samen te vallen met de levelwissel, net als het meedoen zelf.
	 */
	it('schakelt pas om bij de levelwissel, niet meteen', () => {
		const s = sets();
		const game = new Game({ levelSet: s.original, fourPlayerSet: s.fourPlayer, nPlayers: 2 });

		game.join(3);
		expect(game.variant).toBe('original');

		game.loadLevel(2);
		expect(game.variant).toBe('fourPlayer');
		expect(game.playerIds).toEqual([1, 2, 3]);
	});

	it('schakelt terug als de derde speler weer weggaat', () => {
		const s = sets();
		const game = new Game({ levelSet: s.original, fourPlayerSet: s.fourPlayer, nPlayers: 3 });
		expect(game.variant).toBe('fourPlayer');

		game.leave(3);
		game.loadLevel(2);
		expect(game.variant).toBe('original');
	});
});

/**
 * Deze waarden komen letterlijk uit de C++-bron. Ze stonden er fout in — je begon met één
 * bom in plaats van vijf — en dat is precies het soort fout dat geen enkele andere test ziet,
 * omdat alles er verder prima uitziet.
 */
describe('begintoestand van een speler', () => {
	const game = () => new Game({ levelSet: makeSet(false), nPlayers: 1 });

	it('begint met vijf bommen', () => {
		// src/lifish/entities/Player.hpp:21 — powers.maxBombs = DEFAULT_MAX_BOMBS
		expect(game().players[0]!.powers.maxBombs).toBe(PLAYER.DEFAULT_MAX_BOMBS);
		expect(PLAYER.DEFAULT_MAX_BOMBS).toBe(5);
	});

	it('houdt twee levens in reserve, niet drie', () => {
		// src/lifish/entities/Player.hpp:32 — remainingLives = INITIAL_LIVES - 1
		expect(game().players[0]!.remainingLives).toBe(PLAYER.INITIAL_LIVES - 1);
	});

	it('begint met de standaard radius en lont', () => {
		const powers = game().players[0]!.powers;
		expect(powers.bombRadius).toBe(BOMB.DEFAULT_RADIUS);
		expect(powers.bombFuseTime).toBe(BOMB.DEFAULT_FUSE);
	});
});

describe('sterven', () => {
	it('zet opgeraapte krachten terug op de standaard, maar houdt de letters', () => {
		const game = new Game({ levelSet: makeSet(false), nPlayers: 1 });
		const ps = game.players[0]!;

		ps.powers.maxBombs = 8;
		ps.powers.bombRadius = 4;
		ps.powers.bombFuseTime = BOMB.QUICK_FUSE;
		ps.letters = [true, true, false, false, false];

		const player = game.world.entities.find((e) => e.kind === 'player')!;
		player.shieldT = 0;
		player.hp = 1;

		// Een bom naast je neerleggen en wachten tot hij afgaat.
		for (let i = 0; i < Math.ceil(BOMB.DEFAULT_FUSE * 60) + 30; ++i) {
			game.advance(1 / 60, [i === 0 ? press({ bomb: true }) : NO_INPUT]);
		}

		// src/lifish/entities/Player.cpp:157-161 — `info.reset(false)`
		expect(player.dead).toBe(true);
		expect(ps.powers.maxBombs).toBe(PLAYER.DEFAULT_MAX_BOMBS);
		expect(ps.powers.bombRadius).toBe(BOMB.DEFAULT_RADIUS);
		expect(ps.powers.bombFuseTime).toBe(BOMB.DEFAULT_FUSE);
		expect(ps.letters).toEqual([true, true, false, false, false]);
	});
});
