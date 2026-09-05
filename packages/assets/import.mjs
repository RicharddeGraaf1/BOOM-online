#!/usr/bin/env node
/**
 * Haalt de assets uit een lokale BOOM/lifish-installatie naar packages/client/public/assets.
 *
 * Ze staan bewust NIET in git: de graphics, muziek en geluiden zijn IP van Factor Software
 * en zijn nergens vrijgegeven. De broncode van lifish mag je forken, de assets niet
 * herdistribueren. Iedereen die hieraan meewerkt heeft dus zelf een BOOM-installatie nodig.
 *
 *   npm run assets:import
 *   BOOM_ASSETS=/pad/naar/assets npm run assets:import
 */

import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(HERE, '..', 'client', 'public', 'assets');

const CANDIDATES = [
	process.env.BOOM_ASSETS,
	'D:/BOOM/windowsx64/assets',
	'C:/BOOM/windowsx64/assets',
	join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'BOOM', 'assets'),
].filter(Boolean);

/** Alles wat de game nodig heeft. `levels.json` is een bestand, de rest mappen. */
const WANTED = ['graphics', 'fonts', 'l10n', 'screens', 'sounds', 'music', 'levels.json'];

function findSource() {
	for (const c of CANDIDATES) {
		const p = resolve(c);
		if (existsSync(join(p, 'levels.json'))) return p;
	}
	return null;
}

/** Leest breedte en hoogte uit de IHDR-chunk van een PNG. */
async function pngSize(path) {
	const buf = await readFile(path);
	if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * Bouwt een manifest met de afmetingen van elke sprite-sheet. De renderer leidt daar
 * frame-rasters uit af zonder elke PNG eerst te hoeven decoderen, en het maakt een
 * ontbrekende of afwijkende asset meteen zichtbaar in plaats van pas bij het tekenen.
 */
async function buildManifest(graphicsDir) {
	const entries = (await readdir(graphicsDir)).filter((f) => f.toLowerCase().endsWith('.png')).sort();
	const sheets = {};
	for (const f of entries) {
		const size = await pngSize(join(graphicsDir, f));
		if (size) sheets[f] = size;
	}
	return sheets;
}

async function main() {
	const src = findSource();
	if (!src) {
		console.error('Geen BOOM-assets gevonden. Gezocht in:');
		for (const c of CANDIDATES) console.error('  ' + resolve(c));
		console.error('\nZet BOOM_ASSETS naar de assets-map van je BOOM-installatie, bijvoorbeeld:');
		console.error('  BOOM_ASSETS=D:/BOOM/windowsx64/assets npm run assets:import');
		process.exitCode = 1;
		return;
	}

	console.log(`Bron: ${src}`);
	await mkdir(DEST, { recursive: true });

	let copied = 0;
	for (const name of WANTED) {
		const from = join(src, name);
		if (!existsSync(from)) {
			console.warn(`  overgeslagen (ontbreekt): ${name}`);
			continue;
		}
		const info = await stat(from);
		await cp(from, join(DEST, name), { recursive: info.isDirectory() });
		console.log(`  ${name}${info.isDirectory() ? '/' : ''}`);
		copied++;
	}

	const sheets = await buildManifest(join(DEST, 'graphics'));
	const levelSet = JSON.parse(await readFile(join(DEST, 'levels.json'), 'utf8'));
	const manifest = {
		importedFrom: src,
		importedAt: new Date().toISOString(),
		levels: levelSet.levels.length,
		sheets,
	};
	await writeFile(join(DEST, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');

	console.log(
		`\nKlaar: ${copied} items, ${Object.keys(sheets).length} sprite-sheets, ` +
			`${levelSet.levels.length} levels → ${DEST}`,
	);
}

await main();
