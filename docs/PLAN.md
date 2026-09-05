# BOOM Online — plan

Doel: BOOM (de remake die nu op `D:\BOOM\windowsx64` staat) kraakhelder in de browser,
speelbaar met z'n tweeën over internet via een gedeelde link.

Status: **alle fasen uitgevoerd** — zie [README.md](../README.md) voor wat er nu draait.
Opgesteld 2026-09-05, uitgevoerd op dezelfde dag. Dit document is het oorspronkelijke plan;
de afwijkingen die tijdens het bouwen bleken staan hieronder per fase genoteerd.

---

## 1. Uitgangssituatie (geverifieerd, niet aangenomen)

Wat er nu staat is **BOOM Remake / lifish v1.8.2** van silverweed.

| Feit | Waarde | Bron |
|---|---|---|
| Taal / library | C++17 + SFML 2.5, CMake | upstream README |
| Omvang | 287 bestanden, ~21.600 regels | eigen telling van de bron |
| Architectuur | Entity + components (geen data-oriented ECS) | `src/core/components/`, `src/lifish/components/` |
| Netwerkcode | **geen enkele** — geen socket/server/client-symbool in de binary | strings-scan van `lifish.exe` |
| Interne resolutie | 544×480 speelveld + 96px zijpaneel = 640×480 | `src/lifish/game.hpp:32-45` |
| Tile size | 32 px, grid 15×13 | `src/core/core.hpp:36`, `levels.json` |
| Gameloop | variabele timestep, float-posities → **niet deterministisch** | `src/main.cpp:294`, `src/core/Time.hpp` |
| Content | 80 levels, 10 vijandtypes, 2 bosses, 9 bonustypes | `assets/levels.json` |
| Licentie broncode | vrij te forken/wijzigen, **niet-commercieel**, bronvermelding verplicht | upstream LICENSE |
| Licentie assets | **niet gelicenseerd** — IP van Factor Software | upstream README |

### Waarom het nu wazig oogt

De game rendert naar een `RenderTexture` van 544×480 en schaalt die op met bilineaire
filtering: `gameRenderTex.setSmooth(true)` in `src/lifish/GameContext.cpp:42-43`. Dezelfde
`setSmooth(true)` staat op de achtergrond-, border-, muntjes- en zijpaneel-textures. Op een
1440p- of 4K-scherm is de schaalfactor bovendien geen heel getal, dus elke pixel wordt over
een niet-heel aantal schermpixels uitgesmeerd. Het is dus geen kwestie van "de art is te lage
resolutie" — de art is prima, de opschaling verpest hem.

### Waarom 4 spelers nu niet kan

De tilemaps coderen spawnpunten als `X` (speler 1) en `Y` (speler 2) —
`src/lifish/entity_type.cpp:11-12`. Over alle 80 levels geteld: precies **80× `X` en 80× `Y`**,
dus exact één spawnpunt per speler per level. Er is fysiek geen plek aangewezen voor speler 3
en 4. Dat klopt met je intuïtie; zie fase 5 voor hoe dat op te lossen is.

---

## 2. Gekozen richting

**Herbouw als webgame in TypeScript**, met de originele assets en `levels.json`.

Waarom niet de C++ forken: het dure deel van je wens is *online*, niet *scherp*. Netcode
retrofitten in 22k regels C++ zonder entity-ID's, zonder serialisatie en met een
niet-deterministische loop is het zwaarste pad dat er is — en aan het eind moet iedereen alsnog
een .exe downloaden, dus "via een link spelen" haal je er nooit mee. In de browser is netcode
grotendeels gratis (WebSocket), distributie is een URL, en kraakheldere schaling is drie regels
CSS/WebGL.

Waarom niet emscripten/WASM van de C++: SFML 2.5 heeft geen officiële emscripten-ondersteuning
(alleen forks), en je zou de netcode alsnog volledig zelf moeten bouwen — in C++, wat trager
gaat. Je koopt er niets mee.

