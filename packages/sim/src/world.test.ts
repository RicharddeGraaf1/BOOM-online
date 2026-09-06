import { describe, expect, it } from 'vitest';
import { createWorld, newPlayerState } from './world.js';
import { update } from './world.js';
import { parseLevelSet, type RawLevelSet } from './levelset.js';
import { Dir } from './direction.js';
import { TILE_SIZE, bomb as BOMB } from './constants.js';
import type { Entity, PlayerInput, World } from './types.js';
import { NO_INPUT } from './types.js';

/**
 * Een 5x3 testveld. `.` = leeg, `#` = vaste muur, `x` = breekbaar, `X` = speler 1.
 * De sim rekent met een border van één tegel eromheen, dus tegel (1,1) is de linkerbovenhoek.
 */
function makeWorld(rows: string[], nPlayers = 1): World {
	return makeWorldFor(
		rows,
		[1, 2, 3, 4].filter((id) => id <= nPlayers),
	);
}

/** Zelfde veld, maar met een expliciete bezetting — die hoeft niet aaneengesloten te zijn. */
function makeWorldFor(rows: string[], presentIds: number[]): World {
	const width = rows[0]!.length;
	const height = rows.length;
	const tilemap = rows
		.join('')
		.replace(/\./g, '0')
		.replace(/#/g, '1')
		.replace(/x/g, '2')
		.replace(/c/g, '3')
		.replace(/z/g, 'Z')
		.replace(/w/g, 'W');

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
				width,
				height,
				tileIDs: { bg: 1, border: 1, fixed: 1, breakable: 1 },
				tilemap,
				effects: [],
			},
		],
	};

	const set = parseLevelSet(raw);
	const players = [1, 2, 3, 4].map((id) => newPlayerState(id, presentIds.includes(id)));
	const w = createWorld(set, 1, players, { seed: 12345 });

	// Een level zonder vijanden is meteen uitgespeeld en dan staat update() stil. Voor tests
	// die tijd nodig hebben zetten we de vijand op zijn plek vast in plaats van hem weg te
	// laten: zo blijft de wereld draaien zonder dat hij het testresultaat beinvloedt.
	for (const e of w.entities) {
		if (e.kind !== 'enemy') continue;
		e.speed = 0;
		e.moving = false;
	}
	return w;
}

function ents(w: World, kind: string): Entity[] {
	return w.entities.filter((e) => e.kind === kind && !e.dead);
}

function press(over: Partial<PlayerInput>): PlayerInput {
	return { ...NO_INPUT, ...over };
}

/** Laat de wereld n ticks lopen met vaste invoer. */
function run(w: World, ticks: number, input: PlayerInput = NO_INPUT): void {
	for (let i = 0; i < ticks; ++i) update(w, [input, undefined]);
}

describe('wereldopbouw', () => {
	it('legt de border als vaste muur rondom het speelveld', () => {
		const w = makeWorld(['...', '...']);
		expect(w.fixed[0]).toBe(1); // hoek linksboven
		expect(w.fixed[1 * (w.width + 2) + 1]).toBe(0); // eerste speelbare tegel
	});

	it('zet de speler op het X-spawnpunt, in pixels met de border meegerekend', () => {
		const w = makeWorld(['X..', '...']);
		const p = ents(w, 'player')[0]!;
		expect(p.x).toBe(TILE_SIZE);
		expect(p.y).toBe(TILE_SIZE);
	});

	it('laat speler 2 weg als er maar één speler meedoet', () => {
		const w = makeWorld(['X.Y', '...'], 1);
		expect(ents(w, 'player')).toHaveLength(1);
	});

	it('zet drie spelers neer als er drie meedoen', () => {
		const w = makeWorld(['X.Y.z', '....w'], 3);
		expect(ents(w, 'player').map((p) => p.playerId).sort()).toEqual([1, 2, 3]);
	});

	/**
	 * Dit is het geval waar een telling het laat afweten: speler 2 stapt eruit en speler 3
	 * blijft. "Twee spelers" is dan niet hetzelfde als "speler 1 en 2".
	 */
	it('spawnt op wie er meedoet, ook als de bezetting een gat heeft', () => {
		const w = makeWorldFor(['X.Y.z', '....w'], [1, 3]);
		expect(ents(w, 'player').map((p) => p.playerId).sort()).toEqual([1, 3]);
	});
});

