import { describe, expect, it } from 'vitest';
import { Game } from './game.js';
import { killEnemy } from './combat.js';
import { parseLevelSet, type LevelSet, type RawLevelSet } from './levelset.js';
import { EXTRA_GAME_DURATION } from './constants.js';
import { COIN_GRAB_TIME, LEVEL_CLEAR_GRACE } from './world.js';
import { LETTER_CYCLE } from './combat.js';
import { NO_INPUT, type Entity, type PlayerInput } from './types.js';

/**
 * De extra game: raap je alle munten van een level op, dan morfen de vijanden dertig
 * seconden lang tot aliens en laten ze bij hun dood een EXTRA-letter vallen. Vijf letters
 * is een extra leven.
 *
 * Het veld hieronder is 5x3. `X` staat linksboven, met munten ernaast op dezelfde rij, en
 * een vijand rechtsonder die er niet bij kan.
 */
function makeSet(tilemap: string): LevelSet {
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
		levels: [
			{
				num: 1,
				time: 300,
				music: 1,
				width: 5,
				height: 3,
				tileIDs: { bg: 1, border: 1, fixed: 1, breakable: 1 },
				tilemap,
				effects: [],
			},
		],
	};
	return parseLevelSet(raw);
}

function press(over: Partial<PlayerInput>): PlayerInput {
	return { ...NO_INPUT, ...over };
}

/** Speler linksboven, drie munten ernaast, vijand rechtsonder buiten bereik. */
const LEVEL = 'X33300000000A0';

function newGame(): Game {
	// De vijand vastzetten: hij hoeft in deze test niets te doen behalve bestaan.
	const game = new Game({ levelSet: makeSet(LEVEL + '0'), nPlayers: 1, seed: 7 });
	for (const e of game.world.entities) {
		if (e.kind === 'enemy') {
			e.speed = 0;
			e.moving = false;
		}
	}
	return game;
}

function coinsLeft(game: Game): number {
	return game.world.entities.filter((e) => e.kind === 'coin' && !e.dead).length;
}

function run(game: Game, ticks: number, input: PlayerInput = NO_INPUT): void {
	for (let i = 0; i < ticks; ++i) game.advance(1 / 60, [input]);
}

describe('level uitspelen', () => {
	/**
	 * Het laatste vijandje kan net een letter hebben laten vallen. Ging de wereld meteen op
	 * slot, dan kon je die niet meer oprapen. Het origineel wacht vier seconden voordat het
	 * naar het tussenscherm gaat (WinLoseHandler::_handleWin).
	 */
	it('laat je na het laatste vijandje nog rondlopen', () => {
		const game = newGame();
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		killEnemy(game.world, enemy, 1);
		run(game, 1);

		expect(game.world.status).toBe('cleared');
		expect(game.phase).toBe('playing');

		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const before = player.x;
		run(game, 30, press({ right: true }));
		expect(player.x).toBeGreaterThan(before);
	});

	it('gaat na vier seconden alsnog naar het tussenscherm', () => {
		const game = newGame();
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		killEnemy(game.world, enemy, 1);

		run(game, Math.ceil(LEVEL_CLEAR_GRACE * 60) + 5);
		expect(game.phase).toBe('interlevel');
	});

	it('laat je in die tijd nog een gevallen letter oprapen', () => {
		const game = newGame();
		run(game, 120, press({ right: true })); // munten weg, extra game aan

		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		enemy.x = player.x;
		enemy.y = player.y;
		killEnemy(game.world, enemy, 1);

		expect(game.world.entities.some((e) => e.kind === 'letter')).toBe(true);
		run(game, 4);
		expect(game.players[0]!.letters.filter(Boolean)).toHaveLength(1);
	});
});

describe('aanraking met een vijand', () => {
	/**
	 * Elke aanraking met een vijandslichaam doet pijn, niet alleen die van vijanden met een
	 * contact-aanval. Dat had ik verkeerd, en daardoor kon je overal dwars doorheen lopen.
	 */
	it('doet schade, ook bij een vijand zonder contact-aanval', () => {
		const game = newGame();
		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;

		player.shieldT = 0;
		const before = player.hp;
		enemy.x = player.x;
		enemy.y = player.y;

		run(game, 2);
		expect(player.hp).toBeLessThan(before);
	});

	it('doet geen schade zolang je een schild hebt', () => {
		const game = newGame();
		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;

		player.shieldT = 5;
		const before = player.hp;
		enemy.x = player.x;
		enemy.y = player.y;

		run(game, 2);
		expect(player.hp).toBe(before);
	});
});

