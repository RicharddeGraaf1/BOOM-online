import { describe, expect, it } from 'vitest';
import { createWorld, newPlayerState, parseLevelSet, type RawLevelSet } from '@boom/sim';
import gameViewSource from './gameView.ts?raw';
import { CORE_SHEETS, sheetsNeededFor } from './sheetNames.js';

/**
 * Waar dit tegen beschermt: GameView.get() gooit als een sheet niet in zijn eigen tabel
 * staat, die uitzondering breekt de ticker af, en Pixi's render hangt als volgende
 * luisteraar aan diezelfde ticker. Eén vergeten sheet levert dus geen foutmelding op maar
 * een volledig zwart scherm. Dat is precies wat er gebeurde toen de vaste sheets wél in de
 * Sheets-cache zaten maar niet in de tabel van GameView.
 */

function worldWith(tilemap: string, tileIDs = { bg: 3, border: 4, fixed: 1, breakable: 2 }) {
	const raw: RawLevelSet = {
		name: 't',
		author: 't',
		difficulty: 't',
		created: '',
		comment: '',
		tracks: [],
		enemies: Array.from({ length: 10 }, (_, i) => ({
			name: `e${i}`,
			ai: 1,
			speed: 1,
			attack: { type: ['simple'], id: 1, fireRate: 1 },
		})),
		levels: [
			{ num: 1, time: 60, music: 1, width: 5, height: 3, tileIDs, tilemap, effects: [] },
		],
	};
	const set = parseLevelSet(raw);
	const players = [1, 2, 3, 4].map((id) => newPlayerState(id, id === 1));
	return createWorld(set, 1, players, { seed: 1 });
}

describe('sheetsNeededFor', () => {
	it('bevat altijd alle vaste sheets', () => {
		const needed = new Set(sheetsNeededFor(worldWith('X00000000000000')));
		for (const file of CORE_SHEETS) expect(needed.has(file), file).toBe(true);
	});

	it('kiest de achtergrond en border die dit level voorschrijft', () => {
		const needed = sheetsNeededFor(worldWith('X00000000000000'));
		expect(needed).toContain('bg3.png');
		expect(needed).toContain('border4.png');
	});

	it('vraagt precies de vijandsheets op die in het level staan', () => {
		const needed = sheetsNeededFor(worldWith('X0A00000000J000'));
		expect(needed).toContain('enemy1.png');
		expect(needed).toContain('enemy10.png');
		expect(needed).not.toContain('enemy2.png');
	});

	it('vraagt de juiste boss-sheet op', () => {
		expect(sheetsNeededFor(worldWith('X00*00000000000'))).toContain('alien_boss.png');
		expect(sheetsNeededFor(worldWith('X00/00000000000'))).toContain('big_alien_boss.png');
	});

	/**
	 * Aanvulling op het bovenstaande: GameView mag geen sheet bij naam opvragen die niet in
	 * de vaste lijst staat. Sheets uit een sjabloon (bg1.png, enemy3.png) staan niet als
	 * letterlijke tekst in de code en worden per level geladen.
	 */
	it('vraagt geen sheet op die niet voorgeladen wordt', () => {
		const requested = [...gameViewSource.matchAll(/this\.get\('([^']+)'\)/g)].map((m) => m[1]!);
		expect(requested.length).toBeGreaterThan(5);

		const core = new Set<string>(CORE_SHEETS);
		const missing = [...new Set(requested)].filter((f) => !core.has(f));
		expect(missing, `ontbreekt in CORE_SHEETS: ${missing.join(', ')}`).toEqual([]);
	});
});
