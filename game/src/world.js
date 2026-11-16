// The map: Kestrel Yard, a dusk freight yard turned into a tactical arena. Two plant
// sites (A Silo, B Crane) at the north end, attacker spawn at the south gate, three
// lanes between them — west lane, mid containers, east lane — with crates, container
// stacks and wall stubs for corners and sightlines. Every box is a collider for the
// player and bots and a surface a bullet stops on. Plain geometry only, no models,
// no textures, no network. The map also owns the nav graph: waypoint nodes and edges
// the bots walk, the site zones, and both teams' spawns.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: [x, z] nodes the bots path over. Edges join neighbours a bot can walk
// between in a straight line without crossing a wall or a tall box.
export const WAYPOINTS = [
  // Attacker spawn (south gate)
  [-8, 15], [0, 15.5], [8, 15],
  // South yard
  [-14, 11], [-4, 11.5], [4, 11.5], [14, 11],
  // West lane
  [-17, 5], [-13, 4], [-17, -2], [-12, -3],
  // Mid containers
  [-5, 5], [0, 4], [5, 5], [-4, -1], [4, -1], [0, -5],
  // East lane
  [17, 5], [13, 4], [17, -2], [12, -3],
  // Site A approach + site
  [-16, -7], [-19, -11], [-13, -11], [-16, -14.5],
  // Site B approach + site
  [16, -7], [19, -11], [13, -11], [16, -14.5],
  // Defender spawn (north)
  [-8, -15], [0, -15.5], [8, -15],
];

export const EDGES = [
  [0, 1], [1, 2], [0, 3], [1, 4], [1, 5], [2, 6],
  [3, 7], [4, 8], [5, 9], [6, 10],
  [7, 11], [7, 12], [8, 12], [9, 13], [10, 13],
  [11, 14], [12, 14], [13, 15], [12, 15],
  [8, 16], [9, 16], [10, 17], [9, 17], [8, 17],
  [14, 18], [14, 19], [15, 20], [16, 21],
  [18, 23], [19, 23], [20, 24], [21, 24],
  [18, 25], [19, 25], [20, 26], [21, 26],
  [23, 27], [24, 28], [25, 29], [26, 30],
  [27, 29], [28, 30],
  [4, 8], [5, 9], [16, 18], [17, 19],
];

export const SITES = {
  A: { name: 'A · Silo', center: new THREE.Vector3(-16, 0, -11), radius: 4.2 },
  B: { name: 'B · Crane', center: new THREE.Vector3(16, 0, -11), radius: 4.2 },
};

export const SPAWNS = {
  // Vanguard (attackers, player team): south gate, facing north (-z).
  attack: [
    { x: -6, z: 15.5, yaw: 0 },
    { x: -2, z: 16, yaw: 0 },
    { x: 2, z: 16, yaw: 0 },
    { x: 6, z: 15.5, yaw: 0 },
  ],
  // Ashen (defenders): north end, facing south (+z).
  defend: [
    { x: -18, z: -14, yaw: Math.PI },
    { x: -10, z: -15.5, yaw: Math.PI },
    { x: 0, z: -15.5, yaw: Math.PI },
    { x: 10, z: -15.5, yaw: Math.PI },
    { x: 18, z: -14, yaw: Math.PI },
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // Containers read as painted steel: a little glossier than concrete.
  const containerMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.25 });
  const containerMatB = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.pine), roughness: 0.6, metalness: 0.25 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, container = null) {
    const mat = container === 'rust' ? containerMat : container === 'pine' ? containerMatB : materials[material];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor: 46 x 36 m yard, 5 m walls, open to the dusk sky.
  box(46.4, 0.4, 36.4, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 36.4, -23.2, 2.5, 0, 'surface');
  box(0.4, 5, 36.4, 23.2, 2.5, 0, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, -18.2, 'surface');
  box(46.4, 5, 0.4, 0, 2.5, 18.2, 'surface');

  // North silo wall (site A backdrop) and crane gantry legs (site B backdrop).
  box(10, 5, 1.2, -16, 2.5, -16.4, 'hairline');
  box(1.0, 5, 1.0, 12.5, 2.5, -16.6, 'hairline');
  box(1.0, 5, 1.0, 19.5, 2.5, -16.6, 'hairline');
  box(8, 0.8, 1.0, 16, 4.6, -16.6, 'hairline');

  // Mid container row: the spine of the map, with a gap at mid for the cross lane.
  box(6, 2.6, 2.6, -8, 1.3, 2, 'surface', 'rust');
  box(6, 2.6, 2.6, 8, 1.3, 2, 'surface', 'pine');
  box(6, 2.6, 2.6, -8, 1.3, -4.5, 'surface', 'pine');
  box(6, 2.6, 2.6, 8, 1.3, -4.5, 'surface', 'rust');
  // Stacked container on the west mid block: a sightline over the yard.
  box(6, 2.6, 2.6, -8, 3.9, -4.5, 'surface', 'rust');

  // West lane: wall stubs and crates.
  box(0.8, 2.4, 5, -19.5, 1.2, 1, 'surface');
  box(1.6, 1.1, 1.6, -14, 0.55, 7.5, 'hairline');
  box(1.6, 1.1, 1.6, -13, 0.55, -6.5, 'hairline');
  box(3.4, 1.1, 1.2, -19, 0.55, -7.5, 'hairline');
  // East lane mirrors it.
  box(0.8, 2.4, 5, 19.5, 1.2, 1, 'surface');
  box(1.6, 1.1, 1.6, 14, 0.55, 7.5, 'hairline');
  box(1.6, 1.1, 1.6, 13, 0.55, -6.5, 'hairline');
  box(3.4, 1.1, 1.2, 19, 0.55, -7.5, 'hairline');

  // South yard crates near spawn: early cover for the push out of the gate.
  box(2.4, 1.1, 1.2, -4, 0.55, 12.5, 'hairline');
  box(2.4, 1.1, 1.2, 4, 0.55, 12.5, 'hairline');
  box(1.2, 1.1, 2.4, 0, 0.55, 9, 'hairline');

  // Site A crates (silo yard) and site B crates (crane yard).
  box(1.6, 1.1, 1.6, -19.5, 0.55, -8, 'hairline');
  box(1.6, 1.1, 1.6, -12.5, 0.55, -13.5, 'hairline');
  box(1.6, 1.1, 1.6, 19.5, 0.55, -8, 'hairline');
  box(1.6, 1.1, 1.6, 12.5, 0.55, -13.5, 'hairline');

  // Site markers: a flat amber ring on the floor so a plant zone reads at a glance.
  function siteRing(site, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.25, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.02, site.center.z);
    group.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(site.radius - 0.25, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.07, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.center.x, 0.015, site.center.z);
    group.add(disc);
  }
  siteRing(SITES.A, PALETTE.accent);
  siteRing(SITES.B, PALETTE.accent);

  // Light: low amber sun from the west, cool dusk fill from the east, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a94a8'), new THREE.Color(PALETTE.canvas), 1.15);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.8);
  sun.position.set(-20, 12, 10);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#5a6d8a'), 0.5);
  fill.position.set(16, 10, 14);
  scene.add(fill);

  // Two amber work lamps over the sites, so the objectives glow after dusk.
  function lamp(x, z) {
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 16, 1.6);
    light.position.set(x, 4.4, z);
    scene.add(light);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), materials.hairline);
    housing.position.set(x, 4.8, z);
    group.add(housing);
  }
  lamp(-16, -11);
  lamp(16, -11);

  return { colliders, shootables, group };
}
