/**
 * Overgeschreven uit de C++-bron van lifish v1.8.2 (silverweed).
 * Dit bestand is een transcriptie, geen herinterpretatie: elke waarde heeft een bronverwijzing.
 * Wijk hier nooit "op gevoel" van af — dan gaat het speelgevoel stuk zonder dat je weet waarom.
 *
 * Tijden staan in seconden (de bron gebruikt sf::Time).
 */

// ── Geometrie ── src/core/core.hpp, src/lifish/game.hpp
export const TILE_SIZE = 32;
/** Speelveld in tegels. Staat per level in levels.json, maar is overal 15x13. */
export const LEVEL_WIDTH = 15;
export const LEVEL_HEIGHT = 13;
/** Speelveld inclusief de border van één tegel rondom: 17x15 tegels. */
export const GAME_WIDTH = 544;
export const GAME_HEIGHT = 480;
export const SIDE_PANEL_WIDTH = 96;
export const WINDOW_WIDTH = SIDE_PANEL_WIDTH + GAME_WIDTH; // 640
export const WINDOW_HEIGHT = GAME_HEIGHT; // 480
/** x waarop het speelveld getekend wordt; het zijpaneel staat links ervan. src/main.cpp:261 */
export const GAME_ORIGIN_X = SIDE_PANEL_WIDTH; // 96
/**
 * src/lifish/game.hpp:45. Let op: dit is NIET de teken-offset (die is GAME_ORIGIN_X = 96).
 * De bron gebruikt deze waarde alleen voor de tekstbegrenzing tussen levels
 * (src/lifish/level/InterlevelContext.cpp:20).
 */
export const MAIN_WINDOW_SHIFT = 1 + SIDE_PANEL_WIDTH; // 97

/**
 * Vier spelers. Het origineel kent er twee (src/lifish/game.hpp:29) omdat elke tilemap maar
 * één X en één Y heeft; de extra spawnpunten worden gegenereerd door packages/assets/spawns.mjs.
 */
export const MAX_PLAYERS = 4;
/** Zoveel spelers heeft het origineel; daarboven wordt het onze eigen uitbreiding. */
export const ORIGINAL_MAX_PLAYERS = 2;
export const N_ENEMIES = 10;

// ── Simulatie ──
/**
 * Vaste timestep. Het origineel gebruikt een variabele timestep (src/main.cpp:294), wat het
 * niet-deterministisch maakt. Wij fixeren hem: vereist voor netcode, replays en desync-diagnose.
 */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

// ── Speler ── src/lifish/conf/player.hpp
export const player = {
	INITIAL_LIVES: 3,
	MAX_LIFE: 16,
	DEFAULT_MAX_BOMBS: 5,
	MAX_MAX_BOMBS: 8,
	INITIAL_CONTINUES: 3,
	/** pixels per seconde */
	DEFAULT_SPEED: 120,
	/** aantal letters voor een extra leven */
	N_EXTRA_LETTERS: 5,
	DEATH_TIME: 5,
	DEATH_STOP_ANIM_TIME: 2,
	HURT_ANIM_DURATION: 0.14,
	RESURRECT_SHIELD_TIME: 5,
	DAMAGE_SHIELD_TIME: 1,
} as const;

// ── Bommen ── src/lifish/conf/bomb.hpp
export const bomb = {
	DEFAULT_FUSE: 5,
	QUICK_FUSE: 2.5,
	DEFAULT_RADIUS: 2,
	MAX_RADIUS: 4,
	EXPL_DAMAGE: 1,
} as const;

// ── Bonussen ── src/lifish/conf/bonus.hpp
export const bonus = {
	VALUE: 100,
	N_BONUS_TYPES: 9,
	N_PERMANENT_BONUS_TYPES: 5,
	EXPIRE_TIME: 10,
	SHIELD_DURATION: 20,
	SPEEDY_DURATION: 20,
} as const;

// ── Vijanden ── src/lifish/conf/enemy.hpp
export const enemy = {
	/** pixels per seconde; de `speed` in levels.json is een vermenigvuldiger hierop */
	BASE_SPEED: 60,
	BASE_LIFE: 1,
	DEATH_TIME: 2,
	DAMAGE_SHIELD_TIME: 1,
	YELL_INTERVAL_MIN: 7,
	YELL_INTERVAL_MAX: 40,
	/** wisp beweegt in muren op (1 - deze waarde) x snelheid */
	WISP_IN_WALL_SPEED_REDUCTION: 0.5,
	SPIKES_DAMAGE: 2,
} as const;

// ── Overig ──
/** src/lifish/conf/teleport.hpp */
export const TELEPORT_COOLDOWN = 0.8;
/** src/lifish/conf/global.hpp */
export const EXTRA_GAME_DURATION = 30;
export const HURT_TIME = 0.4;
/** src/lifish/conf/wall.hpp */
export const BREAKABLE_WALL_VALUE = 10;
/** src/lifish/conf/bullet.hpp */
export const BULLET_BASE_SPEED = player.DEFAULT_SPEED;

/**
 * Tekenvolgorde. src/lifish/conf/zindex.hpp.
 * Let op de eigenaardigheid uit LevelRenderer.cpp: lagen met z >= 0 worden ONDER de
 * level-border getekend, lagen met z < 0 erboven (hoe negatiever, hoe hoger).
 */
export const zindex = {
	PONDS: 1,
	TELEPORTS: 2,
	EXPLOSIONS: 3,
	TRANSP_WALLS: 4,
	WALLS: 5,
	COINS: 6,
	BOMBS: 7,
	PLAYERS: 8,
	ENEMIES: 9,
	BULLETS: 10,
	BOSSES: 11,
	TALL_ENTITIES: 12,
	HAUNTING_SPIRIT_BOSS: 13,
	BOSS_BULLETS: 14,
	FOG: 15,
	BOSS_EXPLOSIONS: 20,
	FLASHES: 21,
	DROPPING_TEXTS: 42,
	TORCHES: -1,
	UI: -2,
	POINTS: -3,
} as const;
