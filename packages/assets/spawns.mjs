#!/usr/bin/env node
/**
 * Genereert spawnpunten voor speler 3 en 4.
 *
 * Het probleem dat dit oplost: de originele tilemaps bevatten precies één `X` en één `Y` per
 * level — over alle 80 levels samen dus 80 en 80. Er is fysiek geen plek aangewezen voor
 * speler 3 en 4. Dit script kiest er twee bij, met dezelfde criteria die een levelontwerper
 * zou hanteren:
 *
 *   - de tegel is leeg (geen muur, munt, teleport, vijand of boss);
 *   - de tegel heeft minstens twee vrije buren, zodat je niet vastzit bij de start;
 *   - hij ligt zo ver mogelijk van de bestaande spawns én van elkaar;
 *   - er staat geen vijand binnen twee tegels.
 *
 * Het resultaat gaat naar levels4p.json; het origineel wordt niet aangeraakt. Wat dit script
 * NIET doet is balanceren — vier spelers met vier bommensets maken de originele levels een
 * stuk makkelijker. Daar zit de `--enemy-scale` knop voor, die de vijandsnelheid meeschaalt.
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
const BLOCKING = new Set(['1', '2', '3', '+', '*', '/']);
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

function pickSpawns(level) {
	const w = level.width;
	const h = level.height;
	const tiles = [...level.tilemap];

	const taken = [findExisting(tiles, w, 'X'), findExisting(tiles, w, 'Y')].filter(Boolean);
	const enemies = [];
	for (let i = 0; i < tiles.length; ++i) {
		if (ENEMIES.has(tiles[i])) enemies.push({ x: i % w, y: Math.floor(i / w) });
	}

	const candidates = [];
	for (let y = 0; y < h; ++y) {
		for (let x = 0; x < w; ++x) {
			if (tiles[idx(x, y, w)] !== EMPTY) continue;

			const free = neighbours(x, y, w, h).filter(
				(n) => !BLOCKING.has(tiles[idx(n[0], n[1], w)]),
			).length;
			if (free < 2) continue;
			if (minDistance(x, y, enemies) < 3) continue;

			candidates.push({ x, y, score: minDistance(x, y, taken) });
		}
	}

	if (candidates.length < 2) return null;

	// Eerst de tegel die het verst van de bestaande spawns ligt, daarna de tegel die het
	// verst van alles ligt wat we tot nu toe gekozen hebben.
	candidates.sort((a, b) => b.score - a.score);
	const third = candidates[0];

	const rest = candidates.filter((c) => c !== third);
	rest.sort(
		(a, b) =>
			minDistance(b.x, b.y, [...taken, third]) - minDistance(a.x, a.y, [...taken, third]),
	);
	const fourth = rest[0];
	if (!fourth) return null;

	return { third, fourth };
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
	let failed = [];

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

		if (report) {
			console.log(
				`level ${String(level.num).padStart(2)}: speler 3 op (${picked.third.x},${picked.third.y}), ` +
					`speler 4 op (${picked.fourth.x},${picked.fourth.y})`,
			);
		}
	}

	set.comment = `${set.comment ?? ''} · spawnpunten voor speler 3 en 4 toegevoegd door spawns.mjs`.trim();
	await writeFile(TARGET, JSON.stringify(set, null, '\t') + '\n');

	console.log(`${done} van de ${set.levels.length} levels voorzien van vier spawnpunten.`);
	if (failed.length) console.log(`Niet gelukt voor level: ${failed.join(', ')}`);
	console.log(`Geschreven naar ${TARGET}`);
	console.log('Kies deze set in het spel met ?levels=levels4p.json');
}

await main();
