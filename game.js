import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 6.5;
const SPRINT_SPEED = 10;
const PLAYER_RADIUS = 0.6;
const MAX_HP = 150;
const MAG_SIZE = 30;
const RELOAD_MS = 1800;
const WEAPON_RANGE = 75;

const socket = io();

// ---------- DOM ----------
const startScreen = document.getElementById('startScreen');
const nameInput = document.getElementById('nameInput');
const deployBtn = document.getElementById('deployBtn');
const hud = document.getElementById('hud');
const canvas = document.getElementById('scene');
const hitmarker = document.getElementById('hitmarker');
const creditsEl = document.getElementById('credits');
const killsEl = document.getElementById('kills');
const deathsEl = document.getElementById('deaths');
const timerLineEl = document.getElementById('timerLine');
const ammoLineEl = document.getElementById('ammoLine');
const healthBarEl = document.getElementById('healthBar');
const killFeedEl = document.getElementById('killFeed');
const floatFeedbackEl = document.getElementById('floatFeedback');
const deathOverlayEl = document.getElementById('deathOverlay');
const deathAmountEl = document.getElementById('deathAmount');
const respawnTimerEl = document.getElementById('respawnTimer');
const scoreboardEl = document.getElementById('scoreboard');
const sbListEl = document.getElementById('sbList');
const damageVignetteEl = document.getElementById('damageVignette');
const roundEndOverlayEl = document.getElementById('roundEndOverlay');
const roundEndTitleEl = document.getElementById('roundEndTitle');
const roundEndAmountEl = document.getElementById('roundEndAmount');
const roundEndSubEl = document.getElementById('roundEndSub');
const roundEndStandingsEl = document.getElementById('roundEndStandings');
const continueBtn = document.getElementById('continueBtn');
const lobbyScreenEl = document.getElementById('lobbyScreen');
const lobbyCountEl = document.getElementById('lobbyCount');
const lobbyTimerEl = document.getElementById('lobbyTimer');
const lobbyListEl = document.getElementById('lobbyList');
const lobbyStatusEl = document.getElementById('lobbyStatus');
const watchingBannerEl = document.getElementById('watchingBanner');
const freezeOverlayEl = document.getElementById('freezeOverlay');
const freezeTimerEl = document.getElementById('freezeTimer');

let myId = null;
let myName = '';
let joined = false;
let latestState = null;
let ammo = MAG_SIZE;
let reloading = false;
let reloadEndAt = 0;
let mapHalf = 45;
let buildings = [];

// ---------- Three.js ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9a878);
scene.fog = new THREE.Fog(0xc9a878, 40, 110);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 250);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.AmbientLight(0xfff0dd, 0.75));
const sun = new THREE.DirectionalLight(0xfff2cc, 1.1);
sun.position.set(30, 50, 20);
scene.add(sun);

// ---------- First-person weapon viewmodel (original generic rifle shape) ----------
const weaponGroup = new THREE.Group();
weaponGroup.position.set(0.32, -0.28, -0.55);
weaponGroup.rotation.y = -0.06;
camera.add(weaponGroup);
scene.add(camera);

const gunMetalMat = new THREE.MeshStandardMaterial({ color: 0x232320, roughness: 0.5, metalness: 0.4 });
const gunGripMat = new THREE.MeshStandardMaterial({ color: 0x151512, roughness: 0.8 });

const gunBodyVM = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.55), gunMetalMat);
gunBodyVM.position.set(0, 0, -0.05);
weaponGroup.add(gunBodyVM);

const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.28), gunMetalMat);
gunBarrel.position.set(0, 0.01, -0.42);
weaponGroup.add(gunBarrel);

const gunStock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.2), gunGripMat);
gunStock.position.set(0, -0.02, 0.28);
weaponGroup.add(gunStock);

const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.06), gunGripMat);
gunGrip.position.set(0, -0.11, 0.12);
weaponGroup.add(gunGrip);

const gunMag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), gunGripMat);
gunMag.position.set(0, -0.13, -0.06);
gunMag.rotation.x = 0.15;
weaponGroup.add(gunMag);

const muzzleFlashLight = new THREE.PointLight(0xffcc66, 0, 4);
muzzleFlashLight.position.set(0, 0.01, -0.58);
weaponGroup.add(muzzleFlashLight);

const muzzleFlashMesh = new THREE.Mesh(
  new THREE.ConeGeometry(0.05, 0.14, 6),
  new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0 })
);
muzzleFlashMesh.rotation.x = -Math.PI / 2;
muzzleFlashMesh.position.set(0, 0.01, -0.62);
weaponGroup.add(muzzleFlashMesh);

