/**
 * Tekent de wereld.
 *
 * De renderer houdt per entity-id een sprite bij en werkt die elk frame bij. De sim wordt
 * nooit aangeraakt: hier wordt alleen gelezen. Dat is niet netheid om de netheid — dezelfde
 * sim draait straks op de server, waar geen enkele van deze regels bestaat.
 *
 * Tekenvolgorde is die van het origineel (src/lifish/level/LevelRenderer.cpp): achtergrond,
 * entities op oplopende z-index, dan de border eroverheen.
 */

import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import {
	Dir,
	GAME_HEIGHT,
	GAME_WIDTH,
	TILE_SIZE,
	zindex,
	type Direction,
	type Entity,
	type World,
} from '@boom/sim';
import { playerSheet, playerTint } from './playerColors.js';
import { sheetsNeededFor } from './sheetNames.js';
import type { Sheets } from './sheets.js';

const BORDER_Z = 1000;

/** src/lifish/entities/Coin.cpp:62 */
const COIN_FRAME_TIME = 0.02;
/** Kleur van de schildrand om een speler. */
const SHIELD_COLOUR = 0xffcc00;

/** De z-conventie van het origineel is omgekeerd: z >= 0 onder de border, z < 0 erboven. */
function toPixiZ(lifishZ: number): number {
	return lifishZ >= 0 ? lifishZ : BORDER_Z - lifishZ;
}

const BULLET_SHEETS: Record<number, string> = {
	1: 'shot.png',
	2: 'fireball.png',
	3: 'mg_shot.png',
	4: 'lightbolt.png',
	5: 'flame.png',
	6: 'plasma.png',
	7: 'magma.png',
	101: 'bossbullet.png',
};

/** Hoeveel rijen richtingsvarianten elke kogelsheet heeft. src/lifish/conf/bullet.cpp */
const BULLET_DIRECTIONALITY: Record<number, number> = {
	1: 1,
	2: 1,
	3: 4,
	4: 1,
	5: 4,
	6: 1,
	7: 4,
	101: 1,
};

/** Rij in de spelersheet per kijkrichting. src/lifish/entities/Player.cpp:269-279 */
function playerRow(dir: Direction): number {
	switch (dir) {
		case Dir.UP:
			return 1;
		case Dir.RIGHT:
			return 2;
		case Dir.LEFT:
			return 3;
		default:
			return 0;
	}
}

/**
 * aliensprite.png is 9 kolommen bij 2 rijen. De indeling is anders dan bij de gewone
 * vijanden en loopt over de rijgrens heen. src/lifish/components/AlienSprite.cpp:24-49.
 */
function alienCell(dir: Direction, frame: number): { col: number; row: number } {
	switch (dir) {
		case Dir.UP:
			return { col: 4 + frame, row: 0 };
		case Dir.RIGHT:
			// kolom 8 op rij 0, daarna 0..2 op rij 1
			return frame === 0 ? { col: 8, row: 0 } : { col: frame - 1, row: 1 };
		case Dir.LEFT:
			return { col: 3 + frame, row: 1 };
		default:
			return { col: frame, row: 0 };
	}
}

/** De twee sterfframes van de alien: kolom 7 en 8 op rij 1. */
const ALIEN_DEATH: readonly { col: number; row: number }[] = [
	{ col: 7, row: 1 },
	{ col: 8, row: 1 },
];

/**
 * Kolom en rij in de vijandsheet. Anders opgebouwd dan de speler: down en up delen rij 0,
 * right en left rij 1, elk met vier frames. src/lifish/entities/Enemy.cpp:120-141
 */
function enemyCell(dir: Direction, frame: number): { col: number; row: number } {
	switch (dir) {
		case Dir.UP:
			return { col: 4 + frame, row: 0 };
		case Dir.RIGHT:
			return { col: frame, row: 1 };
		case Dir.LEFT:
			return { col: 4 + frame, row: 1 };
		default:
			return { col: frame, row: 0 };
	}
}

interface View {
	root: Container;
	/** hoofdsprite; explosies hebben er meer, die staan in `extra` */
	main: Sprite;
	extra?: { h: TilingSprite; v: TilingSprite };
	/** vier kopieën met één pixel verschuiving; samen vormen ze de schildrand */
	outline?: Sprite[];
	kind: string;
}

