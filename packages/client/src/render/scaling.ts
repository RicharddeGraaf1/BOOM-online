/**
 * Kraakheldere opschaling.
 *
 * Het origineel rendert 544x480 naar een RenderTexture met `setSmooth(true)` en schaalt die
 * bilineair op (src/lifish/GameContext.cpp:42-43). Op een scherm waar de schaalfactor geen
 * heel getal is, wordt elke game-pixel over een niet-heel aantal schermpixels uitgesmeerd.
 * Dat is de hele oorzaak van de waas — niet de resolutie van de art.
 *
 * Hier doen we het omgekeerde:
 *   1. de canvas-backingstore is exact 640*S bij 480*S DEVICE-pixels, met S een heel getal;
 *   2. de stage wordt met datzelfde gehele getal geschaald, dus game-pixel -> S device-pixels;
 *   3. de CSS-maat is backingstore / devicePixelRatio, zodat 1 backingstore-pixel ook echt
 *      1 device-pixel is;
 *   4. wat overblijft is letterbox, in zwart.
 *
 * Punt 1 en 3 samen zijn waarom we NIET simpelweg een 640x480 canvas met CSS opblazen: op een
 * scherm met devicePixelRatio 1.5 zou dat alsnog een gebroken factor in device-pixels geven.
 */

export const BASE_WIDTH = 640;
export const BASE_HEIGHT = 480;

export interface Scaling {
	/** hele schaalfactor in device-pixels */
	scale: number;
	/** afmeting van de canvas-backingstore, in device-pixels */
	bufferWidth: number;
	bufferHeight: number;
	/** afmeting van het canvas-element, in CSS-pixels */
	cssWidth: number;
	cssHeight: number;
}

/**
 * Pure functie, los te testen. `dpr` is `window.devicePixelRatio`.
 * Schaalt nooit onder 1: op een te klein scherm liever afgesneden dan wazig.
 */
export function computeScaling(
	availCssWidth: number,
	availCssHeight: number,
	dpr: number,
	baseWidth = BASE_WIDTH,
	baseHeight = BASE_HEIGHT,
): Scaling {
	const deviceWidth = Math.floor(availCssWidth * dpr);
	const deviceHeight = Math.floor(availCssHeight * dpr);

	const scale = Math.max(
		1,
		Math.floor(Math.min(deviceWidth / baseWidth, deviceHeight / baseHeight)),
	);

	const bufferWidth = baseWidth * scale;
	const bufferHeight = baseHeight * scale;

	return {
		scale,
		bufferWidth,
		bufferHeight,
		cssWidth: bufferWidth / dpr,
		cssHeight: bufferHeight / dpr,
	};
}

/**
 * Rondt een positie af op hele game-pixels.
 *
 * De simulatie rekent met floats — de speler beweegt met 120 px/s (conf/player.hpp), dus na
 * één tick van 1/60s staat hij op x = 2.0, na de volgende op 4.0, maar bij een andere
 * snelheid of een botsing op 4.37. Met nearest-neighbour valt zo'n sprite dan de ene frame
 * op de ene pixel en de volgende frame op de andere: zichtbare trilling.
 *
 * Omdat de stage met een geheel getal S geschaald wordt, is een afgeronde game-pixel
 * gegarandeerd ook een hele device-pixel. Daarom hoeft Pixi's eigen `roundPixels` niet aan
 * te staan: die rondt in scherm-ruimte af en zou binnen een game-pixel kunnen landen.
 */
export function snap(v: number): number {
	return Math.round(v);
}