let muzzleFlashUntil = 0;
let weaponRecoil = 0;
function triggerMuzzleFlash() {
  muzzleFlashUntil = performance.now() + 60;
  muzzleFlashLight.intensity = 2.2;
  muzzleFlashMesh.material.opacity = 0.9;
  weaponRecoil = 0.06;
}

let hitmarkerTimeout = null;
function showHitmarker() {
  hitmarker.classList.remove('show');
  void hitmarker.offsetWidth;
  hitmarker.classList.add('show');
  if (hitmarkerTimeout) clearTimeout(hitmarkerTimeout);
  hitmarkerTimeout = setTimeout(() => hitmarker.classList.remove('show'), 150);
}

let vignetteTimeout = null;
function showDamageVignette() {
  damageVignetteEl.classList.remove('show');
  void damageVignetteEl.offsetWidth;
  damageVignetteEl.classList.add('show');
  if (vignetteTimeout) clearTimeout(vignetteTimeout);
  vignetteTimeout = setTimeout(() => damageVignetteEl.classList.remove('show'), 400);
}

// ---------- Tracers (visible shots fired by anyone, thick glowing bolt) ----------
const tracerGroup = new THREE.Group();
scene.add(tracerGroup);
const activeTracers = [];
const TRACER_LIFE_MS = 220;
const UP_VECTOR = new THREE.Vector3(0, 1, 0);

function spawnTracer(fromX, fromZ, toX, toZ) {
  const from = new THREE.Vector3(fromX, 1.15, fromZ);
  const to = new THREE.Vector3(toX, 1.15, toZ);
  const length = from.distanceTo(to);
  if (length < 0.1) return;

  const geo = new THREE.CylinderGeometry(0.035, 0.035, length, 5, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff6c2, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(UP_VECTOR, to.clone().sub(from).normalize());
  tracerGroup.add(mesh);
  activeTracers.push({ mesh, expiresAt: performance.now() + TRACER_LIFE_MS });
}

function updateTracers(now) {
  for (let i = activeTracers.length - 1; i >= 0; i--) {
    const t = activeTracers[i];
    const remaining = t.expiresAt - now;
    if (remaining <= 0) {
      tracerGroup.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      activeTracers.splice(i, 1);
    } else {
      t.mesh.material.opacity = Math.min(1, remaining / TRACER_LIFE_MS);
    }
  }
}

const groundMat = new THREE.MeshStandardMaterial({ color: 0xb99a68, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), groundMat);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const buildingGroup = new THREE.Group();
scene.add(buildingGroup);

const windowMat = new THREE.MeshStandardMaterial({
  color: 0x1c2a30, roughness: 0.3, metalness: 0.4, emissive: 0x2a3a42, emissiveIntensity: 0.15,
});

function addWindows(b) {
  const rows = b.h > 5 ? 2 : 1;
  const cols = Math.max(1, Math.floor(b.hx / 2));
  const winW = 0.7, winH = 0.9;
  for (let row = 0; row < rows; row++) {
    const wy = 1.4 + row * 2.1;
    if (wy > b.h - 0.6) continue;
    for (let col = 0; col < cols; col++) {
      const wx = b.x - b.hx + (col + 0.5) * ((b.hx * 2) / cols);
      const winFront = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), windowMat);
      winFront.position.set(wx, wy, b.z + b.hz + 0.02);
      buildingGroup.add(winFront);
      const winBack = winFront.clone();
      winBack.position.z = b.z - b.hz - 0.02;
      winBack.rotation.y = Math.PI;
      buildingGroup.add(winBack);
    }
  }
}

function buildMap(list, half) {
  buildingGroup.clear();
  mapHalf = half;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.9 });
  for (const b of list) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.h, b.hz * 2), wallMat);
    mesh.position.set(b.x, b.h / 2, b.z);
    buildingGroup.add(mesh);
    addWindows(b);
  }
  const boundaryMat = new THREE.MeshStandardMaterial({ color: 0x6a5636 });
  for (let i = 0; i < 4; i++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2, 4, 1), boundaryMat);
    const a = (i * Math.PI) / 2;
    wall.position.set(Math.sin(a) * half, 2, Math.cos(a) * half);
    wall.rotation.y = a;
    buildingGroup.add(wall);
  }
  buildings = list;
}

// ---------- Barrels (cover) and messy stacked-barrel high-ground platform ----------
let barrels = [];
let platforms = [];
const BARREL_RADIUS = 0.55;
const propGroup = new THREE.Group();
scene.add(propGroup);

