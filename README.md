# Dot City

A real-time strategy game where the city builds itself and you decide what each square becomes.
This build covers milestones M0 to M6 of the implementation plan (simulation core, natural growth, terrain, economy, combat, many colonies, research), plus an AI that builds, researches, defends and attacks for the rival colonies.

## Play it

In your browser, nothing to install: **https://bestandgreatestusername.github.io/dot-city/**

The game is rebuilt and redeployed automatically on every push to `main`.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

Other commands: `npm test` (simulation tests), `npm run typecheck`, `npm run build`.

## How it plays

- **Five kinds of map** (pick one in the menu, or let the seed choose among the first four):
  - **Continent:** one great landmass in the ocean, with mountain spines across it.
  - **Highlands:** ridges of mountains with valleys and passes between them.
  - **River Lands:** wide rivers cut the land, crossed only at fords.
  - **Lakes:** a land of many lakes.
  - **Endless World:** the map loops at its edges, with no corner to hide in.
- **Every start is different but fair.** Each colony gets the same open ground around its tower, plus one flavour beside it:
  - a mountain range (Mines, Observatories and richer houses);
  - a lake (Fisheries and richer houses);
  - a deep forest (slow to grow into, but it pays timber);
  - open plains (room to grow, and treasure close by).

  The menu tells you which you got. Every map is checked so all colonies can reach each other on foot.
- **Landmarks worth expanding towards:** **Ancient Ruins** give a free discovery, and **Treasure** gives 150 gold, to whichever city grows onto them first. Each colony has ruins at the same distance from its tower, and the richest finds lie in the contested ground between colonies.
- **Terrain:** forest is slow to grow into (×0.6), but every forest square cleared pays 3 gold of timber. Houses touching a mountain (a quarry) or water (a fishing village) earn 50% more. Water and mountains stop armies on foot: only **Sappers** can blast a way through rock, and **Bombers** fly over both. Every map is checked so each colony can walk to every other over open land; where it could not, a pass is carved through the hills or a causeway across the water.
- You share the map with **5 rivals** by default (3, 5 or 7 in the menu). The map grows with the number of colonies, from 96x96 squares for four colonies to 112x112 for six and 128x128 for eight, and colonies start spread as far apart as the map allows.
- Houses spread outward from your 2x2 Center Tower on their own. Each house earns gold; the tower adds a small base income.
- Growth is deliberately slow, so every house counts. The bigger a city gets, the slower it grows: at 230 squares it grows at half speed, and it crawls past about 400. Cities settle at around 400 to 600 squares, so every square you convert matters.
- You never place a building. You convert an existing house, permanently, and pay gold for it (farms are free). Every copy of a building costs the same.
- A new building appears at once but starts at 30% health and does nothing for 5 seconds.
- You start with five buildings: **Wall**, **Farm**, **Research building**, **Crossbow Tower** and **Warrior Camp**. Research unlocks 28 more.

### The hotbar

Buildings sit in four tabs: **Economy** (`Z`), **Science** (`X`), **Defence** (`C`) and **Army** (`V`). The bar shows only what you have discovered, so it grows with your playstyle. A building you have just unlocked pulses, and so does its tab. Hover a building for its info card: what it does, its price, and its numbers (health, range, damage, reload, or the units it raises).

### The screen

- **Top left:** gold, science with a bar filling towards your next discovery, and your tower's health bar (it turns gold, then flashing red, as the tower falls).
- **Alerts:** when your tower is hit the screen edges flash red, and a message says so. Messages with a » can be clicked to jump to the place they talk about.
- **Hint bar:** only appears when there is something to say (hovering the map or a building, or holding a tool).
- **PAUSED** badge whenever the game is paused with nothing else on screen.
- **End screen:** victory or defeat with your time, peak size, discoveries and towers taken, and buttons to replay the map, roll a new one, or (after a defeat) watch the rivals fight on.
- **Right:** the **minimap** (click or drag it to move the view), your **army** as unit icons with counts, the **order** buttons, and the **colony list**: each colony's playstyle, discoveries, who it is at war with and its size. A rival attacking you is shown in red. Click a colony to look at it.
- **Incoming attacks:** when an army is marching on you off screen, an arrow at the edge of the view points at it, in the attacker's colour, with its size.
- **MENU** (`M`): seed, restart, new map, how many rivals (3, 5, 7 or none), difficulty, edge view, controls and the how-to-play card. The game pauses while it is open.
- **Order buttons:** HOLD, then one button per living rival, two to a row.

### Defence