describe('beweging', () => {
	it('loopt niet door een vaste muur heen', () => {
		const w = makeWorld(['X#A', '...']);
		const p = ents(w, 'player')[0]!;
		run(w, 60, press({ right: true }));
		// De speler mag hooguit tot de rand van zijn eigen tegel komen.
		expect(p.x).toBeLessThanOrEqual(TILE_SIZE + 0.5);
	});

	it('loopt wel door een vrije tegel', () => {
		const w = makeWorld(['X.A', '...']);
		const p = ents(w, 'player')[0]!;
		run(w, 30, press({ right: true }));
		expect(p.x).toBeGreaterThan(TILE_SIZE + 10);
	});

	it('mag pas van as wisselen als hij op het raster staat', () => {
		const w = makeWorld(['X.A', '...']);
		const p = ents(w, 'player')[0]!;
		run(w, 5, press({ right: true }));
		// Halverwege een tegel: omhoog kan niet, dus hij blijft naar rechts kijken.
		update(w, [press({ down: true }), undefined]);
		expect(p.dir).toBe(Dir.RIGHT);
	});
});

describe('bommen en explosies', () => {
	it('legt maximaal het toegestane aantal bommen', () => {
		const w = makeWorld(['X....', '....A']);
		run(w, 1, press({ bomb: true }));
		expect(ents(w, 'bomb')).toHaveLength(1);
		// Nog een keer drukken op dezelfde tegel levert geen tweede bom op.
		run(w, 1, press({ bomb: true }));
		expect(ents(w, 'bomb')).toHaveLength(1);
	});

	it('ontploft na de standaard lont van vijf seconden', () => {
		const w = makeWorld(['X....', '....A']);
		run(w, 1, press({ bomb: true }));
		run(w, Math.ceil(BOMB.DEFAULT_FUSE * 60) + 2);
		expect(ents(w, 'bomb')).toHaveLength(0);
		expect(ents(w, 'explosion').length + w.entities.filter((e) => e.kind === 'explosion').length)
			.toBeGreaterThan(0);
	});

	it('laat de vlam stoppen bij een vaste muur', () => {
		//  speler op (1,1), muur op (3,1): de vlam naar rechts haalt precies één tegel.
		const w = makeWorld(['X.#..', '....A']);
		run(w, 1, press({ bomb: true }));
		run(w, Math.ceil(BOMB.DEFAULT_FUSE * 60) + 2);
		const expl = w.entities.find((e) => e.kind === 'explosion');
		expect(expl).toBeDefined();
		expect(expl!.reach![Dir.RIGHT]).toBe(1);
	});

	it('sloopt een breekbare muur en tekent er geen vlam op', () => {
		const w = makeWorld(['Xx...', '....A']);
		run(w, 1, press({ bomb: true }));
		run(w, Math.ceil(BOMB.DEFAULT_FUSE * 60) + 2);
		const expl = w.entities.find((e) => e.kind === 'explosion')!;
		// De muur stond direct naast de bom: geen enkele vrije tegel naar rechts.
		expect(expl.reach![Dir.RIGHT]).toBe(0);
		expect(w.breakable[1 * (w.width + 2) + 2]).toBe(0);
	});

	it('steekt een bom in de vlam aan zodat er een ketting ontstaat', () => {
		const w = makeWorld(['X....', '....A']);
		run(w, 1, press({ bomb: true }));
		const first = w.entities.find((e) => e.kind === 'bomb')!;
		// Tweede bom binnen de radius, met een lont die nog lang niet af is.
		const second = { ...first, id: 999, tx: 3, ty: 1, x: 3 * TILE_SIZE, fuseT: 0 };
		w.entities.push(second as Entity);

		run(w, Math.ceil(BOMB.DEFAULT_FUSE * 60) + 4);
		// De eerste bom is af en heeft de tweede aangestoken: die staat op een korte lont.
		expect(second.fuseTime).toBeLessThanOrEqual(0.05);
	});
});

describe('level halen', () => {
	it('is meteen gehaald als er geen vijanden in het level staan', () => {
		const w = makeWorld(['X..', '...']);
		update(w, [NO_INPUT, undefined]);
		expect(w.status).toBe('cleared');
	});

	it('blijft lopen zolang er nog een vijand leeft', () => {
		const w = makeWorld(['X.A', '...']);
		update(w, [NO_INPUT, undefined]);
		expect(w.status).toBe('playing');
	});
});

describe('bepaaldheid', () => {
	it('geeft bij dezelfde seed en invoer exact dezelfde wereld', () => {
		const a = makeWorld(['Xxxxx', '....A', 'xxxxx']);
		const b = makeWorld(['Xxxxx', '....A', 'xxxxx']);
		const input = press({ right: true, bomb: true });
		run(a, 400, input);
		run(b, 400, input);

		const strip = (w: World) =>
			w.entities.map((e) => [e.kind, Math.round(e.x), Math.round(e.y), e.dead]);
		expect(strip(a)).toEqual(strip(b));
	});
});
