/**
 * @boom/sim — de simulatie van BOOM.
 *
 * Dit pakket draait zowel in de browser als autoritatief op de server. Daarom:
 * GEEN DOM, GEEN Node-API's, GEEN rendering, GEEN I/O. De tsconfig hier heeft
 * `"lib": ["ES2022"]` en `"types": []` zodat de compiler dat afdwingt in plaats
 * van dat het een afspraak op papier blijft.
 */

export * from './constants.js';
export * from './tiles.js';
export * from './levelset.js';