Wat we *wel* uit de C++ halen: het is onze **specificatie**. Alle tuning-constanten staan
expliciet in `src/lifish/conf/` (bomlont 5s, explosieradius 2, spelersnelheid 120 px/s,
hurt-tijd 0.4s, shield 20s, …) en de vijand-AI staat compact in
`src/lifish/ai_functions.cpp` (249 regels). Dat porteren we regel voor regel in plaats van
gameplay opnieuw uit te vinden.

---

## 3. Architectuur

De belangrijkste beslissing van het hele project: **de simulatie mag niets van de browser
weten**, want hij draait óók op de server.

```
BOOM-online/
├─ packages/
│  ├─ sim/       pure TypeScript. Geen DOM, geen Node-API's, geen rendering.
│  │             Wereldstaat, vaste timestep, bommen, explosies, AI, bonussen.
│  │             Draait identiek in de browser en in Node.
│  ├─ client/    PixiJS-renderer, input, geluid, menu's, netclient.
│  ├─ server/    Node + ws. Room-manager, draait `sim` autoritatief.
│  └─ assets/    build-script: PNG's → sprite-atlas, levels.json → sim-formaat.
└─ docs/PLAN.md
```

### Netcode-model

Server-authoritatief met snapshots. Geen lockstep, geen rollback.

- `sim` draait op **vaste timestep** (dt = 1/60s), ook op de client. Dat maakt het gedrag
  reproduceerbaar en desyncs debugbaar — precies wat de C++ niet heeft.
- Server simuleert op 60 Hz, verstuurt snapshots op 20 Hz.
- Client stuurt alleen input (richting + bom-knop) met een frame-nummer.
- Client doet **prediction** voor de eigen speler en **interpolatie** (~100 ms buffer) voor de
  andere speler, de vijanden en de bommen.
- Bij afwijking: server wint, client corrigeert zacht.

Dit is co-op tegen AI, geen competitieve shooter. 80–120 ms latency is hier ruim acceptabel;
de complexiteit van rollback-netcode is niet te rechtvaardigen.

Bandbreedte: 15×13 grid met ~40 actieve entities → snapshot van rond de 1 KB, 20×/s = ~20 KB/s
per speler. Verwaarloosbaar.

### Techkeuzes

| Keuze | Opties | Besluit |
|---|---|---|
| Renderer | PixiJS · Phaser · kaal WebGL2 | **PixiJS** — puur een renderer, laat de simulatie met rust. Phaser wil de hele game bezitten (scenes, physics, loop) en maakt het onmogelijk om `sim` los op Node te draaien. Kaal WebGL2 is werk dat PixiJS al gedaan heeft. |
| Transport | WebSocket (TCP) · WebRTC DataChannel (UDP) | **WebSocket** — bij 20 Hz snapshots van 1 KB is head-of-line blocking geen probleem, en je bent verlost van signalling, STUN/TURN en NAT-traversal. WebRTC is een latere optimalisatie, geen startpunt. |
| Hosting | Railway (Node-proces) · Cloudflare Durable Objects | **Railway** voor fase 3 — één long-running Node-proces met een `Map<roomId, Room>` is doodsimpel en je kent de stack. Durable Objects (één DO per kamer, WebSocket hibernation) is architectonisch eleganter en wereldwijd, maar dat is een schaalprobleem dat je met een handvol vrienden niet hebt. Migratiepad blijft open omdat `sim` platformvrij is. |
| Timestep | variabel (zoals nu) · vast 1/60 | **Vast** — vereist voor zinnige netcode, replays en desync-diagnose. |

---

## 4. Kraakheldere graphics

Doel: exact dezelfde pixelart, maar scherp. Geen upscaling, geen filters, geen nieuwe art.

**Zo is het gelopen.** Hier is één ding bij gekomen dat niet in het plan stond: een tweede
beeldmodus. Kraakheldere pixels blijven blokkerig op een groot scherm, en dat bleek niet te
zijn wat er bedoeld werd met "scherper". De modus **glad** schaalt de art 4x op met Scale2x —
een algoritme dat alleen bij diagonale randen subpixels invult en nooit een kleur verzint die
niet in het origineel zat — en filtert die lineair. De originele modus blijft gewoon staan.

