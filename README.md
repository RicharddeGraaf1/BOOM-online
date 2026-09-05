# BOOM Online

BOOM in de browser, kraakhelder, en met z'n tweeën over internet speelbaar via een gedeelde link.

Herbouw in TypeScript van [BOOM Remake / lifish](https://github.com/silverweed/lifish) van
silverweed, zelf een remake van BOOM (Factor Software, Mac). De C++-bron is onze specificatie:
tuning-constanten en AI worden overgeschreven, niet opnieuw bedacht.

Het plan staat in [docs/PLAN.md](docs/PLAN.md).

## Aan de slag

De assets staan **niet** in deze repo (zie Licentie hieronder). Je hebt een lokale
BOOM-installatie nodig.

```sh
npm install
npm run assets:import      # zoekt o.a. D:/BOOM/windowsx64/assets
npm run dev
```

Vindt het script je installatie niet, wijs hem dan aan:

```sh
BOOM_ASSETS=/pad/naar/BOOM/assets npm run assets:import
```

Andere scripts: `npm test`, `npm run typecheck`, `npm run build`.

## Waar het nu staat

**Fase 0 — fundament.** Een level-viewer: alle 80 levels doorbladeren met ← →, hulplijnen op
het 32px-raster met H. Nog geen simulatie; dit bestaat om te controleren dat de geometrie klopt
en dat het beeld op elk scherm scherp is.

## Structuur

| Pakket | Wat |
|---|---|
| `packages/sim` | De simulatie. **Geen DOM, geen Node-API's, geen rendering** — dit pakket draait straks óók autoritatief op de server. De tsconfig dwingt dat af met `"lib": ["ES2022"]` en `"types": []`. |
| `packages/client` | PixiJS-renderer, input, netclient. |
| `packages/assets` | Import-script dat de assets uit een lokale BOOM-installatie haalt. |

## Waarom het origineel wazig oogt

De game rendert 544×480 en schaalt dat bilineair op (`setSmooth(true)` in
`GameContext.cpp:42`), op de meeste schermen ook nog met een gebroken factor. De art is prima;
de opschaling verpest hem. Hier gebeurt het omgekeerde: nearest-neighbour, een hele
schaalfactor gerekend in *device*-pixels, en sprite-posities afgerond op hele game-pixels.
Zie `packages/client/src/render/scaling.ts`.

## Licentie en herkomst

- Broncode van lifish: vrij te forken en te wijzigen, **niet-commercieel**, met bronvermelding.
  Zie https://github.com/silverweed/lifish.
- De assets (graphics, muziek, geluiden) zijn IP van **Factor Software** en zijn nergens
  vrijgegeven. Ze staan daarom bewust niet in deze repo en worden niet herdistribueerd.
