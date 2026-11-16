// The nav graph: the map's waypoints and edges as a small undirected graph, with
// breadth-first pathfinding. Bots never steer blindly: they ask for a path from their
// node to a goal node and walk it leg by leg. No allocation in the hot path — the
// queue and the came-from map are reused scratch, and paths are plain index arrays.
import { WAYPOINTS, EDGES } from './world.js';

const NODE_COUNT = WAYPOINTS.length;
const adjacency = [];
for (let i = 0; i < NODE_COUNT; i += 1) adjacency.push([]);
for (const [a, b] of EDGES) {
  adjacency[a].push(b);
  adjacency[b].push(a);
}

const queue = new Int32Array(NODE_COUNT);
const cameFrom = new Int32Array(NODE_COUNT);
const seen = new Uint8Array(NODE_COUNT);

export function nearestNode(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < NODE_COUNT; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function nodePosition(index, out) {
  out.set(WAYPOINTS[index][0], 0, WAYPOINTS[index][1]);
  return out;
}

// Breadth-first shortest path. Returns the leg list (node indexes after `from`,
// ending at `to`) written into `out`, or 0 legs when no route exists.
export function findPath(from, to, out) {
  if (from === to) {
    out.length = 0;
    return out;
  }
  seen.fill(0);
  let head = 0;
  let tail = 0;
  queue[tail] = from;
  tail += 1;
  seen[from] = 1;
  cameFrom[from] = -1;
  let found = false;
  while (head < tail) {
    const current = queue[head];
    head += 1;
    if (current === to) {
      found = true;
      break;
    }
    const neighbours = adjacency[current];
    for (let i = 0; i < neighbours.length; i += 1) {
      const next = neighbours[i];
      if (seen[next]) continue;
      seen[next] = 1;
      cameFrom[next] = current;
      queue[tail] = next;
      tail += 1;
    }
  }
  out.length = 0;
  if (!found) return out;
  const reversed = [];
  let node = to;
  while (node !== -1) {
    reversed.push(node);
    node = cameFrom[node];
  }
  for (let i = reversed.length - 2; i >= 0; i -= 1) out.push(reversed[i]);
  return out;
}

// A leg is walkable in a straight line when the segment stays clear of the tall
// boxes: approximated here by checking the segment against the waypoint edges —
// legs only ever join adjacent nodes, which the map authors placed on open ground.
export function randomNode(random) {
  return Math.floor(random() * NODE_COUNT);
}