1. **Nearest-neighbour overal.** In PixiJS: `scaleMode = 'nearest'` als globale default.
   Dit alleen al is het grootste deel van het verschil.
2. **Integer scaling met letterbox.** Render logisch op 640×480, kies de grootste hele
   schaalfactor die in het venster past (1080p → 2×, 4K → 4×), en zet zwarte balken eromheen.
   Nooit 2,37×.
3. **Rekening houden met devicePixelRatio.** Op een HiDPI-scherm is de canvas-backingstore
   `cssSize × dpr`; de integer-factor wordt in *device*-pixels gekozen, niet in CSS-pixels.
   Anders ben je alsnog wazig op een laptopscherm.
4. **Sub-pixel jitter voorkomen.** De speler beweegt met 120 px/s over float-posities. Bij
   nearest-neighbour geeft dat trillende sprites. Oplossing: de simulatie houdt floats aan
   (voor correcte physics), maar de renderer rondt elke sprite-positie af op hele
   game-pixels vóór het tekenen.
5. **`image-rendering: pixelated`** op het canvas-element als vangnet voor de laatste
   CSS-schaalstap.

Optioneel later, zonder de look aan te tasten: een lichte scanline/CRT-shader als toggle, en
lighting op explosies. Bewust *niet* in scope nu.

### Asset-pipeline

De PNG's gaan ongewijzigd mee — ze zijn al pixel-perfect. Wat er moet gebeuren:

- Frame-layouts uitlezen. De sheets zijn strak op het 32px-grid: `player1.png` 256×160 = 8×5
  frames, `enemy*.png` 256×96 = 8×3, `bonuses.png` 288×32 = 9 frames (klopt met
  `N_BONUS_TYPES = 9`), `bomb.png` 96×32 = 3, `explosion.png` 128×96 = 4×3.
  De exacte betekenis per rij/kolom staat in de `Animated`-componenten in de C++.
- Alles bundelen in één atlas (minder draw calls, en PixiJS wil het toch).
- `levels.json` blijft ongewijzigd het bronformaat; een klein script zet het om naar een
  compacter runtime-formaat. Codering staat in `src/lifish/entity_type.cpp:5-28`:
  `0`=leeg, `1`=vaste muur, `2`=breekbaar, `3`=munt, `+`=teleport, `X`/`Y`=spawn speler 1/2,
  `A`–`J`=vijand 1–10, `*`=alien boss, `/`=big alien boss.

---

## 5. Fasering

Elke fase eindigt op iets dat je kunt openen en zien werken.

### Fase 0 — Fundament · **af**
Monorepo opzetten, asset-pipeline, renderer. Level 1 statisch in beeld: achtergrond, border,
muren, breekbare blokken, munten — pixel-perfect en scherp op elk scherm.
*Klein. Dit is het moment waarop je meteen ziet dat het scherpteprobleem opgelost is.*

### Fase 1 — Speelbare kern, solo, offline · **af**
Speler-beweging op het grid, bommen leggen, explosiepropagatie, breekbare muren, de 9
bonussen, munten, teleports, level-overgang, zijpaneel/HUD. Constanten letterlijk uit
`src/lifish/conf/`.
**Deliverable: de eerste ~10 levels solo uitspeelbaar in de browser.**
*Middelgroot. Dit is waar het gevoel van de game gemaakt of gebroken wordt.*

### Fase 2 — Vijanden en bosses · **af**
10 vijandtypes met hun AI en schietgedrag (port van `ai_functions.cpp` +
`src/lifish/entities/Enemy.cpp`), de alien boss en de big alien boss, eieren/spawning.
**Deliverable: alle 80 levels solo uitspeelbaar.**
*Groot, maar goed af te bakenen — vijand voor vijand.*

### Fase 3 — Online co-op · **af, en voor vier spelers**
`sim` splitsen naar server, room-manager, lobby met deelbare link/room-code, input-protocol,
snapshots, prediction en interpolatie, reconnect, pauze bij disconnect. Deployen op Railway.
**Deliverable: jij en een vriend spelen de campagne samen via een URL.**
*Groot. Het echte werk zit in prediction/reconciliation goed krijgen, niet in de sockets.*

