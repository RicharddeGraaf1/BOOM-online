/**
 * De app: laden, menu's, de spellus en de koppeling met de server.
 *
 * De spellus zelf staat in `@boom/sim` (Game.advance). Hier gebeurt alleen wat de browser
 * aangaat: invoer lezen, tekenen, geluid afspelen en schermen omschakelen.
 */

import { Application, Container } from 'pixi.js';
import {
	Game,
	GAME_ORIGIN_X,
	bombsAvailable,
	parseLevelSet,
	type LevelSet,
	type LevelSets,
	type PlayerInput,
	type RawLevelSet,
	type World,
} from '@boom/sim';
import { BASE_HEIGHT, BASE_WIDTH, computeScaling } from './render/scaling.js';
import { CORE_SHEETS, Sheets, type RenderMode } from './render/sheets.js';
import { GameView } from './render/gameView.js';
import { Hud, loadPanelFont } from './render/hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { NetClient } from './net.js';

type Screen = 'title' | 'join' | 'lobby' | 'pause' | 'options' | 'gameover' | 'none';
type Mode = 'local' | 'online';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

const stageEl = $('#stage');
const overlay = $('#overlay');
const hudStatus = $('#hud-status');
const hudScale = $('#hud-scale');
const toastEl = $('#toast');

const SCREENS: Record<Exclude<Screen, 'none'>, string> = {
	title: '#screen-title',
	join: '#screen-join',
	lobby: '#screen-lobby',
	pause: '#screen-pause',
	options: '#screen-options',
	gameover: '#screen-gameover',
};

const STORAGE_KEY = 'boom-online:settings';

interface Settings {
	mode: RenderMode;
	sfx: number;
	music: number;
	/** venster vullen met een niet-hele schaalfactor */
	fill: boolean;
}

function loadSettings(): Settings {
	const fallback: Settings = { mode: 'crisp', sfx: 60, music: 35, fill: false };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return fallback;
		return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) };
	} catch {
		return fallback;
	}
}

function saveSettings(s: Settings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
	} catch {
		// Privémodus of geblokkeerde opslag: dan onthouden we het gewoon niet.
	}
}

function fail(message: string): never {
	stageEl.innerHTML = `<pre style="color:#ff6a3d;white-space:pre-wrap;padding:2rem;max-width:60ch">${message}</pre>`;
	overlay.hidden = true;
	throw new Error(message);
}

async function fetchSet(file: string): Promise<LevelSet | undefined> {
	const res = await fetch(`assets/${file}`);
	if (!res.ok) return undefined;
	return parseLevelSet((await res.json()) as RawLevelSet);
}

/**
 * Beide sets laden. Tot twee spelers speel je de originele maps, precies zoals ze zijn; pas
 * vanaf drie schakelt de sim over naar de set met de gegenereerde spawnpunten
 * (packages/assets/spawns.mjs). Die keuze valt in @boom/sim, zodat de browser en de server
 * hem op dezelfde manier maken.
 */
async function loadLevelSets(): Promise<LevelSets> {
	const original = await fetchSet('levels.json');
	if (!original) throw new Error('assets/levels.json ontbreekt');

	const fourPlayer = await fetchSet('levels4p.json');
	return fourPlayer ? { original, fourPlayer } : { original };
}