/** Verschuivingen voor de omtrek: links, rechts, boven, onder. */
const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
];

export class GameView {
	readonly root = new Container();

	private readonly sheets: Sheets;
	private readonly world: () => World;
	private readonly views = new Map<number, View>();
	private readonly textures = new Map<string, Texture>();
	private bg: TilingSprite | null = null;
	private border: Sprite | null = null;
	/**
	 * Vaste muren zijn geen entities — ze staan alleen in het botsingsraster van de wereld,
	 * want ze veranderen nooit. Ze moeten dus apart getekend worden, één keer per level.
	 * Vergeet je dat, dan loop je tegen muren op die er niet zijn.
	 */
	private walls: Container | null = null;
	private levelKey = '';
	/** Pas tekenen als de sheets binnen zijn; tot die tijd is er niets om te tekenen. */
	private ready = false;

	constructor(sheets: Sheets, world: () => World) {
		this.sheets = sheets;
		this.world = world;
		this.root.sortableChildren = true;
	}

	/** Laadt alle sheets die dit level nodig heeft en bouwt achtergrond en border op. */
	async prepareLevel(w: World): Promise<void> {
		const key = `${w.tileIDs.bg}/${w.tileIDs.border}/${w.tileIDs.fixed}/${w.tileIDs.breakable}`;

		// Álles wat getekend kan worden moet hier binnen zijn. De Sheets-cache voorladen is
		// niet genoeg: deze klasse heeft zijn eigen tabel, en `get()` gooit als een sheet
		// daar ontbreekt. Dat was precies de fout die het speelveld zwart liet.
		await Promise.all(sheetsNeededFor(w).map((f) => this.cache(f)));
		this.ready = true;

		this.clearEntities();
		// De muren staan per level anders, ook als de tegelsets gelijk zijn: altijd opnieuw.
		this.buildWalls(w);

		if (key === this.levelKey && this.bg && this.border) return;
		this.levelKey = key;

		this.bg?.destroy();
		this.border?.destroy();

		const bgTex = this.get(`bg${w.tileIDs.bg}.png`);
		this.bg = new TilingSprite({ texture: bgTex, width: GAME_WIDTH, height: GAME_HEIGHT });
		this.bg.tileScale.set(1 / this.sheets.textureScale);
		this.bg.zIndex = -1;
		this.root.addChild(this.bg);

		this.border = new Sprite(this.get(`border${w.tileIDs.border}.png`));
		this.border.scale.set(1 / this.sheets.textureScale);
		this.border.zIndex = BORDER_Z;
		this.root.addChild(this.border);
	}

	/** Legt de vaste muren neer als één laag sprites; die hoeven daarna nooit meer aangeraakt. */
	private buildWalls(w: World): void {
		this.walls?.destroy({ children: true });

		const layer = new Container();
		layer.zIndex = toPixiZ(zindex.WALLS);

		// fixed.png is 8 tegels breed; de kolom is het tegel-id van dit level min één.
		// src/lifish/entities/FixedWall.cpp:18-20
		const tex = this.sheets.tile(this.get('fixed.png'), w.tileIDs.fixed - 1);
		const stride = w.width + 2;

		// Alleen het speelveld, niet de rand: die zit al in border*.png.
		for (let ty = 1; ty <= w.height; ++ty) {
			for (let tx = 1; tx <= w.width; ++tx) {
				if (w.fixed[ty * stride + tx] !== 1) continue;
				const wall = new Sprite(tex);
				wall.scale.set(1 / this.sheets.textureScale);
				wall.x = tx * TILE_SIZE;
				wall.y = ty * TILE_SIZE;
				layer.addChild(wall);
			}
		}

		this.walls = layer;
		this.root.addChild(layer);
	}

	/** Voor tests en diagnose: hoeveel vaste muren zijn er neergezet? */
	get wallCount(): number {
		return this.walls?.children.length ?? 0;
	}

	private async cache(file: string): Promise<void> {
		if (this.textures.has(file)) return;
		this.textures.set(file, await this.sheets.sheet(file));
	}

	private get(file: string): Texture {
		const t = this.textures.get(file);
		if (!t) throw new Error(`sheet ${file} is niet voorgeladen`);
		return t;
	}