// Procedural weathered-metal texture (rust streaks, grime, ridge shadows) - original, not sampled from any source image.
function createBarrelTexture(baseHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const r = (baseHex >> 16) & 255, g = (baseHex >> 8) & 255, b = baseHex & 255;

  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 128, 256);

  // subtle vertical panel shading
  for (let x = 0; x < 128; x += 4) {
    const shade = Math.sin(x * 0.15) * 10;
    ctx.fillStyle = `rgba(${Math.max(0, r + shade)},${Math.max(0, g + shade)},${Math.max(0, b + shade)},0.4)`;
    ctx.fillRect(x, 0, 4, 256);
  }

  // rolled-rim ridges with dark shadow + light highlight
  for (const y of [46, 128, 210]) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, y, 128, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, y - 3, 128, 2);
  }

  // rust streaks dripping down
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 200;
    const w = 3 + Math.random() * 9;
    const h = 20 + Math.random() * 70;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(110,45,18,0.55)');
    grad.addColorStop(1, 'rgba(110,45,18,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  // grime speckles and scratches
  for (let i = 0; i < 250; i++) {
    ctx.fillStyle = `rgba(10,8,5,${Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5);
  }
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = `rgba(230,230,220,${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 1;
    const x = Math.random() * 128;
    const y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 10);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

const barrelColors = [0x9a5a32, 0x5a5a42, 0x7a3a28];
const barrelTextureCache = barrelColors.map(createBarrelTexture);
const barrelTopMat = new THREE.MeshStandardMaterial({ color: 0x1e1e18, roughness: 0.6, metalness: 0.3 });

function makeBarrelMesh(colorIdx, scale = 1) {
  const idx = colorIdx % barrelColors.length;
  const sideMat = new THREE.MeshStandardMaterial({ map: barrelTextureCache[idx], roughness: 0.95 });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5 * scale, 0.48 * scale, 1.1 * scale, 16, 1, false),
    [sideMat, barrelTopMat, barrelTopMat]
  );
  const rimTop = new THREE.Mesh(
    new THREE.TorusGeometry(0.49 * scale, 0.035 * scale, 6, 16),
    barrelTopMat
  );
  rimTop.rotation.x = Math.PI / 2;
  rimTop.position.y = 0.55 * scale;
  mesh.add(rimTop);
  const rimBottom = rimTop.clone();
  rimBottom.position.y = -0.55 * scale;
  rimBottom.scale.set(0.98, 0.98, 0.98);
  mesh.add(rimBottom);
  return mesh;
}

function buildProps(barrelList, platformList) {
  propGroup.clear();
  barrels = barrelList;
  platforms = platformList;

  barrelList.forEach((b, i) => {
    const mesh = makeBarrelMesh(i);
    mesh.position.set(b.x, 0.55, b.z);
    mesh.rotation.y = (i * 37) % 6.28;
    propGroup.add(mesh);
  });

  platformList.forEach((p) => {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + p.x;
      const r = (i % 2 === 0 ? 0.9 : 1.6) * (p.radius / 2.4);
      const scale = 0.9 + (i % 3) * 0.08;
      const mesh = makeBarrelMesh(i, scale);
      mesh.position.set(p.x + Math.cos(a) * r, (p.height - 0.55 * scale) + (i % 2) * 0.05, p.z + Math.sin(a) * r);
      mesh.rotation.y = a * 1.7;
      if (i === count - 1) mesh.rotation.z = 0.35;
      propGroup.add(mesh);
    }
  });
}

function groundHeightAt(x, z) {
  let h = 0;
  for (const p of platforms) {
    if (Math.hypot(x - p.x, z - p.z) <= p.radius) h = Math.max(h, p.height);
  }
  return h;
}

// ---------- Decorative set-dressing (trees, wrecked car) - purely visual, no collision ----------
const decorGroup = new THREE.Group();
scene.add(decorGroup);

const TREE_SPOTS = [
  { x: -18, z: -15 }, { x: 5, z: -18 }, { x: 24, z: -8 }, { x: -24, z: 8 },
  { x: 2, z: 12 }, { x: 22, z: 32 }, { x: -8, z: 28 }, { x: 38, z: 10 },
  { x: -35, z: -15 }, { x: 10, z: -35 }, { x: -2, z: -6 }, { x: 28, z: 14 },
];
const WRECK_SPOT = { x: -6, z: -14, rot: 0.4 };

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 });
const foliageMat = new THREE.MeshStandardMaterial({ color: 0x5a6b34, roughness: 0.85 });

function makeTree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.2 * scale, 2.2 * scale, 6), trunkMat);
  trunk.position.y = 1.1 * scale;
  g.add(trunk);
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15 * scale, 0), foliageMat);
  foliage.position.y = 2.5 * scale;
  foliage.scale.y = 1.15;
  g.add(foliage);
  const foliage2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 * scale, 0), foliageMat);
  foliage2.position.set(0.5 * scale, 2.1 * scale, 0.3 * scale);
  g.add(foliage2);
  return g;
}

