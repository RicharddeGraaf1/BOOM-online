#!/usr/bin/env node
/**
 * Genereert spawnpunten voor speler 3 en 4.
 *
 * Het probleem dat dit oplost: de originele tilemaps bevatten precies één `X` en één `Y` per
 * level — over alle 80 levels samen dus 80 en 80. Er is fysiek geen plek aangewezen voor
 * speler 3 en 4. Dit script kiest er twee bij, met dezelfde criteria die een levelontwerper
 * zou hanteren:
 *
 *   - de tegel is leeg;
 *   - de tegel heeft minstens twee begaanbare buren, zodat je niet vastzit bij de start;
 *   - hij ligt zo ver mogelijk van de bestaande spawns én van elkaar;
 *   - er staat bij voorkeur geen vijand vlakbij.
 *
 * Dat laatste is een voorkeur en geen eis. In een level als 6 staan dertien vijanden op
 * 195 tegels; daar is geen enkele plek drie tegels van alles vandaan, ook de originele
 * spawns niet. Het script zakt daarom net zo lang in eisen tot er twee plekken overblijven,
 * en meldt per level welke drempel het gehaald heeft.
 *
 * Het resultaat gaat naar levels4p.json; levels.json blijft ongemoeid. Er wordt uitsluitend
 * op lege tegels geschreven, dus geen munt, teleport, muur of vijand raakt kwijt — dat wordt
 * ook als test afgedwongen.
 *
 * Wat dit script NIET doet is balanceren: vier spelers met vier bommensets maken de originele
 * levels een stuk makkelijker. Dat is een aparte afweging.
 *
 *   node packages/assets/spawns.mjs
 *   node packages/assets/spawns.mjs --report
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'client', 'public', 'assets');
const SOURCE = join(ASSETS, 'levels.json');
const TARGET = join(ASSETS, 'levels4p.json');

/** Tekens uit entity_type.cpp, plus onze eigen Z en W voor speler 3 en 4. */
const EMPTY = '0';
const SPAWN3 = 'Z';
const SPAWN4 = 'W';
/**
 * Wat een tegel onbegaanbaar maakt: vaste en breekbare muren, en de twee bosses die
 * meerdere tegels beslaan. Munten en teleports NIET — daar loop je gewoon overheen. Dat
 * verschil is niet academisch: level 65 en 66 liggen bezaaid met munten, en zolang die als
 * muur telden had daar geen enkele tegel genoeg vrije buren.
 */
const BLOCKING = new Set(['1', '2', '*', '/']);
const ENEMIES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

const idx = (x, y, w) => y * w + x;

function neighbours(x, y, w, h) {
	const out = [];
	if (x > 0) out.push([x - 1, y]);
	if (x < w - 1) out.push([x + 1, y]);
	if (y > 0) out.push([x, y - 1]);
	if (y < h - 1) out.push([x, y + 1]);
	return out;
}

function findExisting(tiles, w, ch) {
	const i = tiles.indexOf(ch);
	return i < 0 ? null : { x: i % w, y: Math.floor(i / w) };
}

/** Manhattanafstand tot de dichtstbijzijnde van een lijst punten. */
function minDistance(x, y, points) {
	let best = Infinity;
	for (const p of points) best = Math.min(best, Math.abs(p.x - x) + Math.abs(p.y - y));
	return best;
}

/** Drempels voor de afstand tot de dichtstbijzijnde vijand, van ruim naar krap. */
const ENEMY_CLEARANCE = [3, 2, 1, 0];

function pickSpawns(level) {
	const w = level.width;
	const h = level.height;
	const tiles = [...level.tilemap];

	const taken = [findExisting(tiles, w, 'X'), findExisting(tiles, w, 'Y')].filter(Boolean);
	const enemies = [];
	for (let i = 0; i < tiles.length; ++i) {
		if (ENEMIES.has(tiles[i])) enemies.push({ x: i % w, y: Math.floor(i / w) });
	}

	const open = [];
	for (let y = 0; y < h; ++y) {
		for (let x = 0; x < w; ++x) {
			if (tiles[idx(x, y, w)] !== EMPTY) continue;

			const free = neighbours(x, y, w, h).filter(
				(n) => !BLOCKING.has(tiles[idx(n[0], n[1], w)]),
			).length;
			if (free < 2) continue;

			open.push({ x, y, enemyDist: minDistance(x, y, enemies) });
		}
	}

	// Zak in eisen tot er twee plekken overblijven. Zo krijgt een ruim level ruime spawns
	// en een druk level in elk geval spawns.
	for (const clearance of ENEMY_CLEARANCE) {
		const candidates = open.filter((c) => c.enemyDist >= clearance);
		if (candidates.length < 2) continue;

		// Eerst de tegel die het verst van de bestaande spawns ligt; bij gelijke stand die
		// met de meeste lucht rond zich.
		const byDistance = (list, from) =>
			[...list].sort((a, b) => {
				const d = minDistance(b.x, b.y, from) - minDistance(a.x, a.y, from);
				return d !== 0 ? d : b.enemyDist - a.enemyDist;
			});

		const third = byDistance(candidates, taken)[0];
		const fourth = byDistance(
			candidates.filter((c) => c !== third),
			[...taken, third],
		)[0];
		if (!fourth) continue;

		return { third, fourth, clearance };
	}

	return null;
}

async function main() {
	if (!existsSync(SOURCE)) {
		console.error(`levels.json niet gevonden op ${SOURCE}.`);
		console.error('Draai eerst: npm run assets:import');
		process.exitCode = 1;
		return;
	}

	const set = JSON.parse(await readFile(SOURCE, 'utf8'));
	const report = process.argv.includes('--report');

	let done = 0;
	const failed = [];
	const tight = [];

	for (const level of set.levels) {
		const picked = pickSpawns(level);
		if (!picked) {
			failed.push(level.num);
			continue;
		}
		const tiles = [...level.tilemap];
		tiles[idx(picked.third.x, picked.third.y, level.width)] = SPAWN3;
		tiles[idx(picked.fourth.x, picked.fourth.y, level.width)] = SPAWN4;
		level.tilemap = tiles.join('');
		done++;
		if (picked.clearance < 3) tight.push(`${level.num} (${picked.clearance})`);

		if (report) {
			console.log(
				`level ${String(level.num).padStart(2)}: speler 3 op (${picked.third.x},${picked.third.y}), ` +
					`speler 4 op (${picked.fourth.x},${picked.fourth.y}), ` +
					`vijand op ${picked.clearance} tegel${picked.clearance === 1 ? '' : 's'} afstand`,
			);
		}
	}

	set.comment = `${set.comment ?? ''} · spawnpunten voor speler 3 en 4 toegevoegd door spawns.mjs`.trim();
	await writeFile(TARGET, JSON.stringify(set, null, '\t') + '\n');

	console.log(`${done} van de ${set.levels.length} levels voorzien van vier spawnpunten.`);
	if (tight.length)
		console.log(
			`Krap, vijand dichterbij dan drie tegels — level (afstand): ${tight.join(', ')}`,
		);
	if (failed.length) console.log(`Niet gelukt voor level: ${failed.join(', ')}`);
	console.log(`Geschreven naar ${TARGET}`);
	console.log('Het spel schakelt hier vanzelf op over zodra er een derde speler meedoet.');
}

await main();