	/** Voor tests en diagnose: welke sheets heeft deze view daadwerkelijk binnen? */
	get loadedSheets(): string[] {
		return [...this.textures.keys()].sort();
	}

	private clearEntities(): void {
		for (const v of this.views.values()) {
			this.root.removeChild(v.root);
			v.root.destroy({ children: true });
		}
		this.views.clear();
	}

	/** Eén frame tekenen. `crisp` bepaalt of posities op hele spelpixels worden afgerond. */
	draw(crisp: boolean): void {
		if (!this.ready) return;
		const w = this.world();
		const alive = new Set<number>();

		for (const e of w.entities) {
			alive.add(e.id);
			let view = this.views.get(e.id);
			if (!view) {
				const created = this.createView(e);
				if (!created) continue;
				view = created;
				this.views.set(e.id, view);
				this.root.addChild(view.root);
			}
			this.updateView(view, e, w, crisp);
		}

		for (const [id, view] of this.views) {
			if (alive.has(id)) continue;
			this.root.removeChild(view.root);
			view.root.destroy({ children: true });
			this.views.delete(id);
		}
	}

	private createView(e: Entity): View | null {
		const root = new Container();
		const main = new Sprite();
		main.scale.set(1 / this.sheets.textureScale);
		root.addChild(main);

		let extra: View['extra'];
		let outline: Sprite[] | undefined;

		switch (e.kind) {
			case 'explosion': {
				const h = new TilingSprite({ texture: Texture.EMPTY, width: TILE_SIZE, height: TILE_SIZE });
				const v = new TilingSprite({ texture: Texture.EMPTY, width: TILE_SIZE, height: TILE_SIZE });
				h.tileScale.set(1 / this.sheets.textureScale);
				v.tileScale.set(1 / this.sheets.textureScale);
				root.addChildAt(h, 0);
				root.addChildAt(v, 1);
				extra = { h, v };
				root.zIndex = toPixiZ(zindex.EXPLOSIONS);
				break;
			}
			case 'breakable':
			case 'teleport':
				root.zIndex = toPixiZ(e.kind === 'breakable' ? zindex.WALLS : zindex.TELEPORTS);
				break;
			case 'coin':
				root.zIndex = toPixiZ(zindex.COINS);
				break;
			case 'bonus':
			case 'letter':
				root.zIndex = toPixiZ(zindex.EXPLOSIONS);
				break;
			case 'bomb':
				root.zIndex = toPixiZ(zindex.BOMBS);
				break;
			case 'player': {
				root.zIndex = toPixiZ(zindex.PLAYERS);
				// De schildrand: vier gekleurde kopieën één pixel opzij, achter de sprite.
				// Het origineel doet dit met een shader (PlayerDrawProxy); dit is hetzelfde
				// effect met de middelen die we hier hebben.
				outline = OUTLINE_OFFSETS.map(([ox, oy]) => {
					const s = new Sprite();
					s.scale.set(1 / this.sheets.textureScale);
					s.x = ox;
					s.y = oy;
					s.tint = SHIELD_COLOUR;
					s.visible = false;
					root.addChildAt(s, 0);
					return s;
				});
				break;
			}
			case 'enemy':
				root.zIndex = toPixiZ(zindex.ENEMIES);
				break;
			case 'bullet':
				root.zIndex = toPixiZ(zindex.BULLETS);
				break;
			case 'boss':
				root.zIndex = toPixiZ(zindex.BOSSES);
				break;
			default:
				return null;
		}

		// Optionele velden alleen meegeven als ze er zijn: exactOptionalPropertyTypes staat aan.
		const view: View = { root, main, kind: e.kind };
		if (extra) view.extra = extra;
		if (outline) view.outline = outline;
		return view;
	}

