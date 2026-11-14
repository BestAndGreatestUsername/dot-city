// One shared palette for every sprite and every piece of interface.

export const PAL = {
  ink: '#12131f',
  night: '#0b0c16',

  grass: '#5f9b4a',
  grassDark: '#52893f',
  grassLight: '#73b057',
  flower: '#f3e287',

  leafDark: '#28583a',
  leafMid: '#38784a',
  leafLight: '#58a45c',
  trunk: '#6b4428',

  rockLight: '#a9afbf',
  rockMid: '#7f869a',
  rockDark: '#5a6076',
  snow: '#f1f5f9',
  snowShade: '#cdd8e6',

  water: '#3f74c6',
  waterDark: '#335fa8',
  waterLight: '#86baee',

  ground: '#c8b283',
  groundDark: '#b09a6a',

  wall: '#f3e6c4',
  wallShade: '#d2bf96',
  door: '#6b4428',
  window: '#2b3352',
  chimney: '#8d5b49',

  stoneLight: '#c0c5d2',
  stoneMid: '#9197a8',
  stoneDark: '#666c80',

  wheat: '#f0d05a',
  wheatDark: '#c79f2e',

  fur: '#a06c40',

  fire: '#ff7a2a',
  fireLight: '#ffd34a',
  ice: '#bfe9ff',
  iceDark: '#4aa8e6',
  spark: '#fff36a',
  metal: '#3a3f52',
  bronze: '#d79a3a',
  void: '#c06cff',
  voidDark: '#5a2a8a',
  holy: '#7be36a',
  holyLight: '#d4ffbf',
  skin: '#f2caa0',

  science: '#3fd0c9',
  scienceDark: '#1f7a78',
  scienceLight: '#c8fff4',

  gold: '#ffcd4a',
  goldDark: '#c9952a',
  good: '#7be36a',
  bad: '#ff6b6b',
  paper: '#f4ecd8',
} as const;

export interface ColonyColors {
  name: string;
  main: string;
  dark: string;
  light: string;
}

export const COLONY: ColonyColors[] = [
  { name: 'Azure', main: '#3f82e0', dark: '#27549c', light: '#93c4ff' },
  { name: 'Ember', main: '#dc4c3f', dark: '#982c29', light: '#ff9c86' },
  { name: 'Amber', main: '#e6a92e', dark: '#a6721a', light: '#ffdc7c' },
  { name: 'Violet', main: '#9659cc', dark: '#643a92', light: '#d0a2f6' },
  { name: 'Jade', main: '#3fae5f', dark: '#25713c', light: '#97e6a8' },
  { name: 'Ivory', main: '#e9e3cf', dark: '#9c9580', light: '#ffffff' },
  { name: 'Teal', main: '#2aa8b0', dark: '#1b6d73', light: '#8be4ea' },
  { name: 'Coal', main: '#5a5f74', dark: '#383b4b', light: '#a6abc2' },
];
