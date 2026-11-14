// Sprites are authored as text and painted once at start-up. Everything is 8x8 pixels except
// the Center Tower, which is one single 16x16 sprite covering its four cells.
// "." is transparent; each other letter is looked up in a colour map.

import { Kind, UnitType } from '../sim/types';
import { COLONY, PAL, type ColonyColors } from './palette';

export const TILE = 8;
export type Sprite = HTMLCanvasElement;

function paint(rows: string[], colors: Record<string, string>): Sprite {
  const size = rows.length;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  for (let y = 0; y < size; y++) {
    const row = rows[y];
    for (let x = 0; x < size; x++) {
      const color = colors[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

const TREES: string[][] = [
  ['..dDD...', '.dDLDD..', 'dDLDDDd.', 'dDDDDDd.', '.dDDDd..', '..dtd...', '...t....', '........'],
  ['...D....', '..DLD...', '..dDd...', '.DLDDD..', '.dDDDd..', 'dDDDDDd.', '...t....', '........'],
  ['.DD.....', 'DLDd..D.', 'dDDd.DLD', '.t..dDDd', '.t...dd.', '......t.', '........', '........'],
];

const MOUNTAINS: string[][] = [
  ['...sS...', '..sSMm..', '..SMMm..', '.MMMMmm.', '.MMmMMm.', 'MMMMmMmm', 'MMmMMmmm', 'mmmmmmmm'],
  ['........', '....sS..', '...sMMm.', '.s.MMMm.', 'sSMMMmmm', 'SMMmMMmm', 'MMMMmMmm', 'mmmmmmmm'],
];

// Each house has one window and an off-centre door, so none of them reads as a face.
const HOUSES: string[][] = [
  ['........', '..HRRr..', '.HRRRRr.', 'HRRRRRRr', '.WWWWWw.', '.WnWWdw.', '.WWWWdw.', '........'],
  ['........', '.HRRRRr.', '.RRRRRr.', '.rrrrrr.', '.WWWWWw.', '.WWnWdw.', '.WWWWdw.', '........'],
  ['.....c..', '..HRrc..', '.HRRRRr.', 'HRRRRRRr', '.WWWWWw.', '.WdWnWw.', '.WdWWWw.', '........'],
  ['..HRr...', '.HRRRr..', '.rrrrr..', '.WWWWw..', '.WnWWwL.', '.WWWWwG.', '.WdWWwG.', '........'],
];

// One sprite for the whole 2x2 Center Tower. The flag is drawn separately so it can wave.
const TOWER = [
  '.......p........',
  '.......p........',
  '.......p........',
  '..S.SS.SS.SS.S..',
  '..SSSSSSSSSSSs..',
  '..SSSSSSSSSSSs..',
  '..RRRRRRRRRRRr..',
  '..rrrrrrrrrrrr..',
  '..SSSSSSSSSSSs..',
  '..SSnSSnSSnSSs..',
  '..SSnSSnSSnSSs..',
  '..SSSSSSSSSSSs..',
  '..SSSSSddSSSSs..',
  '..SSSSSddSSSSs..',
  '.SSSSSSddSSSSSs.',
  '.sDDDDDDDDDDDDD.',
];

const WALL = ['........', 'SS.SS.SS', 'SSSSSSSS', 'sSsRRSss', 'ssssssss', 'sDssDsss', 'DDDDDDDD', '........'];
const FARM = ['........', '.RRr.yY.', '.WWw.Yy.', '.WdW.yY.', '.yYyYyY.', '.YyYyYy.', '.yYyYyY.', '........'];
const FIELD = ['yYyYyYyY', 'YyYyYyYy', 'yYyYyYyY', 'YyYyYyYy', 'yYyYyYyY', 'YyYyYyYy', 'yYyYyYyY', 'YyYyYyYy'];
const RESEARCH = ['...gg...', '..HRRr..', '.HRRRRr.', '.SSSSSs.', '.DSDSDs.', '.DSDSDs.', '.SSddSs.', '........'];

const CROSSBOW = ['...kk...', '..kRRk..', '.k.RR.k.', '..SSSS..', '..SssS..', '..SnsS..', '..SssS..', '.SSSSSs.'];
const BARRACKS = ['........', '.HRRRRr.', 'HRRRRRRr', '.SSSSSs.', '.SHRRSs.', '.SSRRSs.', '.SSddSs.', '........'];
const KENNEL = ['........', 'k.k.k.k.', 'kkkkkkkk', '.RRr....', '.WWw.bb.', '.WpW.bb.', 'kkkkkkkk', '........'];
const RUBBLE = ['........', '..m.....', '.mMm..m.', '..m..mMm', '.....m..', '.mM.....', 'mMMm.mm.', '........'];

// Units are 6x6 and face right; the renderer mirrors them when they walk left.
const SHIELD_UNIT = ['..SS..', '..ff..', '.RRRSs', '.RRRSs', '..rr..', '.p.p..'];
const HOUND_UNIT = ['......', '....bb', 'b...bp', '.bbRb.', '.bbbb.', '.p..p.'];

// Buildings research unlocks.
const BALLISTA = ['k......k', '.k.WW.k.', '..kWWk..', '...kk...', '.SSRRSs.', '.SsRRsS.', '.SsddsS.', '.DDDDDD.'];
const FLAME = ['...o....', '..oOo.o.', '.oOOOoO.', '.SOOOOS.', '..SRRS..', '..SssS..', '..SRRS..', '.SSSSSs.'];
const BELL = ['...Rr...', '..RRRr..', '.SSSSSs.', '.S.BB.s.', '.SBBBBs.', '.S.pp.s.', '.SSSSSs.', '.DDDDDD.'];
const FROST = ['...Ii...', '..IiiI..', '..IiiI..', '...Ii...', '.SSRRSs.', '.SsIIsS.', '.SssssS.', '.DDDDDD.'];
const LIGHTNING = ['..Z..Z..', '...ZZ...', '...MM...', '..MZZM..', '...MM...', '..SRRS..', '.SSssSs.', '.DDDDDD.'];
const SHRINE = ['...E....', '..EeE...', '...E....', '.RRRRRr.', '.S.SS.s.', '.S.ee.s.', '.S.SS.s.', '.DDDDDD.'];
const CANNON = ['S.SS.S.S', 'SSSSSSSs', '.MMMMMMp', '.SSSSSs.', '.SRRRRs.', '.SsSSsS.', '.SsddsS.', 'DDDDDDDD'];
const OBELISK = ['...VV...', '...vV...', '..vvVv..', '..vVVv..', '..vvVv..', '..vVVv..', '.SSRRSs.', 'DDDDDDDD'];
const MINE = ['........', '..KKKK..', '.KKKKKK.', 'KkkkkkkK', 'Kk.pp.kK', 'Kk.pp.kK', '.kgRRgk.', '..p..p..'];
const FISHERY = ['...R....', '..RRr...', '.RRRRr..', '...k....', 'kkkkkkkk', 'k.k..k.k', 'QQQQQQQQ', 'QqQQQqQQ'];
const MARKET = ['........', 'RWRWRWRW', 'rWrWrWrW', '.k....k.', '.kOgEOk.', '.kkkkkk.', '.k....k.', '........'];
const BANK = ['...SS...', '..SggS..', '.SSSSSS.', '.DDDDDD.', '.SDSDSs.', '.SDSDSs.', '.SSSSSS.', 'DDDDDDDD'];
const LIBRARY = ['..HRRr..', '.HRRRRr.', 'HRRRRRRr', '.WWWWWw.', '.WOEiWw.', '.WOEiWw.', '.WWddWw.', '........'];
const OBSERVATORY = ['......p.', '..SSSp..', '.SSSpSs.', '.SSSSSs.', '.RRRRRr.', '.SnSSSs.', '.SSddSs.', '.DDDDDD.'];
const ACADEMY = ['...AA...', '..AAAa..', '.SSSSSS.', 'SnSnSnSs', 'SSSSSSSs', 'SnSddSnS', 'SSSddSSs', 'DDDDDDDD'];
const BASTION = ['SS.SS.SS', 'SSSSSSSS', 'SsSSSsSS', 'SSRRRRSs', 'SsRrrRss', 'SSSSSSSs', 'sDsDsDsD', 'DDDDDDDD'];
const CAMP = ['...pR...', '...p....', '...H....', '..HRr...', '.HRRRr..', 'HRRpRRr.', 'RRRpRRrr', 'kkkkkkkk'];
const ARCHERY = ['.RRRR...', 'RWWWWR..', 'RWRRWR..', 'RWRRWR.k', 'RWWWWR.k', '.RRRR..k', '..k..k.k', '.kk..kk.'];
const SPEARHALL = ['W......W', '.k....k.', '..k..k..', '.HRkkRr.', 'HRRRRRRr', '.WWWWWw.', '.WnWWdw.', '.WWWWdw.'];
const STABLE = ['...HR...', '..HRRr..', '.HRRRRr.', 'HRRRRRRr', '.kkkkkk.', '.kpWWpk.', '.kpWWpk.', '.kkkkkk.'];
const WORKSHOP = ['..MM.MM.', '..MMMMM.', '.SSSSSSs', '.SkkkkSs', '.SkMMkSs', '.SkkkkSs', '.SSddSSs', 'DDDDDDDD'];
const MONASTERY = ['...W....', '..WWW...', '...W....', '..SSS...', '.SSSSS..', 'SSSnSSS.', 'SSSdSSS.', 'DDDDDDD.'];
const POWDER = ['........', '.SSSSSs.', '.SRSSRs.', '.SSRRSs.', '.SRSSRs.', '.SSSSSs.', '.kOk.kOk', '.kkk.kkk'];
const PLAZA = ['R......R', '.SSSSSS.', '.SQqqQs.', '.SqMMqs.', '.SqMMqs.', '.SQqqQs.', '.SsssSs.', 'R......R'];
const THORNS = ['k.k.k.k.', 'kSkSkSkS', 'SSSSSSSS', 'sSsRRSss', 'ssssssss', 'sDssDsss', 'DDDDDDDD', '........'];
const BANNERHALL = ['p..p..p.', 'RR.RR.RR', 'Rr.Rr.Rr', 'HRRRRRRr', '.SSSSSs.', '.SnSSns.', '.SSddSs.', 'DDDDDDDD'];
// The later ages: gunpowder, industry, the modern day.
const MUSKET = ['k......k', '.k....k.', '..k..k..', '.HRRRRr.', 'HRRRRRRr', '.SSSSSs.', '.SnSSns.', '.SSddSs.'];
const PRESS = ['.WWWWWW.', '.WpWpWW.', '.WWWWWW.', 'HRRRRRRr', '.SMMMMs.', '.SMkkMs.', '.SSddSs.', 'DDDDDDDD'];
const FACTORY = ['.M....M.', '.M....M.', '.MS..SM.', 'SSSSSSSS', 'SnSnSnSs', 'SSSSSSSs', 'SSSddSSs', 'DDDDDDDD'];
const MGNEST = ['........', '....MMMM', '...MM...', '.yYyYyY.', 'yYMMMMYy', 'YyMppMyY', 'yYyYyYyY', '.DDDDDD.'];
const ARTWORKS = ['......MM', '....MMM.', '..MMM...', '.SMSSSs.', 'SSSSSSSs', 'SkkSSkks', 'SkkddkkS', 'DDDDDDDD'];
const TANKWORKS = ['.SSSSSS.', 'SSSSSSSS', 'SMMMMMMS', 'SM....MS', 'SMRRRRMS', 'SMppppMS', 'SSSSSSSS', 'DDDDDDDD'];
const AIRFIELD = ['DDDDDDDD', 'D..W...D', 'D.WWW..D', 'DWWRWWWD', 'D.WWW..D', 'D..W...D', 'DyDyDyDy', 'DDDDDDDD'];
const AA = ['.M..M...', '.M..M...', '.MM.MM..', '..MMM...', '.SRRRSs.', '.SSSSSs.', '.SsddsS.', 'DDDDDDDD'];
const POWER = ['..SSSS..', '..S..S..', '.S....S.', '.S.ZZ.S.', '.S.Z..S.', 'S..ZZ..S', 'SSSSSSSS', 'DDDDDDDD'];
const SILO = ['...R....', '..RWR...', '..WWW...', '..WRW...', '..WWW...', '.SWWWS..', 'SSDDDSSs', 'DDDDDDDD'];
const HEX = ['.E....E.', '..E..E..', '...VV...', '..VEEV..', '.SSVVSs.', '.SvEEvS.', '.SsvvsS.', 'DDDDDDDD'];
const MARKSMAN = ['...pp...', '..RRRr..', 'MMMRR...', '.SSSSSs.', '..SnsS..', '..SssS..', '..SnsS..', '.SSSSSs.'];
const RAILGUN = ['......Ae', '....AMM.', '..AMM...', '.MMM....', '.SRRRSs.', 'SSSSSSSs', 'SAaAaAsS', 'DDDDDDDD'];
const RADAR = ['.MMMMMM.', 'M......M', '.M.Z..M.', '..MMMM..', '....M...', '.SRRRSs.', '.SsssSs.', 'DDDDDDDD'];
const NUKE = ['...y....', '..yYy...', '..pyp...', '..yYy...', '..ypy...', '.SyYyS..', 'SSDDDSSs', 'DpDyDpDD'];
const RAMWORKS = ['........', '.HRRRRr.', 'HRRRRRRr', '.kkkkkk.', 'MMkkkkMM', '.kkkkkk.', '.p.pp.p.', 'kkkkkkkk'];
const ARCANUM = ['...V....', '..VvV...', '.VVvVV..', '..SSS...', '.SRRRS..', '.SnVnS..', '.SSdSS..', 'DDDDDDDD'];
const GUILD = ['........', '.pppppp.', 'pRRRRRRp', '.SSSSSs.', '.SnSSns.', '.SSppSs.', '.SSppSs.', 'DDDDDDDD'];
const HELIPAD = ['DDDDDDDD', 'DMMMMMMD', 'DMyMMyMD', 'DMyyyyMD', 'DMyMMyMD', 'DMyMMyMD', 'DMMMMMMD', 'DDDDDDDD'];
const LUMBERMILL = ['...k....', '..HRr...', '.HRRRr..', '.WWWWw.k', '.WdWWwkk', '.WdWWw.k', 'kkkkkkkk', 'k.k.k.k.'];
const GRANARY = ['...RR...', '..RRRr..', '.RRRRRr.', '.WWWWWw.', '.WyYyYw.', '.WyYyYw.', '.WWddWw.', '........'];
const EXCHANGE = ['.SSSSSS.', 'SSSSSSSS', '.S.S.S.S', '.S.S.S.S', '.SgSgSgS', '.S.S.S.S', 'SSSSSSSS', 'DDDDDDDD'];
const ALCHEMIST = ['......A.', '...c.AAa', '..HRr.a.', '.HRRRr..', '.WWWWw..', '.WAgAw..', '.WWddw..', '........'];
const UNIVERSITY = ['...AA...', '..AaaA..', '.SSSSSS.', 'SRRRRRRS', 'SnSnSnSS', 'SSSSSSSS', 'SnSddSnS', 'DDDDDDDD'];
const SPYDEN = ['........', '..pppp..', '.pppppp.', 'ppRRRRpp', '.SSSSSs.', '.SnSSns.', '.SSddSs.', 'DDDDDDDD'];
const RAM_UNIT = ['......', '.RRRR.', 'RRRRRR', 'kkkkMM', 'kkkkMM', '.p..p.'];
const MAGE_UNIT = ['..VV.e', '.VVVVk', '..ff.k', '.RRRRk', '.RRR.k', '.p.p.k'];
const ASSASSIN_UNIT = ['..pp..', '..pf..', '.pRRp.', 'W.RRp.', '..rr..', '.p.p..'];
const GUNSHIP_UNIT = ['........', '...M....', '..RRRR..', 'MRRRRRRn', '.RRRRRR.', '...M....', '..MMMM..', '........'];
const LAIR = ['..KKKK..', '.KKKKKK.', 'KKKRrKKK', 'KKppppKK', 'KppppppK', 'KppppppK', 'KkpppkKK', 'KKKKKKKK'];

const WARRIOR_UNIT = ['..ff..', '..ff.W', '.RRRW.', '.RRR..', '..rr..', '.p.p..'];
const ARCHER_UNIT = ['..rr..', '..ffk.', '.RRk.k', '.RRRk.', '..rrk.', '.p.p..'];
const SPEAR_UNIT = ['.....W', '..ff.k', '..ff.k', '.RRRRk', '..rr.k', '.p.p.k'];
const KNIGHT_UNIT = ['..SS..', '..RRW.', '..RR..', 'bbbbbp', 'bbbbb.', '.b..b.'];
const CATAPULT_UNIT = ['....kk', '...kM.', '..k...', 'kkkkkk', 'kRRRRk', '.p..p.'];
const MONK_UNIT = ['..ee..', '..ff..', '.rRRr.', '.RRRR.', '.RRRR.', '..pp..'];
const SAPPER_UNIT = ['..rr..', '..ff..', '.RRR.o', '.RRRMM', '..rrMM', '.p.p..'];
const GIANT_UNIT = ['..ffff..', '..fpfp..', '..ffff..', '.RRRRRR.', 'fRRRRRRf', 'f.RRRR.f', '..rr.rr.', '..pp.pp.'];
const MUSKETEER_UNIT = ['..rr..', '..ff.M', '.RRRM.', '.RRM..', '..rr..', '.p.p..'];
const ARTILLERY_UNIT = ['.....M', '...MM.', '.kMM..', 'kkkkk.', 'kRkRk.', '.p..p.'];
const TANK_UNIT = ['........', '........', '...RRMMM', '..RRRR..', '.MMMMMM.', 'MpMpMpMM', '.MMMMMM.', '........'];
const BOMBER_UNIT = ['........', '..RR....', '...RR...', 'RRRRRRRW', '...RR...', '..RR....', '........', '........'];
const BEARER_UNIT = ['pRRR..', 'pRRr..', 'p.ff..', 'pRRR..', 'p.rr..', 'p.p.p.'];
const COIN = ['........', '..gggg..', '.gGGGGg.', '.gGggGg.', '.gGggGg.', '.gGGGGg.', '..gggg..', '........'];
const FLASK = ['...bb...', '...bb...', '...bb...', '..bBBb..', '.bBLBBb.', '.bBBBBb.', '.bbbbbb.', '........'];

export interface ColonySprites {
  houses: Sprite[];
  /** 16x16: the whole Center Tower in one piece. */
  tower: Sprite;
  /** Converted buildings, indexed by Kind. */
  buildings: Record<number, Sprite>;
  /** A farm with farms around it: plain crops, no barn. */
  field: Sprite;
  /** Units indexed by UnitType; each as [facing right, facing left]. */
  units: Record<number, [Sprite, Sprite]>;
  /** The second walking frame of each unit. */
  unitsWalk: Record<number, [Sprite, Sprite]>;
  /** A white silhouette of each unit, flashed when it is hit. */
  unitsFlash: Record<number, [Sprite, Sprite]>;
}

export interface SpriteSet {
  trees: Sprite[];
  mountains: Sprite[];
  rubble: Sprite;
  colonies: ColonySprites[];
  icons: { gold: Sprite; science: Sprite };
  /** Landmarks: Ancient Ruins and Treasure. */
  ruins: Sprite;
  treasure: Sprite;
}

function colonySprites(c: ColonyColors): ColonySprites {
  const colors = {
    R: c.main,
    r: c.dark,
    H: c.light,
    W: PAL.wall,
    w: PAL.wallShade,
    d: PAL.door,
    n: PAL.window,
    c: PAL.chimney,
    G: PAL.leafMid,
    L: PAL.leafLight,
    S: PAL.stoneLight,
    s: PAL.stoneMid,
    D: PAL.stoneDark,
    p: PAL.ink,
    y: PAL.wheat,
    Y: PAL.wheatDark,
    g: PAL.gold,
    k: PAL.trunk,
    b: PAL.fur,
    f: PAL.skin,
    K: PAL.rockMid,
    Q: PAL.water,
    q: PAL.waterLight,
    O: PAL.fire,
    o: PAL.fireLight,
    I: PAL.ice,
    i: PAL.iceDark,
    Z: PAL.spark,
    M: PAL.metal,
    B: PAL.bronze,
    V: PAL.void,
    v: PAL.voidDark,
    E: PAL.holy,
    e: PAL.holyLight,
    A: PAL.science,
    a: PAL.scienceDark,
  };
  const both = (rows: string[]): [Sprite, Sprite] => {
    const right = paint(rows, colors);
    return [right, mirror(right)];
  };
  const unitRows: Record<number, string[]> = {
    [UnitType.Shield]: SHIELD_UNIT,
    [UnitType.Hound]: HOUND_UNIT,
    [UnitType.Warrior]: WARRIOR_UNIT,
    [UnitType.Archer]: ARCHER_UNIT,
    [UnitType.Spearman]: SPEAR_UNIT,
    [UnitType.Knight]: KNIGHT_UNIT,
    [UnitType.Catapult]: CATAPULT_UNIT,
    [UnitType.Monk]: MONK_UNIT,
    [UnitType.Sapper]: SAPPER_UNIT,
    [UnitType.Giant]: GIANT_UNIT,
    [UnitType.Bearer]: BEARER_UNIT,
    [UnitType.Musketeer]: MUSKETEER_UNIT,
    [UnitType.Artillery]: ARTILLERY_UNIT,
    [UnitType.Tank]: TANK_UNIT,
    [UnitType.Bomber]: BOMBER_UNIT,
    [UnitType.Ram]: RAM_UNIT,
    [UnitType.Mage]: MAGE_UNIT,
    [UnitType.Assassin]: ASSASSIN_UNIT,
    [UnitType.Gunship]: GUNSHIP_UNIT,
  };
  const unitsWalk: Record<number, [Sprite, Sprite]> = {};
  const unitsFlash: Record<number, [Sprite, Sprite]> = {};
  for (const [type, rows] of Object.entries(unitRows)) {
    unitsWalk[Number(type)] = both(walkFrame(rows));
    const [right, left] = both(rows);
    unitsFlash[Number(type)] = [silhouette(right, '#ffffff'), silhouette(left, '#ffffff')];
  }
  return {
    houses: HOUSES.map((rows) => paint(rows, colors)),
    tower: paint(TOWER, colors),
    field: paint(FIELD, colors),
    buildings: {
      [Kind.Wall]: paint(WALL, colors),
      [Kind.Farm]: paint(FARM, colors),
      [Kind.Research]: paint(RESEARCH, colors),
      [Kind.Crossbow]: paint(CROSSBOW, colors),
      [Kind.Barracks]: paint(BARRACKS, colors),
      [Kind.Kennel]: paint(KENNEL, colors),
      [Kind.Ballista]: paint(BALLISTA, colors),
      [Kind.Flame]: paint(FLAME, colors),
      [Kind.Bell]: paint(BELL, colors),
      [Kind.Frost]: paint(FROST, colors),
      [Kind.Lightning]: paint(LIGHTNING, colors),
      [Kind.Shrine]: paint(SHRINE, colors),
      [Kind.Cannon]: paint(CANNON, colors),
      [Kind.Obelisk]: paint(OBELISK, colors),
      [Kind.Mine]: paint(MINE, colors),
      [Kind.Fishery]: paint(FISHERY, colors),
      [Kind.Market]: paint(MARKET, colors),
      [Kind.Bank]: paint(BANK, colors),
      [Kind.Library]: paint(LIBRARY, colors),
      [Kind.Observatory]: paint(OBSERVATORY, colors),
      [Kind.Academy]: paint(ACADEMY, colors),
      [Kind.Bastion]: paint(BASTION, colors),
      [Kind.Camp]: paint(CAMP, colors),
      [Kind.Archery]: paint(ARCHERY, colors),
      [Kind.SpearHall]: paint(SPEARHALL, colors),
      [Kind.Stable]: paint(STABLE, colors),
      [Kind.Workshop]: paint(WORKSHOP, colors),
      [Kind.Monastery]: paint(MONASTERY, colors),
      [Kind.PowderHouse]: paint(POWDER, colors),
      [Kind.GiantLair]: paint(LAIR, colors),
      [Kind.Plaza]: paint(PLAZA, colors),
      [Kind.Thorns]: paint(THORNS, colors),
      [Kind.BannerHall]: paint(BANNERHALL, colors),
      [Kind.MusketRange]: paint(MUSKET, colors),
      [Kind.PrintingPress]: paint(PRESS, colors),
      [Kind.Factory]: paint(FACTORY, colors),
      [Kind.MachineGun]: paint(MGNEST, colors),
      [Kind.ArtilleryWorks]: paint(ARTWORKS, colors),
      [Kind.TankFactory]: paint(TANKWORKS, colors),
      [Kind.Airfield]: paint(AIRFIELD, colors),
      [Kind.AABattery]: paint(AA, colors),
      [Kind.PowerPlant]: paint(POWER, colors),
      [Kind.MissileSilo]: paint(SILO, colors),
      [Kind.Hex]: paint(HEX, colors),
      [Kind.Marksman]: paint(MARKSMAN, colors),
      [Kind.Railgun]: paint(RAILGUN, colors),
      [Kind.Radar]: paint(RADAR, colors),
      [Kind.NukeSilo]: paint(NUKE, colors),
      [Kind.RamWorks]: paint(RAMWORKS, colors),
      [Kind.Arcanum]: paint(ARCANUM, colors),
      [Kind.Guild]: paint(GUILD, colors),
      [Kind.Helipad]: paint(HELIPAD, colors),
      [Kind.LumberMill]: paint(LUMBERMILL, colors),
      [Kind.Granary]: paint(GRANARY, colors),
      [Kind.Exchange]: paint(EXCHANGE, colors),
      [Kind.Alchemist]: paint(ALCHEMIST, colors),
      [Kind.University]: paint(UNIVERSITY, colors),
      [Kind.SpyDen]: paint(SPYDEN, colors),
    },
    units: {
      [UnitType.Shield]: both(SHIELD_UNIT),
      [UnitType.Hound]: both(HOUND_UNIT),
      [UnitType.Warrior]: both(WARRIOR_UNIT),
      [UnitType.Archer]: both(ARCHER_UNIT),
      [UnitType.Spearman]: both(SPEAR_UNIT),
      [UnitType.Knight]: both(KNIGHT_UNIT),
      [UnitType.Catapult]: both(CATAPULT_UNIT),
      [UnitType.Monk]: both(MONK_UNIT),
      [UnitType.Sapper]: both(SAPPER_UNIT),
      [UnitType.Giant]: both(GIANT_UNIT),
      [UnitType.Bearer]: both(BEARER_UNIT),
      [UnitType.Musketeer]: both(MUSKETEER_UNIT),
      [UnitType.Artillery]: both(ARTILLERY_UNIT),
      [UnitType.Tank]: both(TANK_UNIT),
      [UnitType.Bomber]: both(BOMBER_UNIT),
      [UnitType.Ram]: both(RAM_UNIT),
      [UnitType.Mage]: both(MAGE_UNIT),
      [UnitType.Assassin]: both(ASSASSIN_UNIT),
      [UnitType.Gunship]: both(GUNSHIP_UNIT),
    },
    unitsWalk,
    unitsFlash,
  };
}

/** The second step of a walk: the feet swap places. */
function walkFrame(rows: string[]): string[] {
  const last = rows[rows.length - 1];
  let feet = last.split('').reverse().join('');
  if (feet === last) feet = '.' + last.slice(0, -1);
  return [...rows.slice(0, -1), feet];
}

/** The sprite's shape in one flat colour: hit flashes and drop shadows. */
export function silhouette(sprite: Sprite, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.drawImage(sprite, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function mirror(sprite: Sprite): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.scale(-1, 1);
  g.drawImage(sprite, -sprite.width, 0);
  return canvas;
}

export function buildSprites(): SpriteSet {
  const leaves = { d: PAL.leafDark, D: PAL.leafMid, L: PAL.leafLight, t: PAL.trunk };
  const rock = { s: PAL.snow, S: PAL.snowShade, M: PAL.rockLight, m: PAL.rockDark };
  return {
    trees: TREES.map((rows) => paint(rows, leaves)),
    mountains: MOUNTAINS.map((rows) => paint(rows, rock)),
    rubble: paint(RUBBLE, { M: PAL.rockMid, m: PAL.rockDark }),
    colonies: COLONY.map(colonySprites),
    icons: {
      gold: paint(COIN, { g: PAL.goldDark, G: PAL.gold }),
      science: paint(FLASK, { b: PAL.scienceDark, B: PAL.science, L: PAL.scienceLight }),
    },
    ruins: paint(['S.....S.', 'S..S..S.', 'S..S.vS.', 'S.vSvvS.', 'SvvSvvS.', 'SSSSSSSS', 'ssssssss', '........'], { S: PAL.stoneLight, s: PAL.stoneMid, v: PAL.void }),
    treasure: paint(['........', '..bbbb..', '.bbbbbb.', 'kGkkkkGk', 'kGkgGkGk', 'kGkkkkGk', 'kkkkkkkk', 'G.g..G.g'], { k: PAL.trunk, b: PAL.fur, g: PAL.goldDark, G: PAL.gold }),
  };
}