| Building | Unlocked by | What it does |
| --- | --- | --- |
| Wall | start | Cheap and very tough (750 health): it holds an army up for a long time. Your own units walk over it. |
| Crossbow Tower | start | Shoots the nearest enemy in range. |
| Ballista | research | Longest range; a huge bolt at the toughest enemy in sight. |
| Flame Tower | research | Short range; scorches every enemy near it at once. |
| Bell Tower | research | Towers near it reload 40% faster. |
| Frost Tower | research | Chills every enemy in range: half speed, half the strikes. |
| Lightning Tower | research | A bolt that leaps between up to five enemies. |
| Shrine | research | Heals your squares, tower and units nearby. |
| Bastion | research | A wall twice as tough again (1600 health). |
| Thorn Wall | research | A tough wall (550 health) that cuts every enemy who strikes it for 6 damage. |
| Cannon Tower | research | Long-range shells that blast whole groups. |
| Obelisk | research | A beam that locks on and burns hotter the longer it holds. |
| Hex Tower | research (Medieval) | Every 12 seconds it bewitches the nearest light enemy (45 health or less): it fights for you from then on. |
| Marksman Tower | research (Gunpowder) | Range 8, armour-piercing; picks off the back line first (monks, bearers, sappers, mages, catapults, artillery). |
| Radar | research (Industrial) | Every tower within 3 squares reaches 2 squares further. |
| Railgun | research (Modern) | A slug through every enemy unit in a straight line, 10 squares long, armour and all. |
| Nuke Silo | **rare** research (Modern) | Every 150 seconds a nuclear warhead flattens everything within 4 squares of a random building of the colony you attack, armies included (the Center Tower only takes a share). 900 gold. |

### Economy and science

| Building | Unlocked by | What it does |
| --- | --- | --- |
| Farm | start | **Free**, but very fragile (2 health), and enemy units go out of their way to trample farms near their path. 0.01 gold/s, +0.0075 for every farm touching it: alone it earns half a house, in a full block twice a house. |
| Research building | start | 0.2 science/s. |
| Mine | research | 0.3 gold/s, +0.25 for every mountain around it: up to about 2 gold/s on a ridge. |
| Fishery | research | 0.25 gold/s, +0.12 for every water square around it. |
| Library | research | 0.3 science/s, +0.15 for every science building touching it. |
| Market | research | +0.045 gold/s for every house of yours within 2 squares. |
| Observatory | research | 0.45 science/s, +0.2 for every mountain around it. |
| Bank | research | 0.5% of your saved gold every second, up to 4 gold/s. |
| Academy | research | 1.6 science/s anywhere. |
| Plaza | research | Your city grows 2.5 times as fast within 3 squares of it: steer where it spreads. |
| Lumber Mill | research (Medieval) | 0.2 gold/s, +0.12 for every forest square still standing around it. |
| Granary | research (Medieval) | +0.015 gold/s for every farm of yours within 2 squares. |
| Alchemist | research (Medieval) | Burns 0.4 gold/s into 0.6 science/s (stops when your treasury is empty). |
| Spy Den | research (Gunpowder) | +0.15 science/s for every rival still standing. |
| University | research (Industrial) | +0.012 science/s for every house of yours within 3 squares. |
| Stock Exchange | research (Modern) | +0.35 gold/s for every money building you own, anywhere. |

A house earns 0.02 gold/s, so one good Mine is worth a whole district. By 20 minutes a typical colony earns about 40% of its gold from houses, 25% from farms and a third from money buildings. Under your gold, the status panel splits your income into **HOUSES** and **ECONOMY** (farms plus every money building). Every 8 seconds each block of farms shows the gold it harvested over its middle, and hovering a farm says exactly what it earns and how much its neighbours add. When you are placing a money or science building, the tip bar shows what it would earn on the square under the cursor, and every money and science building pops its earnings over its roof every few seconds.

### Army

Every army building keeps a fixed number of its units alive, for free. Every unit changes a battle in its own way, with a clear strength and a clear weakness:

