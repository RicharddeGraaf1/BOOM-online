# BOOM Online

BOOM in de browser, kraakhelder, en met z'n vieren over internet speelbaar via een gedeelde link.

Herbouw in TypeScript van [BOOM Remake / lifish](https://github.com/silverweed/lifish) van
silverweed, zelf een remake van BOOM (Factor Software, Mac). De C++-bron is de specificatie:
tuning-constanten en vijand-AI zijn overgeschreven, niet opnieuw bedacht.

Het plan staat in [docs/PLAN.md](docs/PLAN.md).

## Aan de slag

De assets staan **niet** in deze repo (zie Licentie hieronder). Je hebt een lokale
BOOM-installatie nodig.

```sh
npm install
npm run assets:import      # zoekt o.a. D:/BOOM/windowsx64/assets
npm run spawns             # spawnpunten voor speler 3 en 4 (nodig vanaf drie spelers)
npm run dev                # solo en lokale co-op
```

Online spelen vraagt de server, die ook de gebouwde client serveert:

```sh
npm run build
npm run server             # http://localhost:8080
```

Vindt het importscript je installatie niet, wijs hem dan aan met
`BOOM_ASSETS=/pad/naar/BOOM/assets npm run assets:import`.

## Spelen

Lokaal spelen er één tot vier mee op hetzelfde toetsenbord:

| | |
|---|---|
| Speler 1 | pijltjes + spatie |
| Speler 2 | WASD + linker shift |
| Speler 3 | IJKL + U |
| Speler 4 | numpad 8456 + numpad 0 |
| Pauze | Esc |

Online opent de gastheer een kamer en deelt de code van vier tekens of de link. Er kunnen tot
vier spelers mee en iedereen gebruikt dan de pijltjes. Kom je binnen terwijl er al gespeeld
wordt, dan kijk je mee en doe je mee vanaf het volgende level — midden in een level laten
verschijnen is oneerlijk voor wie er al staat, en vaak ook gewoon dodelijk. Wie weggaat
verdwijnt meteen uit het veld.

In **Instellingen** staat de beeldmodus:

- **Scherp** — de originele pixels, nearest-neighbour, hele schaalfactor. Pixel-perfect.
- **Glad** — dezelfde art 4× opgeschaald met Scale2x en lineair gefilterd. Zachtere randen,
  en omdat de textuur vier keer zoveel pixels heeft ook op een 4K-scherm nog scherp. Er wordt
  geen kleur verzonnen die niet in het origineel zat.

Groter beeld: **F** schakelt volledig scherm. Daarnaast kun je *Venster vullen* aanzetten, wat
de hele schaalfactor loslaat — dat scheelt veel: bij 1,25× aan beschikbare ruimte blijft de
hele factor steken op 1× en gaat een kwart van het beeld verloren. De prijs is dat game-pixels
dan ongelijk breed worden, wat in de gladde modus nauwelijks opvalt en in de scherpe wel.

## Wat er werkt

Alle zes fasen uit het plan zijn af.

- 80 levels, 10 vijandtypes met hun eigen AI, de alien boss en de big alien boss.
- Bommen met kettingreacties, explosiepropagatie, breekbare muren, negen bonussen, munten,
  teleports, levens, continues, hurry-up en de extra game met EXTRA-letters.
- Geluid en muziek uit de originele assets, met de loop-punten uit `music/loops.txt`.
- Online co-op: server-autoritatief, 20 snapshots per seconde, prediction op de client.
- Eén tot vier spelers, met gegenereerde spawnpunten in alle 80 levels.
- Onderweg aanhaken bij een lopend potje, en er weer uit stappen.

## Structuur

| Pakket | Wat |
|---|---|
| `packages/sim` | De simulatie. **Geen DOM, geen Node-API's, geen rendering** — dit pakket draait ook autoritatief op de server. De tsconfig dwingt dat af met `"lib": ["ES2022"]` en `"types": []`. |
| `packages/client` | PixiJS-renderer, invoer, geluid, menu's, netclient. |
| `packages/server` | Node + ws. Kamers, de autoritatieve klok, en het serveren van de gebouwde client. |
| `packages/assets` | Import uit een lokale BOOM-installatie, plus het genereren van spawnpunten. |

Scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run server`.

## Twee dingen die het gedrag verklaren

**Waarom het origineel wazig oogt.** De game rendert 544×480 en schaalt dat bilineair op
(`setSmooth(true)` in `GameContext.cpp:42`), op de meeste schermen ook nog met een gebroken
factor. De art is prima; de opschaling verpest hem. Hier gebeurt het omgekeerde:
nearest-neighbour, een hele schaalfactor gerekend in *device*-pixels, en sprite-posities
afgerond op hele game-pixels. Zie `packages/client/src/render/scaling.ts`.

**Welke maps er gespeeld worden.** Tot twee spelers de originele, ongewijzigd. Pas vanaf
drie schakelt het spel over naar `levels4p.json` — en dan bij de levelwissel, niet halverwege
een level. Die keuze valt in `@boom/sim`, zodat de browser en de server hem op precies dezelfde
manier maken; een verschil daar zou meteen een desync geven. Het `level`-bericht draagt de
gekozen set mee, zodat een client die `levels4p.json` mist een nette foutmelding krijgt in
plaats van stilletjes aan een ander level te rekenen.

**Waarom vier spelers een script nodig hadden.** De originele tilemaps bevatten precies één
`X` en één `Y` per level — over alle 80 levels samen 80 en 80. Er was fysiek geen plek
aangewezen voor speler 3 en 4. `packages/assets/spawns.mjs` kiest er twee bij: lege tegels met
minstens twee begaanbare buren, zo ver mogelijk van de bestaande spawns en van elkaar, en bij
voorkeur niet naast een vijand. Alle 80 levels krijgen zo vier spawnpunten, en er wordt
uitsluitend op lege tegels geschreven — geen munt, teleport of muur raakt kwijt. Dat laatste
is een test, geen belofte.

In level 6 staan dertien vijanden op 195 tegels; daar is geen plek meer dan twee tegels van
alles vandaan, ook de originele spawns niet. Het script meldt zulke krappe levels.

## Licentie en herkomst

- Broncode van lifish: vrij te forken en te wijzigen, **niet-commercieel**, met bronvermelding.
  Zie https://github.com/silverweed/lifish.
- De assets (graphics, muziek, geluiden) zijn IP van **Factor Software** en zijn nergens
  vrijgegeven. Ze staan daarom bewust niet in deze repo en worden niet herdistribueerd. Wie
  dit ergens neerzet, doet dat achter een kamercode en zonder er geld aan te verdienen.