async function boot(): Promise<void> {
	let sets: LevelSets;
	try {
		sets = await loadLevelSets();
	} catch (e) {
		fail(
			`${e instanceof Error ? e.message : String(e)}\n\n` +
				'De assets staan bewust niet in de repo (IP van Factor Software).\n' +
				'Draai in de repo-root:  npm run assets:import',
		);
	}

	const settings = loadSettings();

	const app = new Application();
	await app.init({
		backgroundColor: 0x000000,
		antialias: false,
		// Wij bepalen de resolutie zelf; Pixi mag niet zelf met devicePixelRatio rekenen.
		resolution: 1,
		autoDensity: false,
		width: BASE_WIDTH,
		height: BASE_HEIGHT,
	});
	stageEl.appendChild(app.canvas);

	await loadPanelFont();

	/** Alles binnen `world` rekent in spelpixels; de schaal is altijd een heel getal. */
	const worldLayer = new Container();
	app.stage.addChild(worldLayer);

	const audio = new Audio();
	audio.setSfxVolume(settings.sfx / 100);
	audio.setMusicVolume(settings.music / 100);

	const input = new Input();

	// ── Renderonderdelen die bij een modewissel opnieuw gebouwd worden ──
	let sheets: Sheets;
	let gameView: GameView;
	let hud: Hud;
	let hudLayer: Container;
	let renderedWorld: World | null = null;

	let game: Game | null = null;
	let mode: Mode = 'local';
	let net: NetClient | null = null;
	let screen: Screen = 'title';
	let paused = false;

	async function buildRenderer(renderMode: RenderMode): Promise<void> {
		worldLayer.removeChildren();
		sheets = new Sheets(renderMode);
		await sheets.preload(CORE_SHEETS);

		hud = new Hud(sheets);
		await hud.build();
		hudLayer = hud.root;

		gameView = new GameView(sheets, () => game!.world);
		gameView.root.x = GAME_ORIGIN_X;

		worldLayer.addChild(hudLayer, gameView.root);
		renderedWorld = null;
	}

	await buildRenderer(settings.mode);

	// ── Schermen ──────────────────────────────────────────────────────
	function show(next: Screen): void {
		screen = next;
		overlay.hidden = next === 'none';
		for (const [name, sel] of Object.entries(SCREENS)) {
			$(sel).hidden = name !== next;
		}
	}

	function status(text: string): void {
		hudStatus.textContent = text;
	}

	function toast(text: string | null): void {
		toastEl.hidden = text === null;
		if (text !== null) toastEl.textContent = text;
	}

	// ── Beeldschaal ───────────────────────────────────────────────────
	function resize(): void {
		const s = computeScaling(
			stageEl.clientWidth,
			stageEl.clientHeight,
			window.devicePixelRatio || 1,
			settings.fill,
		);
		app.renderer.resize(s.bufferWidth, s.bufferHeight);
		app.canvas.style.width = `${s.cssWidth}px`;
		app.canvas.style.height = `${s.cssHeight}px`;
		worldLayer.scale.set(s.scale);

		const factor = Number.isInteger(s.scale) ? `${s.scale}x` : `${s.scale.toFixed(2)}x`;
		hudScale.textContent = `${BASE_WIDTH}x${BASE_HEIGHT} @ ${factor} · ${settings.mode === 'crisp' ? 'scherp' : 'glad'}`;
	}

	function toggleFullscreen(): void {
		// Volledig scherm op het document en niet op het canvas: anders vallen de menu's en de
		// statusregel buiten het schermvullende element en zie je ze niet meer.
		if (document.fullscreenElement) void document.exitFullscreen();
		else void document.documentElement.requestFullscreen?.().catch(() => undefined);
	}
	new ResizeObserver(resize).observe(stageEl);
	resize();

	// ── Spel starten ──────────────────────────────────────────────────
	async function startLocal(nPlayers: number): Promise<void> {
		mode = 'local';
		net?.disconnect();
		net = null;
		game = new Game({
			levelSet: sets.original,
			...(sets.fourPlayer ? { fourPlayerSet: sets.fourPlayer } : {}),
			nPlayers,
		});
		paused = false;
		await audio.unlock();
		show('none');
		status(`Level ${game.world.levelNum}`);
	}

	function startOnline(room: string): void {
		mode = 'online';
		game = null;
		net = new NetClient(sets, {
			onPhase: (phase, detail) => {
				if (phase === 'lobby') {
					show('lobby');
					renderLobby();
				} else if (phase === 'playing') {
					show('none');
				} else if (phase === 'error') {
					$('#join-error').textContent = detail ?? 'er ging iets mis';
					show('join');
				} else if (phase === 'closed' && screen === 'none') {
					status('Verbinding verbroken');
					show('title');
				}
			},
			onLobby: renderLobby,
			onLevel: (g) => {
				game = g;
				void audio.unlock();
			},
		});
		net.connect(room, 'Speler');
	}

	function renderLobby(): void {
		if (!net) return;
		$('#lobby-code').textContent = net.room || '····';
		const url = new URL(location.href);
		url.searchParams.set('room', net.room);
		$<HTMLInputElement>('#lobby-link').value = url.toString();

		const list = $('#lobby-members');
		list.innerHTML = '';
		for (const m of net.lobby.members) {
			const li = document.createElement('li');
			const name = document.createElement('span');
			name.textContent = `${m.name}${m.playerId === net.playerId ? ' (jij)' : ''}`;
			const state = document.createElement('span');
			state.className = 'state';
			state.textContent = `speler ${m.playerId}`;
			state.classList.toggle('ready', m.ready);
			li.append(name, state);
			list.appendChild(li);
		}
		const n = net.lobby.members.length;
		const start = $<HTMLButtonElement>('#start-game');
		start.disabled = n === 0;
		start.textContent = n === 1 ? 'Starten (alleen)' : `Starten met ${n} spelers`;
	}

	function quitToMenu(): void {
		toast(null);
		net?.disconnect();
		net = null;
		game = null;
		renderedWorld = null;
		audio.stopMusic();
		show('title');
		status('Klaar');
	}

	// ── Knoppen ───────────────────────────────────────────────────────
	overlay.addEventListener('click', (ev) => {
		const target = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
		if (!target) return;
		const action = target.dataset['action'];

		switch (action) {
			case 'solo':
				void startLocal(1);
				break;
			case 'coop-local':
				void startLocal(Number(target.dataset['players'] ?? 2));
				break;
			case 'host':
				startOnline('');
				break;
			case 'join':
				$('#join-error').textContent = '';
				show('join');
				break;
			case 'join-go': {
				const code = $<HTMLInputElement>('#room-code').value.trim().toUpperCase();
				if (code.length !== 4) {
					$('#join-error').textContent = 'Een kamercode is vier tekens lang.';
					return;
				}
				startOnline(code);
				break;
			}
			case 'copy-link':
				void navigator.clipboard?.writeText($<HTMLInputElement>('#lobby-link').value);
				break;
			case 'start-game':
				net?.start(Math.max(1, net.lobby.members.length));
				break;
			case 'leave':
				quitToMenu();
				break;
			case 'resume':
				paused = false;
				show('none');
				break;
			case 'options':
				syncOptions();
				show('options');
				break;
			case 'back':
				show(game && paused ? 'pause' : 'title');
				break;
			case 'quit':
				quitToMenu();
				break;
			case 'fullscreen':
				toggleFullscreen();
				break;
			default:
				break;
		}
	});

	// ── Instellingen ──────────────────────────────────────────────────
	function syncOptions(): void {
		for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
			radio.checked = radio.value === settings.mode;
		}
		$<HTMLInputElement>('#vol-sfx').value = String(settings.sfx);
		$<HTMLInputElement>('#vol-music').value = String(settings.music);
		$<HTMLInputElement>('#opt-fill').checked = settings.fill;
	}

	for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
		radio.addEventListener('change', () => {
			if (!radio.checked) return;
			settings.mode = radio.value as RenderMode;
			// In de gladde modus kost een niet-hele factor niets, dus die zetten we aan. Bij
			// terugschakelen laten we de keuze staan: die was misschien bewust.
			if (settings.mode === 'smooth') settings.fill = true;
			$<HTMLInputElement>('#opt-fill').checked = settings.fill;
			saveSettings(settings);
			status('Beeldmodus omzetten…');
			void buildRenderer(settings.mode).then(() => {
				resize();
				status(game ? `Level ${game.world.levelNum}` : 'Klaar');
			});
		});
	}

	$<HTMLInputElement>('#opt-fill').addEventListener('change', (ev) => {
		settings.fill = (ev.target as HTMLInputElement).checked;
		saveSettings(settings);
		resize();
	});

	$<HTMLInputElement>('#vol-sfx').addEventListener('input', (ev) => {
		settings.sfx = Number((ev.target as HTMLInputElement).value);
		audio.setSfxVolume(settings.sfx / 100);
		saveSettings(settings);
	});
	$<HTMLInputElement>('#vol-music').addEventListener('input', (ev) => {
		settings.music = Number((ev.target as HTMLInputElement).value);
		audio.setMusicVolume(settings.music / 100);
		saveSettings(settings);
	});

	// ── Spellus ───────────────────────────────────────────────────────
	/**
	 * Een uitzondering in deze callback breekt de hele ticker af — óók Pixi's eigen render,
	 * want die hangt eraan als volgende luisteraar. Het gevolg is een zwart scherm zonder
	 * enige aanwijzing. Daarom vangen we hier af en zetten we de fout in de statusregel;
	 * één keer per boodschap, anders loopt de console vol met zestig regels per seconde.
	 */
	let lastError = '';
	function reportError(err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		if (message === lastError) return;
		lastError = message;
		console.error(err);
		status(`Fout tijdens tekenen: ${message}`);
	}

	app.ticker.add((ticker) => {
		try {
			frame(ticker);
		} catch (err) {
			reportError(err);
		}
	});

	function frame(ticker: { deltaMS: number }): void {
		if (input.justPressed('KeyF')) toggleFullscreen();

		if (input.justPressed('Escape') && game) {
			paused = !paused;
			show(paused ? 'pause' : 'none');
		}

		if (game && !paused && screen === 'none') {
			const dt = ticker.deltaMS / 1000;

			// Online bestuurt elke speler alleen zijn eigen slot; lokaal delen twee spelers
			// het toetsenbord. Voor de andere slots stuurt de client niets — die komen via
			// de snapshots binnen.
			const inputs: (PlayerInput | undefined)[] = [];
			if (mode === 'online' && net) {
				for (let id = 1; id <= 4; ++id)
					inputs.push(id === net.playerId ? input.read(1) : undefined);
			} else {
				for (let id = 1; id <= 4; ++id)
					inputs.push(id <= game.nPlayers ? input.read(id as 1 | 2 | 3 | 4) : undefined);
			}

			if (mode === 'online' && net) net.sendInput(game.world.tick, input.read(1));

			const steps = game.advance(dt, inputs);
			if (steps > 0) {
				for (const ev of game.world.events) {
					if (ev.t === 'sound') audio.play(ev.name);
				}
			}

			// Wie halverwege binnenkomt kijkt mee tot de levelwissel; dat moet je wel weten,
			// anders zit je te drukken op een poppetje dat er niet is.
			toast(
				mode === 'online' && net?.waitingForNextLevel
					? 'Je kijkt mee — je doet mee vanaf het volgende level'
					: null,
			);

			void syncLevel(game);
			gameView.draw(settings.mode === 'crisp');
			hud.update(game.world, (id) => bombsAvailable(game!.world, id));

			if (game.phase === 'gameover') {
				$('#gameover-title').textContent = 'Game over';
				$('#gameover-score').textContent = game.players
					.filter((p) => p.present)
					.map((p) => `Speler ${p.id}: ${p.score} punten`)
					.join(' · ');
				show('gameover');
			}
		}

		input.endFrame();
	}

	let levelLoading = false;
	async function syncLevel(g: Game): Promise<void> {
		if (renderedWorld === g.world || levelLoading) return;
		levelLoading = true;
		try {
			renderedWorld = g.world;
			await gameView.prepareLevel(g.world);
			void audio.playMusic(g.track);
			status(`Level ${g.world.levelNum}`);
		} catch (err) {
			// Blijft dit hangen, dan zie je niets meer; dus melden en opnieuw laten proberen.
			renderedWorld = null;
			reportError(err);
		} finally {
			levelLoading = false;
		}
	}

	// Zonder gegenereerde spawnpunten kunnen speler 3 en 4 nergens staan. Dan die knoppen
	// niet aanbieden, in plaats van ze te laten mislukken zonder uitleg.
	if (!sets.fourPlayer) {
		for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-players]')) {
			if (Number(btn.dataset['players']) <= 2) continue;
			btn.disabled = true;
			btn.title = 'Draai eerst `npm run spawns` om spawnpunten voor speler 3 en 4 te maken.';
		}
	}

	// Direct in een kamer vallen als de link er een noemt.
	const roomParam = new URLSearchParams(location.search).get('room');
	if (roomParam) {
		$<HTMLInputElement>('#room-code').value = roomParam.toUpperCase();
		startOnline(roomParam.toUpperCase());
	} else {
		show('title');
		status('Klaar');
	}
}

void boot();