const wreckBodyMat = new THREE.MeshStandardMaterial({ color: 0x5a1f16, roughness: 0.85, metalness: 0.2 });
const wreckDarkMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.9 });
const wreckGlassMat = new THREE.MeshStandardMaterial({ color: 0x0a1a1c, roughness: 0.4, metalness: 0.3 });

function makeWreckedCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.8), wreckBodyMat);
  body.position.y = 0.65;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.6), wreckGlassMat);
  cabin.position.set(-0.2, 1.35, 0);
  cabin.rotation.z = 0.05;
  g.add(cabin);
  const scorch = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.9), wreckDarkMat);
  scorch.position.set(0.6, 1.05, 0);
  g.add(scorch);
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10);
  const wheelPositions = [[-1.5, 0.4, 0.9], [1.4, 0.4, 0.9], [-1.5, 0.4, -0.9]];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wreckDarkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    g.add(wheel);
  }
  g.rotation.z = 0.12;
  return g;
}

function buildDecor() {
  decorGroup.clear();
  TREE_SPOTS.forEach((s, i) => {
    const tree = makeTree(0.9 + (i % 3) * 0.15);
    tree.position.set(s.x, 0, s.z);
    decorGroup.add(tree);
  });
  const wreck = makeWreckedCar();
  wreck.position.set(WRECK_SPOT.x, 0, WRECK_SPOT.z);
  wreck.rotation.y = WRECK_SPOT.rot;
  decorGroup.add(wreck);
}

// ---------- Player avatars (original low-poly "operative" figure) ----------
const avatarGroup = new THREE.Group();
scene.add(avatarGroup);
const avatarMeshes = new Map();
const avatarHitboxes = new Map();