| Building | Unit | Role | Strength | Weakness |
| --- | --- | --- | --- | --- |
| Warrior Camp | Warrior | The mob | +10% damage for every warrior fighting beside it, up to +50%. | Nothing special alone. |
| Shield Barracks | Shield | The escort | Enemy towers shoot shields first, and do only half damage to them. | Slow; hits weakly. |
| Hound Yard | Hound | The raider | Fast; dodges fights on a raid, bites only houses, and loots 3 gold from every house it destroys. | Half damage to units; fragile. |
| Archery Range | Archer | The defender | Shoots units from 4 squares, 30% harder than melee. | Barely scratches buildings. |
| Spear Hall | Spearman | The line-breaker | On the attack, every 4 seconds (and whenever struck) hurls a spear that pierces every building in a straight line. | Poor against units: weak melee, and the spear only grazes them. |
| Stable | Knight | The hunter | Spots enemy units from 6 squares and rides them down; a charge hits three times as hard. | Poor against buildings. |
| Siege Workshop | Catapult | The artillery | Boulders at buildings from 6 squares, beyond crossbow range. | Never fights units. |
| Monastery | Monk | The healer | Heals the army around it. | Never fights. |
| Powder House | Sapper | The demolisher | The only unit that can blast a way through mountains; blows apart the squares it reaches. | Dies doing it. |
| Giant's Lair | Giant | The juggernaut | Its stomp hits every enemy around it and crushes the buildings too. | One at a time; slow. |
| Banner Hall | Standard Bearer | The inspiration | Every unit within 2.5 squares of a banner hits 25% harder and moves 15% faster. | Never fights. |
| Ram Works | Battering Ram | The wall-breaker | Armoured (takes half damage); smashes buildings three times as hard. | Never fights units; slow. |
| Arcane Hall | Mage | The artillery mage | Fireballs from 3.5 squares that burst over a whole group of enemy units. | Fragile; barely scratches buildings. |
| Thieves' Guild | Assassin | The infiltrator | Enemy towers cannot see it until it is 1.5 squares away: it slips past defences. Fast, deadly up close. | Fragile once spotted. |
| Helipad | Gunship | The hunter from the sky | Flies over everything and rakes enemy units with fire. | Never touches buildings; only anti-air and Center Towers can hit it. |

- You give one order to the whole colony: **Hold** or **Attack** one rival. On **Hold** your units defend: they gather at their buildings and go out after any enemy on or beside your land, up to 22 squares away.
- Anything left alone for 8 seconds repairs itself: walls, towers and buildings 5% of their health a second, the Center Tower 1%.
- Enemy squares are solid. Units go around or break through, whichever is quicker.
- Units steer: they cut corners and move diagonally, turn smoothly, and keep a little room from each other, so a squad moves as a crowd, not a single file.
- A group never piles onto one square: each square takes only as many attackers as it needs, and spare hounds go looking for another house.
- A destroyed square leaves rubble for 20 seconds; nothing can grow there until it clears.
- Squares cut off from your tower go dormant: no growth, income or units until they are joined up again.
- A colony under 40 squares grows up to 25% faster, to help it recover.
- Destroy a rival's Center Tower and the whole colony falls. Whoever was attacking it **plunders half its gold**, shared between them.

### Sound and music

Everything you hear is synthesised in the browser (no audio files):