describe('munt en letter', () => {
	/**
	 * De munt draait niet uit zichzelf: Coin.cpp zet de animatie op pause() en start hem pas
	 * bij het oppakken. Hij moet dus na het grijpen nog even blijven bestaan, anders is er
	 * niets om die draai op te tekenen.
	 */
	it('laat een opgeraapte munt nog even liggen om zijn draai af te maken', () => {
		const game = newGame();
		run(game, 40, press({ right: true }));

		const grabbed = game.world.entities.filter((e) => e.kind === 'coin' && e.dead);
		expect(grabbed.length).toBeGreaterThan(0);
		expect(COIN_GRAB_TIME).toBeGreaterThan(0.3);
	});

	it('morft een gevallen letter door naar de volgende', () => {
		const game = newGame();
		run(game, 120, press({ right: true }));

		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		// Ver weg neerleggen, anders raapt de speler hem meteen op.
		enemy.x = player.x + 96;
		killEnemy(game.world, enemy, 1);

		const letter = game.world.entities.find((e) => e.kind === 'letter')!;
		const first = letter.letter;

		run(game, Math.ceil(LETTER_CYCLE * 60) + 2);
		expect(letter.letter).toBe(((first ?? 0) + 1) % 5);
	});
});

describe('extra game', () => {
	it('begint niet zolang er nog munten liggen', () => {
		const game = newGame();
		expect(coinsLeft(game)).toBe(3);
		run(game, 10);
		expect(game.world.extraGame).toBe(false);
	});

	it('begint zodra de laatste munt weg is en morft de vijanden', () => {
		const game = newGame();
		run(game, 120, press({ right: true }));

		expect(coinsLeft(game)).toBe(0);
		expect(game.world.extraGame).toBe(true);
		expect(game.world.entities.find((e) => e.kind === 'enemy')?.morphed).toBe(true);
	});

	it('laat een gemorfde vijand een letter vallen', () => {
		const game = newGame();
		run(game, 120, press({ right: true }));

		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		killEnemy(game.world, enemy, 1);

		const letters = game.world.entities.filter((e) => e.kind === 'letter');
		expect(letters).toHaveLength(1);
		expect(letters[0]!.letter).toBeGreaterThanOrEqual(0);
		expect(letters[0]!.letter).toBeLessThanOrEqual(4);
	});

	it('laat een gewone vijand géén letter vallen', () => {
		const game = newGame();
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		killEnemy(game.world, enemy, 1);
		expect(game.world.entities.filter((e) => e.kind === 'letter')).toHaveLength(0);
	});

	it('kent een opgeraapte letter toe aan de speler', () => {
		const game = newGame();
		run(game, 120, press({ right: true }));

		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		enemy.x = player.x;
		enemy.y = player.y;
		killEnemy(game.world, enemy, 1);

		run(game, 2);
		expect(game.players[0]!.letters.filter(Boolean)).toHaveLength(1);
	});

	it('geeft een extra leven bij vijf letters en begint dan opnieuw', () => {
		const game = newGame();
		run(game, 120, press({ right: true }));
		const ps = game.players[0]!;
		const before = ps.remainingLives;
		ps.letters = [true, true, true, true, false];

		const player = game.world.entities.find((e) => e.kind === 'player')!;
		const enemy = game.world.entities.find((e) => e.kind === 'enemy') as Entity;
		enemy.x = player.x;
		enemy.y = player.y;
		// De laatste letter die ontbreekt, ongeacht welke de RNG kiest.
		killEnemy(game.world, enemy, 1);
		const letter = game.world.entities.find((e) => e.kind === 'letter')!;
		letter.letter = 4;

		run(game, 2);
		expect(ps.remainingLives).toBe(before + 1);
		expect(ps.letters.filter(Boolean)).toHaveLength(0);
	});

	it('stopt na dertig seconden en ruimt de letters op', () => {
		const game = newGame();
		run(game, 120, press({ right: true }));
		expect(game.world.extraGame).toBe(true);

		run(game, Math.ceil(EXTRA_GAME_DURATION * 60) + 5);
		expect(game.world.extraGame).toBe(false);
		expect(game.world.entities.find((e) => e.kind === 'enemy')?.morphed).toBe(false);
	});
});
