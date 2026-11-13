// D5: squares cut off from their Center Tower go dormant. They stop growing, earning and
// producing units until they are reconnected. Their defences keep firing.
//
// "Connected" means reachable from the tower through the colony's own squares, moving
// orthogonally (D2). Buildings count as links just like houses.

import { step } from './topo';
import { Kind, type GameState } from './types';

/** Recompute which squares are cut off, for every colony whose territory changed. */
export function refreshLinks(s: GameState): void {
  for (const colony of s.colonies) {
    if (!colony.linkDirty) continue;
    colony.linkDirty = false;
    colony.dormant = { cells: 0, houses: 0, farms: 0, farmLinks: 0, research: 0 };
    if (!colony.alive) continue;

    const id = colony.id;
    const reached = new Uint8Array(s.kind.length);
    const stack: number[] = [];
    for (const c of colony.towerCells) {
      reached[c] = 1;
      stack.push(c);
    }
    while (stack.length > 0) {
      const c = stack.pop() as number;
      for (let dir = 0; dir < 4; dir++) {
        const n = step(s, c, dir);
        if (n >= 0 && !reached[n] && s.owner[n] === id) {
          reached[n] = 1;
          stack.push(n);
        }
      }
    }

    const d = colony.dormant;
    for (let c = 0; c < s.kind.length; c++) {
      if (s.owner[c] !== id) continue;
      const cut = reached[c] ? 0 : 1;
      s.cutOff[c] = cut;
      if (!cut) continue;
      d.cells++;
      const kind = s.kind[c];
      if (kind === Kind.House) d.houses++;
      else if (kind === Kind.Research) d.research++;
      else if (kind === Kind.Farm) {
        d.farms++;
        // The bonus this farm draws from its neighbours is lost with it.
        for (let dir = 0; dir < 4; dir++) {
          const n = step(s, c, dir);
          if (n >= 0 && s.kind[n] === Kind.Farm && s.owner[n] === id) d.farmLinks++;
        }
      }
    }
  }
}
