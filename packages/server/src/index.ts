/**
 * De BOOM Online-server.
 *
 * Twee taken in één proces: hij serveert de gebouwde client als statische bestanden en hij
 * beheert de kamers. Dat is bewust: met één service op Railway heb je geen CORS, geen aparte
 * WebSocket-host en geen tweede deploy.
 *
 * Let op bij deployen: de assets zitten niet in de repo (IP van Factor Software). Zorg dat
 * `packages/client/dist/assets` gevuld is voordat je bouwt, of zet BOOM_ASSETS naar een map
 * met levels.json.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
	NO_INPUT,
	parseLevelSet,
	type ClientMessage,
	type LevelSet,
	type RawLevelSet,
	type ServerMessage,
} from '@boom/sim';
import { EMPTY_ROOM_TTL_MS, Room } from './room.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLIENT_DIST = resolve(HERE, '../../client/dist');
const PORT = Number(process.env.PORT ?? 8080);

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.ttf': 'font/ttf',
	'.svg': 'image/svg+xml',
};

// ── Levels ──────────────────────────────────────────────────────────────

async function loadLevelSet(): Promise<LevelSet> {
	// levels4p.json eerst: dat is dezelfde set plus de spawnpunten voor speler 3 en 4, en
	// voor één of twee spelers gedraagt hij zich identiek. De client kiest in dezelfde
	// volgorde — een verschil hier zou meteen een desync opleveren.
	const candidates = [
		process.env.BOOM_LEVELS,
		join(CLIENT_DIST, 'assets', 'levels4p.json'),
		join(CLIENT_DIST, 'assets', 'levels.json'),
		resolve(HERE, '../../client/public/assets/levels4p.json'),
		resolve(HERE, '../../client/public/assets/levels.json'),
	].filter((c): c is string => Boolean(c));

	for (const path of candidates) {
		if (!existsSync(path)) continue;
		const raw = JSON.parse(await readFile(path, 'utf8')) as RawLevelSet;
		console.log(`[boom] levels geladen uit ${path} (${raw.levels.length} levels)`);
		return parseLevelSet(raw);
	}

	throw new Error(
		'Geen levels.json gevonden. Draai `npm run assets:import` of zet BOOM_LEVELS.\nGezocht in:\n  ' +
			candidates.join('\n  '),
	);
}

// ── Statische bestanden ─────────────────────────────────────────────────

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
	const url = new URL(req.url ?? '/', 'http://localhost');
	let path = decodeURIComponent(url.pathname);
	if (path === '/') path = '/index.html';

	// Geen pad-escapes: alles moet binnen CLIENT_DIST blijven.
	const target = join(CLIENT_DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
	if (!target.startsWith(CLIENT_DIST)) {
		res.writeHead(403).end('verboden');
		return;
	}

	if (!existsSync(target) || !statSync(target).isFile()) {
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
		res.end(
			existsSync(CLIENT_DIST)
				? 'niet gevonden'
				: 'De client is nog niet gebouwd. Draai eerst: npm run build',
		);
		return;
	}

	res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
	createReadStream(target).pipe(res);
}

// ── Kamers ──────────────────────────────────────────────────────────────

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // zonder I/O/0/1

function newRoomCode(rooms: Map<string, Room>): string {
	for (let attempt = 0; attempt < 100; ++attempt) {
		let code = '';
		for (let i = 0; i < 4; ++i)
			code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
		if (!rooms.has(code)) return code;
	}
	throw new Error('geen vrije kamercode gevonden');
}

async function main(): Promise<void> {
	const levelSet = await loadLevelSet();
	const rooms = new Map<string, Room>();

	const http = createServer(serveStatic);
	const wss = new WebSocketServer({ server: http, path: '/ws' });

	wss.on('connection', (ws: WebSocket) => {
		let room: Room | null = null;
		let playerId = 0;

		const send = (msg: ServerMessage): void => {
			if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
		};

		ws.on('message', (data) => {
			let msg: ClientMessage;
			try {
				msg = JSON.parse(String(data)) as ClientMessage;
			} catch {
				return;
			}

			switch (msg.t) {
				case 'hello': {
					if (room) return;
					const code = msg.room.trim().toUpperCase() || newRoomCode(rooms);

					let target = rooms.get(code);
					if (!target) {
						target = new Room(code, levelSet);
						rooms.set(code, target);
					}

					const slot = target.freeSlot();
					if (slot === null) {
						send({ t: 'error', message: `Kamer ${code} zit vol.` });
						ws.close();
						return;
					}

					room = target;
					playerId = slot;
					room.add({
						playerId: slot,
						name: msg.name.slice(0, 16) || `Speler ${slot}`,
						ready: false,
						input: { ...NO_INPUT },
						send,
						close: () => ws.close(),
					});
					send({ t: 'welcome', playerId: slot, room: code, version: 1 });
					break;
				}

				case 'ready':
					room?.setReady(playerId, true);
					break;

				case 'start':
					room?.start(msg.nPlayers);
					break;

				case 'input':
					room?.setInput(playerId, msg.input);
					break;

				default:
					break;
			}
		});

		ws.on('close', () => {
			if (!room) return;
			room.remove(playerId);
			room = null;
		});
	});

	// Lege kamers opruimen, anders lekt het proces geheugen bij elke bezoeker.
	setInterval(() => {
		const now = Date.now();
		for (const [code, r] of rooms) {
			if (r.emptySince !== null && now - r.emptySince > EMPTY_ROOM_TTL_MS) {
				r.stop();
				rooms.delete(code);
			}
		}
	}, 30_000);

	http.listen(PORT, () => {
		console.log(`[boom] luistert op http://localhost:${PORT}`);
		if (!existsSync(CLIENT_DIST))
			console.log('[boom] let op: packages/client/dist bestaat nog niet — draai `npm run build`');
	});
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	process.exitCode = 1;
});