	private updateView(view: View, e: Entity, w: World, crisp: boolean): void {
		view.root.x = crisp ? Math.round(e.x) : e.x;
		view.root.y = crisp ? Math.round(e.y) : e.y;
		view.root.alpha = 1;
		view.main.visible = true;
		view.main.tint = 0xffffff;

		switch (e.kind) {
			case 'player':
				this.drawPlayer(view, e);
				break;
			case 'enemy':
				this.drawEnemy(view, e);
				break;
			case 'bomb':
				this.drawBomb(view, e);
				break;
			case 'explosion':
				this.drawExplosion(view, e);
				break;
			case 'breakable':
				this.drawBreakable(view, e, w);
				break;
			case 'coin':
				// 0,02 s per frame — src/lifish/entities/Coin.cpp:62. Vier keer sneller dan wat
				// ik ervan gemaakt had; op deze snelheid leest het als glinstering in plaats
				// van als een ronddraaiend ding dat je aandacht opeist.
				view.main.texture = this.animTile('coin.png', e.animT, 10, COIN_FRAME_TIME);
				break;
			case 'teleport':
				view.main.texture = this.animTile('teleport.png', e.animT, 8, 0.07);
				break;
			case 'bonus':
				this.drawBonus(view, e);
				break;
			case 'letter':
				view.main.texture = this.sheets.tile(this.get('extra_letters.png'), e.letter ?? 0, 0);
				break;
			case 'bullet':
				this.drawBullet(view, e);
				break;
			case 'boss':
				this.drawBoss(view, e);
				break;
			default:
				break;
		}
	}

	private animTile(file: string, t: number, frames: number, frameTime: number): Texture {
		const idx = Math.floor(t / frameTime) % frames;
		return this.sheets.tile(this.get(file), idx);
	}

	private drawPlayer(view: View, e: Entity): void {
		const id = e.playerId ?? 1;
		const sheet = this.get(`player${playerSheet(id)}.png`);
		view.main.tint = playerTint(id);
		const row = playerRow(e.moving ? e.dir : e.facing);

		if (e.dead) {
			// Rij 4 bevat de sterfframes; ze lopen één keer af en blijven dan staan.
			const f = Math.min(7, Math.floor(e.deadT / 0.15));
			view.main.texture = this.sheets.tile(sheet, f, 4);
			return;
		}

		const frame = e.moving ? Math.floor(e.animT / 0.07) % 8 : 0;
		view.main.texture = this.sheets.tile(sheet, frame, row);

		// Schild: een gele rand om het poppetje, die in de laatste drie seconden knippert.
		// src/lifish/entities/Player.cpp:410-417.
		const diff = e.shieldT - Math.floor(e.shieldT);
		const shown = e.shieldT > 0 && (e.shieldT > 3 || 4 * diff - Math.floor(4 * diff) < 0.5);
		for (const s of view.outline ?? []) {
			s.visible = shown;
			if (shown) s.texture = view.main.texture;
		}
	}

	private drawEnemy(view: View, e: Entity): void {
		// Een gemorfde vijand blijft een alien, ook terwijl hij doodgaat. Viel dit door naar
		// de gewone tak, dan stierf het wolkje als het beestje dat het ooit was.
		if (e.morphed) {
			const alien = this.get('aliensprite.png');
			if (e.dead) {
				const f = ALIEN_DEATH[Math.min(ALIEN_DEATH.length - 1, Math.floor(e.deadT / 0.2))]!;
				view.main.texture = this.sheets.tile(alien, f.col, f.row);
				view.root.alpha = Math.max(0, 1 - e.deadT / 2);
			} else {
				const frame = e.moving ? Math.floor(e.animT / 0.12) % 4 : 0;
				const { col, row } = alienCell(e.moving ? e.dir : e.facing, frame);
				view.main.texture = this.sheets.tile(alien, col, row);
			}
			return;
		}

		const sheet = this.get(`enemy${e.enemyId ?? 1}.png`);

		if (e.dead) {
			const n = e.enemyId === 3 ? 4 : 2;
			const f = Math.min(n - 1, Math.floor(e.deadT / 0.15));
			view.main.texture = this.sheets.tile(sheet, 4 + f, 2);
			view.root.alpha = Math.max(0, 1 - e.deadT / 2);
			return;
		}

		if (e.blockedT > 0) {
			// Schietanimatie: rij 2, kolom per richting.
			const col = e.dir === Dir.UP ? 1 : e.dir === Dir.RIGHT ? 2 : e.dir === Dir.LEFT ? 3 : 0;
			view.main.texture = this.sheets.tile(sheet, col, 2);
			return;
		}

		const frame = e.moving ? Math.floor(e.animT / 0.12) % 4 : 0;
		const { col, row } = enemyCell(e.moving ? e.dir : e.facing, frame);
		view.main.texture = this.sheets.tile(sheet, col, row);

		// Een vijand die net geraakt is knippert magenta. src/lifish/entities/Enemy.cpp:280-289.
		view.main.tint =
			e.shieldT > 0 && Math.floor(e.shieldT * 8) % 2 === 0 ? 0xc800c8 : 0xffffff;
	}