**Zo is het gelopen.** De client draait de volledige simulatie mee en overschrijft die op elke
snapshot; alleen voor de eigen speler wordt een afwijking onder een halve tegel genegeerd, zodat
je poppetje niet twintig keer per seconde een sprongetje maakt. Client en server kiezen hun
levelset in dezelfde volgorde (`levels4p.json`, anders `levels.json`) — een verschil daar zou
meteen een desync geven.

### Fase 4 — Politoer · **af**
Geluid (64 effecten) en muziek (8 tracks met loop-punten uit `music/loops.txt`), menu's,
opties, opslaan/laden (server-side of localStorage), levens en continues, scores.

### Fase 5 — 4 spelers · **af**
Twee echte problemen, geen van beide technisch:
- **Spawnpunten.** Er is er precies één per speler per level. Oplossing: een script dat per
  level twee extra vrije tegels kiest op maximale afstand van `X` en `Y`, met handmatige
  correctie via een kleine leveleditor. Dit is een contentklus over 80 levels.
- **Balans.** Vier spelers met vier bommensets maken de originele levels triviaal. Vereist
  schaling van vijand-HP/aantallen, of aangepaste levels.

**Zo is het gelopen.** `packages/assets/spawns.mjs` kiest per level twee extra spawns: lege
tegels met minstens twee vrije buren, zo ver mogelijk van `X`, `Y` en van elkaar, en niet
binnen drie tegels van een vijand. Dat lukt voor 77 van de 80 levels; in level 6, 65 en 66
is het te vol en spelen er maximaal twee mee. Speler 3 en 4 lenen de sprites van speler 1 en
2 met een eigen tint — nieuwe art tekenen zou betekenen dat we toevoegen aan een set die niet
van ons is. De balansronde is er bewust nog niet: met vier spelers zijn de originele levels
inderdaad makkelijker, en of dat erg is hangt af van hoe het speelt.

---

## 6. Risico's en open punten

**Auteursrecht op de assets.** Dit is het serieuze punt. De broncode mag je forken; de
graphics, muziek en geluiden zijn van Factor Software en zijn nergens vrijgegeven. Een .exe
onder vrienden verspreiden is iets anders dan ze op een publieke URL zetten. Mitigatie voor nu:
niet-geïndexeerde URL, toegang via room-code of wachtwoord, geen enkele vorm van monetisatie,
en duidelijke bronvermelding naar Factor Software en silverweed. Wil je het ooit écht publiek
zetten, dan is eigen art de enige schone route — wat toevallig ook fase 5 makkelijker maakt.

**Scope.** Dit is geen weekendproject. 80 levels, 10 AI-types, 2 bosses en netcode is een
substantieel traject. De fasering is zo gekozen dat je na fase 1 al iets hebt dat leuk is, en
na elke fase kunt stoppen zonder dat het weggegooid werk is.

**Speelgevoel 1-op-1 reproduceren.** Het risico is niet dat het niet werkt, maar dat het
*net niet goed voelt*. Tegenmaatregel: de C++ als spec behandelen en constanten letterlijk
overnemen in plaats van "ongeveer goed" te gokken. Bij twijfel: de originele .exe ernaast
draaien en vergelijken.

**Netcode-desyncs.** Beperkt risico dankzij de vaste timestep, maar reken op een ronde
debuggen aan floating-point-verschillen tussen browser en Node. Vangnet: de server is
autoritatief, dus een desync is een correctie en geen kapotte game.

---

## 7. Eerstvolgende concrete stap

Fase 0 starten: monorepo-skelet (`packages/sim`, `client`, `server`, `assets`), het
asset-buildscript, en level 1 kraakhelder in beeld krijgen. Dat is meteen de goedkoopste manier
om te toetsen of de scherpte-aanpak doet wat je ervan verwacht.

---

## Bronvermelding

- BOOM Remake / lifish — silverweed, https://github.com/silverweed/lifish (broncode als
  referentie en specificatie; niet-commercieel gebruik)
- Originele BOOM en alle assets — Factor Software
