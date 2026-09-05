import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	Game,
	NO_INPUT,
	makeRng,
	parseLevelSet,
	randomInt,
	type PlayerInput,
	type RawLevelSet,
} from '@boom/sim';

/**
 * Doorloop over de echte levels.
 *
 * De unittests in @boom/sim werken op kleine kunstmatige veldjes. Die vangen geen bugs die
 * alleen bij echte data opduiken: een boss van 5x5 tegen de rand, een teleport zonder
 * tegenhanger, een vijandtype dat maar in één level voorkomt. Daarom draaien we hier alle
 * 80 levels een paar seconden met willekeurige invoer, en kijken of de simulatie heel blijft.
 *
 * Slaat zichzelf over als de assets niet geïmporteerd zijn — die staan bewust niet in de repo.
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CANDIDATES = [
	resolve(HERE, '../../client/public/assets/levels4p.json'),
	resolve(HERE, '../../client/public/assets/levels.json'),
];

const path = CANDIDATES.find((p) => existsSync(p));

async function loadSet() {
	return parseLevelSet(JSON.parse(await readFile(path!, 'utf8')) as RawLevelSet);
}

/** Willekeurige maar reproduceerbare invoer, zodat een fout terug te halen is. */
function botInput(rng: ReturnType<typeof makeRng>, tick: number): PlayerInput {
	if (tick % 20 !== 0) return { ...NO_INPUT };
	const dir = randomInt(rng, 0, 4);
	return {
		...NO_INPUT,
		up: dir === 0,
		left: dir === 1,
		down: dir === 2,
		right: dir === 3,
		bomb: randomInt(rng, 0, 6) === 0,
	};
}

describe.skipIf(!path)('alle 80 originele levels', () => {
	it('bevat 80 levels met een geldige tilemap', async () => {
		const set = await loadSet();
		expect(set.levels).toHaveLength(80);
		for (const level of set.levels) {
			expect(level.cells).toHaveLength(level.width * level.height);
		}
	});

	it('heeft precies één spawnpunt per speler per level', async () => {
		const set = await loadSet();
		for (const level of set.levels) {
			const p1 = level.cells.filter((c) => c.kind === 'player1').length;
			const p2 = level.cells.filter((c) => c.kind === 'player2').length;
			expect(p1, `level ${level.num}`).toBe(1);
			expect(p2, `level ${level.num}`).toBe(1);
		}
	});

	it('draait elk level drie seconden zonder te klappen', async () => {
		const set = await loadSet();
		const rng = makeRng(20260905);

		for (const level of set.levels) {
			const game = new Game(set, 2, level.num, 1234);
			const held: PlayerInput[] = [{ ...NO_INPUT }, { ...NO_INPUT }];

			for (let tick = 0; tick < 180; ++tick) {
				if (tick % 20 === 0) {
					held[0] = botInput(rng, tick);
					held[1] = botInput(rng, tick + 7);
				}
				game.advance(1 / 60, held);

				for (const e of game.world.entities) {
					expect(Number.isFinite(e.x), `level ${level.num}, entity ${e.kind}`).toBe(true);
					expect(Number.isFinite(e.y), `level ${level.num}, entity ${e.kind}`).toBe(true);
				}
			}

			// Geen entitylek: 195 tegels kunnen nooit duizenden entities opleveren.
			expect(game.world.entities.length, `level ${level.num}`).toBeLessThan(500);
		}
	}, 60_000);

	it('houdt spelers binnen het speelveld', async () => {
		const set = await loadSet();
		for (const num of [1, 20, 40, 60, 80]) {
			const game = new Game(set, 1, num, 99);
			const input: PlayerInput = { ...NO_INPUT, right: true, down: true };

			for (let tick = 0; tick < 600; ++tick) game.advance(1 / 60, [input]);

			for (const e of game.world.entities) {
				if (e.kind !== 'player') continue;
				expect(e.x, `level ${num}`).toBeGreaterThanOrEqual(32);
				expect(e.y, `level ${num}`).toBeGreaterThanOrEqual(32);
				expect(e.x, `level ${num}`).toBeLessThanOrEqual(game.world.width * 32);
				expect(e.y, `level ${num}`).toBeLessThanOrEqual(game.world.height * 32);
			}
		}
	});
});