	private drawBomb(view: View, e: Entity): void {
		const sheet = this.get('bomb.png');
		const left = (e.fuseTime ?? 5) - (e.fuseT ?? 0);
		// De laatste twee seconden gaat de bom over op de snellere "exploding"-animatie.
		const frames = left < 2 ? [1, 2] : [0, 1];
		const idx = frames[Math.floor((e.animT ?? 0) / 0.05) % 2]!;
		view.main.texture = this.sheets.tile(sheet, idx);
	}

	private drawExplosion(view: View, e: Entity): void {
		if (!view.extra) return;
		// Zeven frames die heen en weer lopen: 0 1 2 3 2 1 0.
		const seq = [0, 1, 2, 3, 2, 1, 0];
		const idx = seq[Math.min(seq.length - 1, Math.floor((e.t ?? 0) / 0.05))]!;

		const reach = e.reach ?? [0, 0, 0, 0];
		const [up, leftR, down, right] = reach;

		// explosionH.png is 32 breed en 128 hoog: vier varianten onder elkaar, die horizontaal
		// herhaald worden om de arm te vullen. explosionV.png is het spiegelbeeld daarvan.
		const hTex = this.sheets.tile(this.get('explosionH.png'), 0, idx);
		const vTex = this.sheets.tile(this.get('explosionV.png'), idx, 0);

		const h = view.extra.h;
		h.texture = hTex;
		h.width = (leftR + right + 1) * TILE_SIZE;
		h.height = TILE_SIZE;
		h.x = -leftR * TILE_SIZE;
		h.y = 0;

		const v = view.extra.v;
		v.texture = vTex;
		v.width = TILE_SIZE;
		v.height = (up + down + 1) * TILE_SIZE;
		v.x = 0;
		v.y = -up * TILE_SIZE;

		view.main.texture = this.sheets.tile(this.get('explosionC.png'), idx);
	}

	private drawBreakable(view: View, e: Entity, w: World): void {
		const row = w.tileIDs.breakable - 1;
		const col = e.dead ? Math.min(3, 1 + Math.floor(e.deadT / 0.08)) : 0;
		view.main.texture = this.sheets.tile(this.get('breakable.png'), col, row);
	}

	private drawBonus(view: View, e: Entity): void {
		view.main.texture = this.sheets.tile(this.get('bonuses.png'), e.bonus ?? 0);
		// Knipperen in de laatste drie seconden. src/lifish/entities/Bonus.cpp:63
		const t = e.t ?? 0;
		if (t > 7) {
			const diff = t - Math.floor(t);
			view.main.visible = !(5 * diff - Math.floor(5 * diff) < 0.5);
		}
	}

	private drawBullet(view: View, e: Entity): void {
		const file = BULLET_SHEETS[e.bulletData ?? 1] ?? 'shot.png';
		const tex = this.textures.get(file);
		if (!tex) {
			// Nog niet geladen: haal hem op, tot die tijd niets tekenen.
			void this.cache(file);
			view.main.visible = false;
			return;
		}
		const dirs = BULLET_DIRECTIONALITY[e.bulletData ?? 1] ?? 1;
		const row = dirs > 1 ? e.dir % dirs : 0;
		view.main.texture = this.sheets.tile(tex, 0, row);
	}

	private drawBoss(view: View, e: Entity): void {
		if (e.bossKind === 'alien') {
			const tex = this.textures.get('alien_boss.png');
			if (!tex) return;
			view.main.texture = this.sheets.frame(tex, 0, 0, 96, 96);
		} else {
			const tex = this.textures.get('big_alien_boss.png');
			if (!tex) return;
			const f = Math.floor(e.animT / 0.15) % 4;
			view.main.texture = this.sheets.frame(tex, f * 160, 0, 160, 160);
		}
		if (e.dead) view.root.alpha = Math.max(0, 1 - e.deadT / 4);
		else if (e.shieldT > 0) view.root.alpha = 0.6;
	}
}