- **Effects** for growth and building, every kind of shot (crossbow bolts, arrows, ballistas, spears, lightning, cannon booms, boulders, fireballs, railguns, rifles, hexes, gunfire, missiles and nukes), fire, frost and healing magic, melee clangs and heavy blows, deaths and collapsing buildings, loot, landmarks, discoveries, the start of each age, war horns, the tower alarm, victory and defeat. Effects come from where they happen: the further from your view, the quieter. Repeats are throttled so a big battle stays listenable.
- **Music:** a 16-bar chiptune song for each age (your colony's age), with a verse, a big chorus with a harmony line, drum fills into each section, and a tense battle layer while anyone is attacking you. It plays quieter while the game is paused.
  - Medieval (116 bpm): a galloping folk tune with a frame drum.
  - Gunpowder (124 bpm): a fife march over snare rolls.
  - Industrial (130 bpm): a driving rock riff over pumping bass.
  - Modern (138 bpm): a synth anthem with fast arpeggios and a four-on-the-floor beat.
- **Screen shake** is gentle: a few pixels at most, fading fast.

### What you see in a fight

- **Projectiles** each have their own look: crossbow bolts streak, arrows arc with a wooden shaft and white fletching, ballista bolts leave a wake, cannonballs and boulders tumble on an arc with a smoke trail, mage fireballs glow violet, hexes spiral green, a marksman's shot is a hair-thin tracer, a railgun slug is a blinding cyan beam with rings rippling along it, gunships spit yellow tracers.
- **Missiles and nukes** are in the air for a few seconds: a target marker (red for a missile, gold for a nuke) appears where they will land, and the warhead climbs, arcs and plunges with a flame and a smoke trail. The damage happens when it lands. A nuke flashes the screen white, sends a shockwave out and raises a mushroom cloud. Everyone is warned when a nuke is launched; you are warned when a missile is coming for you.
- **Health bars** have a dark frame, notches every quarter, green, then gold, then red as health falls, a pale chunk that shows what was just lost and drains away, and a blink below a quarter. Center Towers get a bigger bar framed in their colony's colour.
- **Volume:** MUSIC and SOUND in the menu (`M`), in steps of 25%, remembered between visits. Sound starts on your first click, as browsers require.

### The ages

Each colony moves through the ages on its own, by how many discoveries it has made: **Medieval** (the start, with its magic: Frost and Lightning Towers, the Obelisk, the Shrine, monks and giants), **Gunpowder** at 3 discoveries, **Industrial** at 6 and **Modern** at 9. Entering an age brings a **breakthrough**: a free discovery chosen only from that age's buildings (it counts towards the next age, so in practice that is 3, 5 and 7 discoveries of your own). Medieval usually lasts about 10 minutes. Research offers only what your age (or an earlier one) knows. The colony list shows each colony's age.

Anti-air only matters once there is something in the sky. Nobody gets it for free: the moment anyone builds an **Airfield** or a **Helipad**, the **AA Battery** starts turning up in research for everyone, in any age, and often (six times as likely as an ordinary option). A message says so.

| Age | Building | Its one job |
| --- | --- | --- |
| Gunpowder | Musket Range → Musketeers | Slow, huge shots that pierce armour: 2.5× damage to heavy units (knights, shields, giants, tanks). |
| Gunpowder | Printing Press | Every press makes each future discovery 8% cheaper (up to 40%). |
| Gunpowder | Cannon Tower, Powder House, Bank, Academy | (moved here from the medieval pool) |
| Industrial | Machine Gun Nest | A hail of light bullets at range 6: shreds unarmoured swarms; armour shrugs it off. |
| Industrial | Factory | Army buildings within 3 squares raise units 50% faster. |
| Industrial | Artillery Works → Artillery | Range 9, beyond every tower; shells only towers. |
| Modern | Tank Factory → Tanks | Armoured (take 35% damage); their shells hit units and buildings in an area. |
| Modern | Airfield → Bombers | Fly over walls and water to bomb the most valuable building of the colony you attack. Only AA Batteries and Center Towers can hit them. |
| Any (once someone flies) | AA Battery | The only tower that shoots aircraft; it shoots nothing else. |
| Modern | Power Plant | Money buildings within 3 squares earn 50% more. |
| Modern | Missile Silo | 450 gold. Every 45 seconds it fires a missile at a random building (never a house or the Center Tower) of the colony your army is attacking, anywhere on the map; on Hold, at the nearest rival. It lands 2.2 seconds later. |

Giants now have a thick hide (they take 60% of ordinary damage); ballista bolts and musket balls pierce armour.

### Research

- Science fills a bar. The first discovery costs 40 science and each one after costs 50% more, so in a game you get a handful of discoveries, not all of them: **every colony specialises** in a few towers and units. (Watching six AI rivals: the first discovery comes around 5 minutes with one research building, and by 15 minutes each has 5 to 8, with an army of two to four unit types.)
- A discovery pauses the game and offers **two choices**, each showing its price and what it earns (gold or science a minute). Or take neither: **+8% city growth**, for good (it does not count towards the next age). The game resumes once you choose.
- Almost every choice is a **new building** (53 of them to discover, and only a handful per game, so no two games are alike). About one choice in seven is a **rare modifier**, which always affects everything of a kind: "all units move 10% faster", "all towers reload 15% faster", "all gold income +10%". No modifier ever applies to just one unit or tower type.
- There are 33 modifiers. The classics: Forced March, Whetstones, Masonry, Trade Routes, Scribes, Architects, Chainmail, Drill Sergeants, Engineering, Clockwork, Roads, Battering Rams, Conscription, Artillery, Citadel and Golden Age. Plus: **Guild Charters** (buildings 15% cheaper), **Rich Soil** (houses earn 25% more), **Masons' Lodge** (repairs twice as fast), **Field Medicine** (units heal 1 health a second), **Boom Town** (city grows 15% faster), **Ballistics**, **Reinforced Concrete**, **Assembly Lines**, **Satellites** (towers +2 range), **Automation** (buildings 25% cheaper and built in half the time), and trade-offs that cut both ways: **Blood Oath** (+25% damage, −10% health), **Phalanx** (+30% health, −10% speed), **Rapid Fire** (reload 25% faster, −10% damage), **Standing Army** (+1 unit per building, raised 10% slower), **Enlightenment** (+30% science, −10% gold), **Mercantilism** (+25% gold, −10% science) and **Total War** (+20% damage, and +20% more to buildings).
- **It is not a tree.** Any building of your age can turn up; what you take shapes your playstyle. (Tiers still exist in the tuning, `tier2Picks`/`tier3Picks`, but are switched off.)
- Money and science buildings, and the gold and science modifiers, are rarer than the rest: about a third as likely as any other option.
- A re-roll costs 50 gold.
- The colony list shows how many technologies each colony has (`3T`). Hover it to see a rival's playstyle and what it discovered. A toast tells you when a rival unlocks one of the big buildings.
- Every option is data: `src/data/research.json`.

### Rivals

Every rival is run by an AI under the same rules and prices as you. Each follows its own **playstyle**: with up to five rivals they are all different; with seven, two styles appear twice.

| Playstyle | How it plays | First attack |
| --- | --- | --- |
| Fortress | Rings of towers and bastions; rolls forward with shields, archers and catapults. | ~6 min |
| Raiders | Hounds loot your houses, knights ride down your defenders. | ~3.5 min |
| Siege | Spearmen carve lines through your city; catapults, sappers and giants follow. | ~5 min |
| Horde | Camps everywhere, banners and monks behind them; attacks again and again. | ~4 min |
| Merchant | Gets rich first, then buys giants, knights and cannons. | ~8 min |

- It goes for the research its playstyle wants, builds what it unlocks, and spends spare gold on more towers and army.
- Nobody attacks in the first 100 seconds. After that a rival sets out as soon as its army is ready, or earlier if it badly outnumbers the target, so an early army gets used early.
- **It hits back.** A rival remembers who attacked it for 3 minutes and usually goes after them, setting out with only half an army if it must. Otherwise it favours the leading colony, close and weakly defended colonies, and colonies whose army is away.
- It finishes off a tower that is about to fall, falls back when beaten or when home is in danger, and builds new towers on the side the enemy comes from.
- **Late game:** once its city is fully covered it keeps adding towers in layers (up to a cap), a rich rival buys its strongest unlocked towers and units and keeps more army buildings, it answers a heavily fortified enemy with siege units (catapults, sappers, giants, spearmen, shields), and after 15 minutes it attacks with a smaller share of its full army, so the pressure keeps coming.
- `LEVEL` sets the difficulty: **Normal** (rivals attack 20% later), **Hard** (the default; rivals earn 25% more) or **Brutal** (they earn 50% more and attack 20% sooner). Changing it restarts the game.
- The `AI ATTACKS` button turns the attacks off.

## Controls

| Input | Action |
| --- | --- |
| Drag | Move the map |
| Mouse wheel, `+`, `-` | Zoom |
| `Z` `X` `C` `V` | Economy, Science, Defence and Army tabs; then click a building and click or drag across your houses |
| `Esc` | Put the tool away, or close the menu |
| `M` | Open or close the menu |
| `Space` | Pause or resume (building and orders still work while paused) |
| `1` `2` `3` | Game speed |
| `E` | Edge view: highlights the squares that can still grow |
| `H` | Jump back to your tower |
| `T` | Reopen the research card |
| `R` | Restart this map |

## Layout

- `src/sim` — the rules. No rendering, no input, no clock; one seeded random generator, so the same seed and commands replay the same match.
  - `growth.ts`, `economy.ts` — expansion, gold, science, prices.
  - `health.ts` — health, build-up time, rubble, defeat.
  - `nav.ts` — pathfinding fields, including breaking through enemy squares.
  - `topo.ts` — the shape of the map: neighbours, offsets and distances that wrap round the edges of a looping map (and stop at the edges of a flat test board).
  - `catalog.ts` — what every building is, what research unlocks, which unit each army building raises.
  - `units.ts` — unit production, movement, and every unit's fighting style.
  - `towers.ts` — every tower and how it fights.
  - `research.ts` — the research draft and what each option changes.
  - `link.ts` — which squares are cut off from their tower.
  - `ai.ts` — the AI for rival colonies: what to build and research, and when and whom to attack.
- `src/data/tuning.json` — every tunable number. `src/data/research.json` — every research option.
- `src/render` — pixel-art sprites (authored as text in `sprites.ts`), the shared palette and the canvas renderer.
- `src/ui` — interface styles and the size chart.
- `src/main.ts` — the browser loop, input and interface wiring.
- `tests` — simulation tests, run without graphics.
