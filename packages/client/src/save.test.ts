import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newPlayerState } from '@boom/sim';
import { clearSave, describeSave, loadGame, saveGame } from './save.js';

/** localStorage bestaat niet in Node; een map is genoeg voor wat deze module ermee doet. */
function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k: string) => map.get(k) ?? null,
		key: (i: number) => [...map.keys()][i] ?? null,
		removeItem: (k: string) => void map.delete(k),
		setItem: (k: string, v: string) => void map.set(k, v),
	} as Storage;
}

beforeEach(() => {
	vi.stubGlobal('localStorage', fakeStorage());
});

const players = () => [1, 2, 3, 4].map((id) => newPlayerState(id, id === 1));

describe('opslaan en laden', () => {
	it('geeft null als er niets opgeslagen is', () => {
		expect(loadGame()).toBeNull();
	});

	it('haalt terug wat er opgeslagen is', () => {
		const ps = players();
		ps[0]!.score = 4200;
		saveGame(12, 1, ps);

		const save = loadGame();
		expect(save?.levelNum).toBe(12);
		expect(save?.nPlayers).toBe(1);
		expect(save?.players[0]?.score).toBe(4200);
	});

	it('slaat een kopie op, geen verwijzing naar levende spelstaat', () => {
		const ps = players();
		saveGame(3, 1, ps);
		ps[0]!.score = 999;
		ps[0]!.letters[0] = true;

		const save = loadGame();
		expect(save?.players[0]?.score).toBe(0);
		expect(save?.players[0]?.letters[0]).toBe(false);
	});

	it('negeert een opslag van een oudere versie', () => {
		localStorage.setItem('boom-online:save', JSON.stringify({ version: 0, levelNum: 5 }));
		expect(loadGame()).toBeNull();
	});

	it('negeert onleesbare rommel in plaats van te klappen', () => {
		localStorage.setItem('boom-online:save', 'geen json');
		expect(loadGame()).toBeNull();
	});

	it('wist de opslag', () => {
		saveGame(7, 1, players());
		clearSave();
		expect(loadGame()).toBeNull();
	});

	it('beschrijft de opslag met level en score', () => {
		const ps = players();
		ps[0]!.score = 1500;
		saveGame(9, 1, ps);
		const text = describeSave(loadGame()!);
		expect(text).toContain('Level 9');
		expect(text).toContain('1500');
	});

	it('overleeft opslag die weigert te schrijven', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota');
			},
			removeItem: () => undefined,
		} as unknown as Storage);
		expect(() => saveGame(1, 1, players())).not.toThrow();
	});
});