// Procedural blotchy tactical-fabric texture - original pattern, not sampled from any image.
function createFabricTexture(baseHex, accentHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const toRgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const [br, bg, bb] = toRgb(baseHex);
  const [ar, ag, ab] = toRgb(accentHex);
  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.35 + Math.random() * 0.35})`;
    ctx.beginPath();
    const cx = Math.random() * 64, cy = Math.random() * 64;
    const rr = 3 + Math.random() * 7;
    ctx.moveTo(cx, cy);
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      ctx.lineTo(cx + Math.cos(ang) * rr * (0.6 + Math.random() * 0.6), cy + Math.sin(ang) * rr * (0.6 + Math.random() * 0.6));
    }
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

const gearTex = createFabricTexture(0x2a2f24, 0x1a1e16);
const vestTexBot = createFabricTexture(0x5a2420, 0x3a1614);
const vestTexHuman = createFabricTexture(0x22404a, 0x162a30);

function createSoldierMesh(isBot, id) {
  const group = new THREE.Group();
  const skinColor = 0xb5825a;
  const gearMat = new THREE.MeshStandardMaterial({ map: gearTex, roughness: 0.9 });
  const vestMat = new THREE.MeshStandardMaterial({ map: isBot ? vestTexBot : vestTexHuman, roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.32), gearMat);
  hips.position.y = 0.68;
  group.add(hips);

  const legGeo = new THREE.BoxGeometry(0.2, 0.62, 0.26);
  const leftLeg = new THREE.Mesh(legGeo, gearMat);
  leftLeg.position.set(-0.14, 0.32, 0);
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, gearMat);
  rightLeg.position.set(0.14, 0.32, 0);
  group.add(rightLeg);

  const bootGeo = new THREE.BoxGeometry(0.22, 0.14, 0.3);
  const leftBoot = new THREE.Mesh(bootGeo, darkMat);
  leftBoot.position.set(-0.14, 0.07, 0.02);
  group.add(leftBoot);
  const rightBoot = new THREE.Mesh(bootGeo, darkMat);
  rightBoot.position.set(0.14, 0.07, 0.02);
  group.add(rightBoot);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.68, 0.34), vestMat);
  torso.position.y = 1.13;
  group.add(torso);

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.36), vestMat);
  shoulders.position.y = 1.5;
  group.add(shoulders);

  for (let i = 0; i < 3; i++) {
    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.08), darkMat);
    pouch.position.set(-0.17 + i * 0.17, 1.05, 0.2);
    group.add(pouch);
  }

  const armGeo = new THREE.BoxGeometry(0.16, 0.5, 0.18);
  const leftArm = new THREE.Mesh(armGeo, vestMat);
  leftArm.position.set(-0.4, 1.15, 0);
  leftArm.rotation.z = 0.12;
  group.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, vestMat);
  rightArm.position.set(0.36, 1.12, 0.12);
  rightArm.rotation.x = -0.7;
  group.add(rightArm);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), skinMat);
  neck.position.y = 1.52;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
  head.position.y = 1.72;
  group.add(head);

  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.36), darkMat);
  helmet.position.y = 1.88;
  group.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0.6 }));
  visor.position.set(0, 1.78, 0.17);
  group.add(visor);

  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.72), darkMat);
  gunBody.position.set(0.5, 1.22, 0.45);
  gunBody.rotation.x = -0.7;
  group.add(gunBody);

  const hitParts = [hips, leftLeg, rightLeg, torso, shoulders, leftArm, rightArm, head, helmet];
  for (const mesh of [...hitParts, leftBoot, rightBoot, neck, visor, gunBody]) {
    mesh.userData.playerId = id;
  }
  group.userData.playerId = id;
  group.userData.hitParts = hitParts;
  return group;
}

function ensureAvatar(p) {
  if (avatarMeshes.has(p.id)) return avatarMeshes.get(p.id);
  const mesh = createSoldierMesh(p.isBot, p.id);
  avatarGroup.add(mesh);
  avatarMeshes.set(p.id, mesh);
  avatarHitboxes.set(p.id, mesh.userData.hitParts);
  return mesh;
}

function updateAvatars(players) {
  const seen = new Set();
  for (const p of players) {
    if (p.id === myId) continue;
    if (!p.alive) continue;
    seen.add(p.id);
    const mesh = ensureAvatar(p);
    mesh.position.set(p.x, groundHeightAt(p.x, p.z), p.z);
    mesh.rotation.y = p.yaw;
    mesh.visible = true;
  }
  for (const [id, mesh] of avatarMeshes) {
    if (!seen.has(id)) mesh.visible = false;
  }
}

// ---------- Minimap (bottom-left radar: gunfire pings only, no permanent enemy markers) ----------
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const MINIMAP_SIZE = 150;
let shotPings = [];
const PING_LIFE_MS = 2600;

function worldToMinimap(x, z) {
  const half = mapHalf || 45;
  return {
    mx: (x / half) * (MINIMAP_SIZE / 2) + MINIMAP_SIZE / 2,
    my: (z / half) * (MINIMAP_SIZE / 2) + MINIMAP_SIZE / 2,
  };
}

function addShotPing(x, z) {
  shotPings.push({ x, z, bornAt: performance.now() });
  if (shotPings.length > 40) shotPings.shift();
}

function drawMinimap() {
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  ctx.fillStyle = 'rgba(10, 8, 4, 0.55)';
  ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  ctx.fillStyle = 'rgba(154, 122, 74, 0.35)';
  for (const b of buildings) {
    const p1 = worldToMinimap(b.x - b.hx, b.z - b.hz);
    const p2 = worldToMinimap(b.x + b.hx, b.z + b.hz);
    ctx.fillRect(p1.mx, p1.my, p2.mx - p1.mx, p2.my - p1.my);
  }

  const now = performance.now();
  shotPings = shotPings.filter((p) => now - p.bornAt < PING_LIFE_MS);
  for (const p of shotPings) {
    const age = now - p.bornAt;
    const t = age / PING_LIFE_MS;
    const { mx, my } = worldToMinimap(p.x, p.z);
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = '#e2482f';
    ctx.beginPath();
    ctx.arc(mx, my, 3 + t * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const me = worldToMinimap(pos.x, pos.z);
  ctx.save();
  ctx.translate(me.mx, me.my);
  ctx.rotate(-yaw);
  ctx.fillStyle = '#d6b64a';
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(4, 5);
  ctx.lineTo(-4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(214, 182, 74, 0.5)';
  ctx.strokeRect(0.5, 0.5, MINIMAP_SIZE - 1, MINIMAP_SIZE - 1);
}

// ---------- Collision ----------
function resolveCollisions(x, z, radius) {
  for (const b of buildings) {
    const minX = b.x - b.hx, maxX = b.x + b.hx, minZ = b.z - b.hz, maxZ = b.z + b.hz;
    const cx = Math.max(minX, Math.min(x, maxX));
    const cz = Math.max(minZ, Math.min(z, maxZ));
    const dx = x - cx, dz = z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const distV = Math.sqrt(distSq) || 0.0001;
      const push = radius - distV;
      x += (dx / distV) * push;
      z += (dz / distV) * push;
    }
  }
  for (const b of barrels) {
    const dx = x - b.x, dz = z - b.z;
    const minDist = radius + BARREL_RADIUS;
    const distSq = dx * dx + dz * dz;
    if (distSq < minDist * minDist) {
      const distV = Math.sqrt(distSq) || 0.0001;
      const push = minDist - distV;
      x += (dx / distV) * push;
      z += (dz / distV) * push;
    }
  }
  const half = mapHalf - 1;
  x = Math.max(-half, Math.min(half, x));
  z = Math.max(-half, Math.min(half, z));
  return { x, z };
}

// ---------- Input ----------
const keys = { w: false, a: false, s: false, d: false, shift: false };
let yaw = 0;
let pitch = 0;
let pos = { x: 0, z: 0 };
let pointerLocked = false;
let alive = true;
let spectateId = null;
let frozen = false;

function aliveOthers() {
  if (!latestState) return [];
  return latestState.players.filter((p) => p.id !== myId && p.alive);
}

function cycleSpectateTarget() {
  const others = aliveOthers();
  if (others.length === 0) return;
  const curIdx = others.findIndex((p) => p.id === spectateId);
  spectateId = others[(curIdx + 1) % others.length].id;
}

function requestLock() { canvas.requestPointerLock(); }

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});

canvas.addEventListener('click', () => {
  if (joined && !pointerLocked) requestLock();
});

document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || !alive) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.2, Math.min(1.2, pitch));
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !joined) return;
  if (alive) fire();
  else cycleSpectateTarget();
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.w = true;
  if (k === 'a' || k === 'arrowleft') keys.a = true;
  if (k === 's' || k === 'arrowdown') keys.s = true;
  if (k === 'd' || k === 'arrowright') keys.d = true;
  if (k === 'shift') keys.shift = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (k === 'tab') scoreboardEl.classList.toggle('hidden');
  if (k === 'r') startReload();
  if (k === ' ') { e.preventDefault(); tryJump(); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.w = false;
  if (k === 'a' || k === 'arrowleft') keys.a = false;
  if (k === 's' || k === 'arrowdown') keys.s = false;
  if (k === 'd' || k === 'arrowright') keys.d = false;
  if (k === 'shift') keys.shift = false;
});

function startReload() {
  if (reloading || ammo === MAG_SIZE) return;
  reloading = true;
  reloadEndAt = performance.now() + RELOAD_MS;
  ammoLineEl.textContent = 'RELOADING...';
}

let bobY = 0;
let vertVelocity = 0;
const JUMP_SPEED = 4.2;
const GRAVITY = 11;

function tryJump() {
  if (!joined || !alive || frozen) return;
  if (bobY <= 0.001 && vertVelocity === 0) vertVelocity = JUMP_SPEED;
}

const raycaster = new THREE.Raycaster();
let lastShotAt = 0;
const FIRE_COOLDOWN_MS = 140;

function fire() {
  if (!alive || reloading || frozen) return;
  const now = performance.now();
  if (now - lastShotAt < FIRE_COOLDOWN_MS) return;
  if (ammo <= 0) { startReload(); return; }
  lastShotAt = now;
  ammo -= 1;
  ammoLineEl.textContent = `${ammo} / ${MAG_SIZE}`;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  raycaster.set(camera.position, dir);
  raycaster.far = WEAPON_RANGE;
  const avatarTargets = [...avatarMeshes.values()].filter((m) => m.visible);
  const allHits = raycaster.intersectObjects([...avatarTargets, ...buildingGroup.children], true);
  let targetId = null;
  let endPoint = camera.position.clone().addScaledVector(dir, WEAPON_RANGE);
  if (allHits.length > 0) {
    const first = allHits[0].object;
    endPoint = allHits[0].point;
    if (first.userData.playerId) {
      targetId = first.userData.playerId;
      showHitmarker();
    }
  }
  triggerMuzzleFlash();
  socket.emit('shoot', { targetId, toX: endPoint.x, toZ: endPoint.z });
}

// ---------- Join flow ----------
let hasJoinedBefore = false;
deployBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || `OPERATIVE-${Math.floor(Math.random() * 900 + 100)}`;
  myName = name;
  hasJoinedBefore = true;
  socket.emit('join', name);
});

socket.on('connect', () => {
  if (hasJoinedBefore) socket.emit('join', myName);
});

socket.on('disconnect', () => {
  joined = false;
});

socket.on('joined', ({ id, name, x, z }) => {
  myId = id;
  myName = name;
  pos.x = x;
  pos.z = z;
  yaw = Math.atan2(x, z);
  joined = true;
  startScreen.classList.add('hidden');
  lobbyScreenEl.classList.remove('hidden');
});

socket.on('feedback', ({ type, amount }) => {
  const div = document.createElement('div');
  div.className = `float-pop ${type}`;
  div.textContent = `${amount > 0 ? '+' : ''}$${amount}`;
  floatFeedbackEl.appendChild(div);
  setTimeout(() => div.remove(), 900);
  if (type === 'death') {
    deathAmountEl.textContent = `${amount}$`;
  }
});

socket.on('hit_taken', () => {
  showDamageVignette();
});

socket.on('tracer', ({ fromX, fromZ, toX, toZ }) => {
  spawnTracer(fromX, fromZ, toX, toZ);
  addShotPing(fromX, fromZ);
});

let roundEndHideTimeout = null;
let showingRoundEnd = false;
socket.on('round_end', ({ reason, winnerName, winnerBonus, standings }) => {
  const iWon = reason === 'last_standing' && winnerName === myName;
  showingRoundEnd = true;
  lobbyScreenEl.classList.add('hidden');
  roundEndOverlayEl.classList.remove('victory', 'defeat');
  roundEndOverlayEl.classList.add(iWon ? 'victory' : 'defeat');
  roundEndTitleEl.textContent = iWon ? 'VICTORY' : reason === 'last_standing' ? 'ELIMINATED' : 'ROUND OVER';
  roundEndAmountEl.textContent = iWon ? `+$${winnerBonus}` : winnerName ? `${winnerName} wins` : '';
  roundEndSubEl.textContent = reason === 'last_standing'
    ? `${winnerName} is the last one standing`
    : `Top operative: ${winnerName || '—'}`;
  roundEndStandingsEl.innerHTML = standings
    .map((s) => `<div><span>${escapeHtml(s.name)}${s.name === myName ? ' (you)' : ''}</span><span>$${s.credits}</span></div>`)
    .join('');
  roundEndOverlayEl.classList.remove('hidden');
  document.exitPointerLock();
  if (roundEndHideTimeout) clearTimeout(roundEndHideTimeout);
  roundEndHideTimeout = setTimeout(hideRoundEnd, 5000);
});

function hideRoundEnd() {
  showingRoundEnd = false;
  roundEndOverlayEl.classList.add('hidden');
  if (joined) requestLock();
}
continueBtn.addEventListener('click', () => {
  if (roundEndHideTimeout) clearTimeout(roundEndHideTimeout);
  hideRoundEnd();
});

// ---------- State ----------
function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

let mapBuilt = false;
let wasLobby = true;

socket.on('state', (state) => {
  latestState = state;
  if (!mapBuilt) {
    buildMap(state.buildings, state.mapHalf);
    buildProps(state.barrels, state.platforms);
    buildDecor();
    mapBuilt = true;
  }

  const me = state.players.find((p) => p.id === myId);

  if (showingRoundEnd) return;

  if (joined && state.phase === 'lobby') {
    wasLobby = true;
    watchingBannerEl.classList.add('hidden');
    lobbyScreenEl.classList.remove('hidden');
    hud.classList.add('hidden');
    lobbyCountEl.textContent = `${state.humanCount} / ${state.maxPlayers}`;
    lobbyTimerEl.textContent = `Starting in ${fmtTime(state.lobbyTimeLeftMs)}`;
    lobbyStatusEl.textContent = state.humanCount >= state.maxPlayers ? 'Zone full — launching...' : 'Waiting for players...';
    lobbyListEl.innerHTML = state.players
      .filter((p) => p.connected && !p.isBot)
      .map((p) => `<div>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</div>`)
      .join('');
    return;
  }

  // phase === 'active' from here.
  if (joined && me && !me.roundParticipant) {
    // Joined mid-round: not part of this round's combat, wait for the next one.
    wasLobby = true;
    watchingBannerEl.classList.add('hidden');
    deathOverlayEl.classList.add('hidden');
    hud.classList.add('hidden');
    lobbyScreenEl.classList.remove('hidden');
    lobbyCountEl.textContent = `${state.humanCount} / ${state.maxPlayers}`;
    lobbyTimerEl.textContent = `Match in progress — ends in ${fmtTime(state.matchTimeLeftMs)}`;
    lobbyStatusEl.textContent = 'Round in progress — you’ll join the next one.';
    lobbyListEl.innerHTML = state.players
      .filter((p) => p.connected && !p.isBot)
      .map((p) => `<div>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</div>`)
      .join('');
    return;
  }

  if (joined && wasLobby) {
    wasLobby = false;
    lobbyScreenEl.classList.add('hidden');
    hud.classList.remove('hidden');
    requestLock();
  }

  frozen = (state.freezeTimeLeftMs || 0) > 0;
  if (frozen) {
    freezeTimerEl.textContent = Math.ceil(state.freezeTimeLeftMs / 1000);
    freezeOverlayEl.classList.remove('hidden');
  } else {
    freezeOverlayEl.classList.add('hidden');
  }

  if (me) {
    creditsEl.textContent = me.credits;
    killsEl.textContent = me.kills;
    deathsEl.textContent = me.deaths;
    const hpPct = Math.max(0, Math.min(100, (me.hp / MAX_HP) * 100));
    healthBarEl.style.width = `${hpPct}%`;
    healthBarEl.style.background = hpPct > 50 ? '#7fb84a' : hpPct > 25 ? '#d6b64a' : '#c73a2f';
    if (!alive && me.alive) {
      pos.x = me.x;
      pos.z = me.z;
      yaw = Math.atan2(me.x, me.z);
      pitch = 0;
    }
    alive = me.alive;
    if (!me.alive) {
      const others = state.players.filter((p) => p.id !== myId && p.alive);
      const killer = others.find((p) => p.id === me.lastKillerId);
      let target = others.find((p) => p.id === spectateId);
      if (!target) {
        target = killer || others[0] || null;
        spectateId = target ? target.id : null;
      }
      if (target) {
        pos.x = target.x;
        pos.z = target.z;
        yaw = target.yaw;
        pitch = target.pitch || 0;
        watchingBannerEl.innerHTML = `WATCHING <b>${escapeHtml(target.name)}</b> — click to switch`;
        watchingBannerEl.classList.remove('hidden');
        respawnTimerEl.textContent = `ELIMINATED — next round in ${fmtTime(state.matchTimeLeftMs)}`;
      } else {
        spectateId = null;
        pos.x = me.x;
        pos.z = me.z;
        watchingBannerEl.classList.add('hidden');
        respawnTimerEl.textContent = `SPECTATOR — next round in ${fmtTime(state.matchTimeLeftMs)}`;
      }
      deathOverlayEl.classList.remove('hidden');
      crosshair.style.display = 'none';
    } else {
      spectateId = null;
      watchingBannerEl.classList.add('hidden');
      deathOverlayEl.classList.add('hidden');
      crosshair.style.display = 'block';
    }
  }

  timerLineEl.textContent = `ROUND ${fmtTime(state.matchTimeLeftMs)}`;

  sbListEl.innerHTML = [...state.players]
    .sort((a, b) => b.credits - a.credits)
    .map((p) => `<div><span>${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span><span>$${p.credits} · ${p.kills}K/${p.deaths}D</span></div>`)
    .join('');

  killFeedEl.innerHTML = state.killFeed.map((l) => `<div>${escapeHtml(l.text)}</div>`).join('');

  updateAvatars(state.players);
  drawMinimap();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Render / movement loop ----------
let lastFrame = performance.now();
let lastNetSend = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (reloading && now >= reloadEndAt) {
    reloading = false;
    ammo = MAG_SIZE;
    ammoLineEl.textContent = `${ammo} / ${MAG_SIZE}`;
  }

  if (joined && alive && !frozen) {
    const speed = keys.shift ? SPRINT_SPEED : WALK_SPEED;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.sin(yaw + Math.PI / 2);
    const rz = Math.cos(yaw + Math.PI / 2);
    let mx = 0;
    let mz = 0;
    if (keys.w) { mx -= fx; mz -= fz; }
    if (keys.s) { mx += fx; mz += fz; }
    if (keys.a) { mx -= rx; mz -= rz; }
    if (keys.d) { mx += rx; mz += rz; }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      const nx = pos.x + (mx / len) * speed * dt;
      const nz = pos.z + (mz / len) * speed * dt;
      const resolved = resolveCollisions(nx, nz, PLAYER_RADIUS);
      pos.x = resolved.x;
      pos.z = resolved.z;
    }
  }

  if (vertVelocity !== 0 || bobY > 0) {
    vertVelocity -= GRAVITY * dt;
    bobY += vertVelocity * dt;
    if (bobY <= 0) {
      bobY = 0;
      vertVelocity = 0;
    }
  }

  camera.position.set(pos.x, EYE_HEIGHT + groundHeightAt(pos.x, pos.z) + bobY, pos.z);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  if (weaponRecoil > 0) {
    weaponRecoil = Math.max(0, weaponRecoil - dt * 0.4);
    weaponGroup.position.z = -0.55 + weaponRecoil;
  } else {
    weaponGroup.position.z = -0.55;
  }
  if (performance.now() > muzzleFlashUntil) {
    muzzleFlashLight.intensity = 0;
    muzzleFlashMesh.material.opacity = 0;
  }

  updateTracers(now);

  if (joined && now - lastNetSend > 50) {
    lastNetSend = now;
    socket.emit('move', { x: pos.x, z: pos.z, yaw, pitch });
  }

  renderer.render(scene, camera);
}
animate();
