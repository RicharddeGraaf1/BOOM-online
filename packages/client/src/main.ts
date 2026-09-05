/**
 * Fase 0 — level-viewer.
 *
 * Doel is niet spelen maar controleren: klopt de asset-pipeline, klopt de geometrie, en is het
 * beeld op elk scherm kraakhelder? Met de pijltjestoetsen loop je door alle 80 levels heen, wat
 * meteen alle 8 varianten van bg, border, fixed en breakable langskomt.
 */

import { Application, Container, Graphics, Sprite } from 'pixi.js';
import {
	GAME_HEIGHT,
	GAME_ORIGIN_X,
	GAME_WIDTH,
	TILE_SIZE,
	parseLevelSet,
	type Level,
	type LevelSet,
	type RawLevelSet,
} from '@boom/sim';
import { BASE_HEIGHT, BASE_WIDTH, computeScaling } from './render/scaling.js';
import { loadManifest, loadSheet, useNearestNeighbour } from './render/textures.js';
import { buildLevelView } from './render/levelView.js';

const stageEl = document.querySelector<HTMLElement>('#stage')!;
const hudLevel = document.querySelector<HTMLElement>('#hud-level')!;
const hudScale = document.querySelector<HTMLElement>('#hud-scale')!;

function fail(message: string): never {
	stageEl.innerHTML = `<pre style="color:#e06c75;white-space:pre-wrap;padding:2rem">${message}</pre>`;
	throw new Error(message);
}

async function loadLevelSet(): Promise<LevelSet> {
	const res = await fetch('assets/levels.json');
	if (!res.ok) throw new Error('assets/levels.json ontbreekt — draai `npm run assets:import`.');
	return parseLevelSet((await res.json()) as RawLevelSet);
}

async function main(): Promise<void> {
	useNearestNeighbour();

	let levelSet: LevelSet;
	try {
		await loadManifest();
		levelSet = await loadLevelSet();
	} catch (e) {
		fail(
			`${e instanceof Error ? e.message : String(e)}\n\n` +
				'De assets staan bewust niet in de repo (IP van Factor Software).\n' +
				'Draai in de repo-root:  npm run assets:import',
		);
	}

	const app = new Application();
	await app.init({
		backgroundColor: 0x000000,
		antialias: false,
		// Wij bepalen de resolutie zelf; Pixi mag niet zelf met devicePixelRatio gaan rekenen.
		resolution: 1,
		autoDensity: false,
		width: BASE_WIDTH,
		height: BASE_HEIGHT,
	});
	stageEl.appendChild(app.canvas);

	/** Alles binnen `world` rekent in game-pixels; `world.scale` is altijd een heel getal. */
	const world = new Container();
	app.stage.addChild(world);

	// Zijpaneel links (96x480), speelveld rechts daarvan op x = 96. src/main.cpp:261.
	const panel = new Sprite(await loadSheet('panel.png'));
	world.addChild(panel);

	const gameArea = new Container();
	gameArea.x = GAME_ORIGIN_X;
	world.addChild(gameArea);

	const guides = new Graphics();
	guides.visible = false;
	drawGuides(guides);
	gameArea.addChild(guides);

	let levelView: Container | null = null;

	async function showLevel(level: Level): Promise<void> {
		const next = await buildLevelView(level);
		if (levelView) {
			gameArea.removeChild(levelView);
			levelView.destroy({ children: true });
		}
		levelView = next;
		gameArea.addChildAt(next, 0);
		hudLevel.textContent = `Level ${level.num} / ${levelSet.levels.length}  ·  bg ${level.tileIDs.bg} border ${level.tileIDs.border} fixed ${level.tileIDs.fixed} breakable ${level.tileIDs.breakable}  ·  ${level.time}s`;
	}

	function resize(): void {
		const s = computeScaling(stageEl.clientWidth, stageEl.clientHeight, window.devicePixelRatio || 1);
		app.renderer.resize(s.bufferWidth, s.bufferHeight);
		app.canvas.style.width = `${s.cssWidth}px`;
		app.canvas.style.height = `${s.cssHeight}px`;
		world.scale.set(s.scale);
		hudScale.textContent = `${BASE_WIDTH}x${BASE_HEIGHT} @ ${s.scale}x  ·  dpr ${window.devicePixelRatio || 1}`;
	}

	let index = 0;
	await showLevel(levelSet.levels[0]!);
	resize();

	new ResizeObserver(resize).observe(stageEl);

	window.addEventListener('keydown', (e) => {
		const n = levelSet.levels.length;
		if (e.key === 'ArrowRight') index = (index + 1) % n;
		else if (e.key === 'ArrowLeft') index = (index - 1 + n) % n;
		else if (e.key.toLowerCase() === 'h') {
			guides.visible = !guides.visible;
			return;
		} else return;
		e.preventDefault();
		void showLevel(levelSet.levels[index]!);
	});
}

/** Hulplijnen op het 32px-raster, om de geometrie tegen het origineel te kunnen leggen. */
function drawGuides(g: Graphics): void {
	for (let x = 0; x <= GAME_WIDTH; x += TILE_SIZE) {
		g.moveTo(x, 0).lineTo(x, GAME_HEIGHT);
	}
	for (let y = 0; y <= GAME_HEIGHT; y += TILE_SIZE) {
		g.moveTo(0, y).lineTo(GAME_WIDTH, y);
	}
	g.stroke({ width: 1, color: 0x00ff88, alpha: 0.3 });
	g.zIndex = 2000;
}

void main();
