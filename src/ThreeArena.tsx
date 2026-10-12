import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MatchSnap, OnlineLink } from "./online";
import { teamOf, teams, type MatchMode, type RosterPlayer, type WeaponId } from "./players";

type RoundOutcome = "win" | "loss" | "tie";

const maxLife = 130;
const drivePace = 0.7;

type RoundSummary = {
  outcome: RoundOutcome;
  standings: { name: string; color: string; teamColor: string | null; points: number }[];
  fellOut: { name: string; color: string; teamColor: string | null; how: "hålet" | "kanten" | "livet" }[];
  round: number;
  rounds: number;
  more: boolean;
};

export default function ThreeArena({
  onExit,
  mode,
  players,
  rounds = 1,
  online = null,
}: {
  onExit: () => void;
  mode: MatchMode;
  players: RosterPlayer[];
  rounds?: number;
  online?: OnlineLink | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [opponentsLeft, setOpponentsLeft] = useState(players.length - 1);
  const [playerOut, setPlayerOut] = useState(false);
  const [roundSummary, setRoundSummary] = useState<RoundSummary | null>(null);
  const [roundMark, setRoundMark] = useState(1);
  const [countdown, setCountdown] = useState("3");
  const [timeLeft] = useState(120);
  const eliminated = useRef(new Set<number>());
  const scoreLabelRef = useRef<HTMLDivElement>(null);
  const timeLabelRef = useRef<HTMLDivElement>(null);
  const pinLabelRef = useRef<HTMLDivElement>(null);
  const lifeLabelRef = useRef<HTMLDivElement>(null);
  const lifeFillRef = useRef<HTMLDivElement>(null);
  const rivalLabelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rivalFillRefs = useRef<Array<HTMLDivElement | null>>([]);
  const onlineRef = useRef(online);
  const advanceRound = useRef<(() => void) | null>(null);
  const keyDown = useRef({ forward: false, backward: false, left: false, right: false });
  const touchDown = useRef({ forward: false, backward: false, left: false, right: false });
  const weaponKey = useRef(false);
  const weaponTouch = useRef(false);
  const gamepadDrive = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    steer: 0,
    weapon: false,
  });
  const audioRef = useRef<AudioContext | null>(null);
  const [touchDrive, setTouchDrive] = useState(false);
  const [held, setHeld] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    weapon: false,
  });
  onlineRef.current = online;

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse), (max-width: 900px)");
    const update = () => setTouchDrive(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    eliminated.current.clear();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111820);
    scene.fog = new THREE.Fog(0x111820, 70, 140);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);

    camera.position.set(0, 26.52, 35.88);
    camera.lookAt(0, -2.34, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    mount.appendChild(renderer.domElement);

    let viewWidth = 0;
    let viewHeight = 0;

    function resizeRenderer() {
      if (!mount) return;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width < 2 || height < 2) return;
      if (width === viewWidth && height === viewHeight) return;

      viewWidth = width;
      viewHeight = height;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    resizeRenderer();

    // Ambient light
    scene.add(new THREE.HemisphereLight(0xbddcff, 0x25202a, 2));

    // Main stadium light
    const keyLight = new THREE.DirectionalLight(0xffffff, 3);
    keyLight.position.set(-12.5, 28.1, 15.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -31;
    keyLight.shadow.camera.right = 31;
    keyLight.shadow.camera.top = 31;
    keyLight.shadow.camera.bottom = -31;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 78;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.05;
    keyLight.target.position.set(0, -2, 0);
    scene.add(keyLight);
    scene.add(keyLight.target);

    const pitLight = new THREE.PointLight(0xd5e2ec, 96, 35);
    pitLight.position.set(0, 6.2, 0);
    scene.add(pitLight);

    // Blue and warm arena lights
    const blueLight = new THREE.PointLight(0x4488ff, 144, 55);
    blueLight.position.set(-15.6, 10.8, -6.2);
    scene.add(blueLight);

    const warmLight = new THREE.PointLight(0xffa64d, 156, 55);
    warmLight.position.set(15.6, 12.5, 4.7);
    scene.add(warmLight);

    // Ground outside the funnel
    const ground = new THREE.Mesh(
      new THREE.RingGeometry(7, 37.4, 96),
      new THREE.MeshStandardMaterial({
        color: 0x252c33,
        roughness: 0.9,
        metalness: 0.2,
      })
    );

    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -8.9;
    ground.receiveShadow = true;
    scene.add(ground);

    // Create a real concave funnel surface
    const outerRadius = 18.72;
    const innerRadius = 2.34;
    const segments = 160;
    const rings = 100;
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    function surfaceHeight(radius: number) {
      const t = radius / outerRadius;
      return -6.24 + 7.02 * Math.pow(t, 1.7);
    }

    const laneAngles = players.map((_, index) => (index / players.length) * Math.PI * 2);
    const joinRadius = outerRadius - 1.35;
    const rampTopRadius = outerRadius + 6.4;
    const padOuter = outerRadius + 10.6;
    const padHalfWidth = 3.15;
    const joinY = surfaceHeight(joinRadius);
    const padY = surfaceHeight(outerRadius) + 2.55;

    function laneLocal(x: number, z: number, lane: number) {
      const c = Math.cos(lane);
      const s = Math.sin(lane);
      return {
        along: x * c + z * s,
        side: -x * s + z * c,
      };
    }

    function supportHeight(x: number, z: number) {
      const radius = Math.hypot(x, z);
      if (radius < innerRadius) return null;

      for (const lane of laneAngles) {
        const { along, side } = laneLocal(x, z, lane);
        if (Math.abs(side) > padHalfWidth) continue;
        if (along < joinRadius || along > padOuter) continue;
        if (along >= rampTopRadius) return padY;
        const rampT = (along - joinRadius) / (rampTopRadius - joinRadius);
        return joinY + (padY - joinY) * rampT;
      }

      if (radius <= outerRadius) return surfaceHeight(radius);
      return null;
    }

    for (let j = 0; j <= rings; j++) {
      const radius =
        innerRadius +
        (outerRadius - innerRadius) * (j / rings);

      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;

        positions.push(
          Math.cos(angle) * radius,
          surfaceHeight(radius),
          Math.sin(angle) * radius
        );

        uvs.push(i / segments, j / rings);
      }
    }

    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i;
        const b = a + segments + 1;

        indices.push(a, a + 1, b);
        indices.push(b, a + 1, b + 1);
      }
    }

    const funnelGeometry = new THREE.BufferGeometry();

    funnelGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    funnelGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(uvs, 2)
    );

    funnelGeometry.setIndex(indices);
    funnelGeometry.computeVertexNormals();

    const funnelMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b9aa6,
      metalness: 0.45,
      roughness: 0.48,
      side: THREE.DoubleSide,
    });

    const funnel = new THREE.Mesh(
      funnelGeometry,
      funnelMaterial
    );

    funnel.receiveShadow = true;
    funnel.castShadow = false;
    scene.add(funnel);

    const heightBands = [
      { radius: outerRadius * 0.9, color: 0x6ec8e0 },
      { radius: outerRadius * 0.7, color: 0x8fce6a },
      { radius: outerRadius * 0.5, color: 0xe2b23a },
      { radius: outerRadius * 0.32, color: 0xe05a45 },
    ];

    for (const band of heightBands) {
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(band.radius, 0.09, 8, 140),
        new THREE.MeshStandardMaterial({
          color: band.color,
          emissive: band.color,
          emissiveIntensity: 0.4,
          metalness: 0.2,
          roughness: 0.45,
        })
      );
      marker.rotation.x = Math.PI / 2;
      marker.position.y = surfaceHeight(band.radius) + 0.05;
      scene.add(marker);
    }

    const holeMouth = surfaceHeight(innerRadius);
    const dangerOuter = innerRadius + 3.4;
    const dangerPulse: THREE.Material[] = [];

    const dangerZone = new THREE.Mesh(
      new THREE.RingGeometry(innerRadius + 0.08, dangerOuter, 72),
      new THREE.MeshBasicMaterial({
        color: 0xff2418,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    dangerZone.rotation.x = -Math.PI / 2;
    dangerZone.position.y = surfaceHeight((innerRadius + dangerOuter) / 2) + 0.06;
    scene.add(dangerZone);
    dangerPulse.push(dangerZone.material);

    const holeRim = new THREE.Mesh(
      new THREE.TorusGeometry(innerRadius + 0.08, 0.22, 12, 80),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 })
    );
    holeRim.rotation.x = Math.PI / 2;
    holeRim.position.y = holeMouth + 0.04;
    scene.add(holeRim);

    const holeStripes: { mesh: THREE.Mesh; angle: number }[] = [];
    for (let stripe = 0; stripe < 28; stripe++) {
      const angle = (stripe / 28) * Math.PI * 2;
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.06, 0.18),
        new THREE.MeshBasicMaterial({
          color: stripe % 2 === 0 ? 0xff2a1c : 0x1a1a1a,
        })
      );
      const stripeRadius = innerRadius + 0.7;
      mark.position.set(
        Math.cos(angle) * stripeRadius,
        surfaceHeight(stripeRadius) + 0.1,
        Math.sin(angle) * stripeRadius
      );
      mark.rotation.y = -angle;
      scene.add(mark);
      holeStripes.push({ mesh: mark, angle });
    }

    const dangerLabel = document.createElement("canvas");
    dangerLabel.width = 1280;
    dangerLabel.height = 320;
    const dangerContext = dangerLabel.getContext("2d");
    if (dangerContext) {
      const dangerWord = "Danger";
      let dangerSize = 220;
      dangerContext.textAlign = "center";
      dangerContext.textBaseline = "middle";
      dangerContext.font = `bold ${dangerSize}px sans-serif`;
      while (dangerContext.measureText(dangerWord).width > 1160 && dangerSize > 80) {
        dangerSize -= 4;
        dangerContext.font = `bold ${dangerSize}px sans-serif`;
      }
      dangerContext.lineWidth = 22;
      dangerContext.strokeStyle = "#3a0000";
      dangerContext.fillStyle = "#ff2a18";
      dangerContext.strokeText(dangerWord, 640, 165);
      dangerContext.fillText(dangerWord, 640, 165);
    }
    const dangerTexture = new THREE.CanvasTexture(dangerLabel);

    for (let label = 0; label < 4; label++) {
      const angle = (label / 4) * Math.PI * 2 + Math.PI / 4;
      const labelRadius = innerRadius + 2.55;
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 1.35),
        new THREE.MeshBasicMaterial({
          map: dangerTexture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      const plateX = Math.cos(angle) * labelRadius;
      const plateZ = Math.sin(angle) * labelRadius;
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const plateUp = new THREE.Vector3(0, 1, 0);
      plate.matrix.makeBasis(tangent, outward, plateUp);
      plate.matrix.setPosition(
        plateX,
        surfaceHeight(labelRadius) + 0.16,
        plateZ
      );
      plate.matrixAutoUpdate = false;
      scene.add(plate);
      dangerPulse.push(plate.material);
    }

    const holeCover = new THREE.Mesh(
      new THREE.RingGeometry(innerRadius + 0.04, innerRadius + 0.06, 72),
      new THREE.MeshBasicMaterial({
        color: 0x07090c,
        side: THREE.DoubleSide,
      })
    );
    holeCover.rotation.x = -Math.PI / 2;
    holeCover.position.y = holeMouth + 0.1;
    scene.add(holeCover);
    let shownHole = innerRadius;

    const holeGlow = new THREE.PointLight(0xff2a18, 40, 11, 2);
    holeGlow.position.set(0, holeMouth + 0.4, 0);
    scene.add(holeGlow);

    const pitDepth = 7.2;
    const mouthRadius = innerRadius * 0.98;
    const floorRadius = innerRadius * 0.2;
    const pit = new THREE.Group();
    const shaftGeo = new THREE.CylinderGeometry(mouthRadius, floorRadius, pitDepth, 64, 10, true);
    const shaftColors: number[] = [];
    const shaftPos = shaftGeo.attributes.position;
    for (let vertex = 0; vertex < shaftPos.count; vertex++) {
      const shade = Math.pow((shaftPos.getY(vertex) + pitDepth / 2) / pitDepth, 2) * 0.12;
      shaftColors.push(shade * 0.8, shade * 0.88, shade);
    }
    shaftGeo.setAttribute("color", new THREE.Float32BufferAttribute(shaftColors, 3));
    const shaft = new THREE.Mesh(
      shaftGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    shaft.position.y = -pitDepth / 2;
    pit.add(shaft);

    for (const [depth, span, color] of [
      [1.3, 0.72, 0x1a222a],
      [3.1, 0.5, 0x0d1217],
      [5.1, 0.3, 0x05080b],
    ] as const) {
      const along = depth / pitDepth;
      const wall = mouthRadius + (floorRadius - mouthRadius) * along;
      const ledge = new THREE.Mesh(
        new THREE.RingGeometry(wall * (1 - span), wall * 0.94, 64),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      );
      ledge.rotation.x = -Math.PI / 2;
      ledge.position.y = -depth;
      pit.add(ledge);
    }

    const pitFloor = new THREE.Mesh(
      new THREE.CircleGeometry(floorRadius * 1.08, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    pitFloor.rotation.x = -Math.PI / 2;
    pitFloor.position.y = -pitDepth + 0.02;
    pit.add(pitFloor);

    const throat = new THREE.Mesh(
      new THREE.TorusGeometry(mouthRadius, 0.11, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x07090c })
    );
    throat.rotation.x = Math.PI / 2;
    throat.position.y = -0.18;
    pit.add(throat);

    pit.position.y = holeMouth;
    scene.add(pit);

    // Metallic outer rim
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(outerRadius, 0.35, 12, 160),
      new THREE.MeshStandardMaterial({
        color: 0xc1ccd5,
        metalness: 0.9,
        roughness: 0.25,
      })
    );

    rim.rotation.x = Math.PI / 2;
    rim.position.y = surfaceHeight(outerRadius);
    scene.add(rim);

    function hazardMaterial(repeats: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const paint = canvas.getContext("2d");
      if (paint) {
        paint.fillStyle = "#f5c400";
        paint.fillRect(0, 0, 256, 64);
        paint.fillStyle = "#141414";
        paint.save();
        paint.translate(128, 32);
        paint.rotate(-Math.PI / 4);
        for (let band = -12; band <= 12; band += 2) {
          paint.fillRect(-240, band * 14 - 7, 480, 14);
        }
        paint.restore();
      }
      const map = new THREE.CanvasTexture(canvas);
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(repeats, 1);
      map.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({
        map,
        roughness: 0.55,
        metalness: 0.08,
      });
    }

    // Industrial support beams around the rim
    const postAngles: number[] = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const blocksRamp = laneAngles.some((lane) => {
        const delta = Math.atan2(Math.sin(angle - lane), Math.cos(angle - lane));
        return Math.abs(delta) < 0.34;
      });
      if (blocksRamp) continue;
      postAngles.push(angle);

      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 2.04, 0.25),
        new THREE.MeshStandardMaterial({
          color: 0x596773,
          metalness: 0.8,
          roughness: 0.35,
        })
      );

      post.position.set(
        Math.cos(angle) * (outerRadius + 0.24),
        surfaceHeight(outerRadius) + 0.78,
        Math.sin(angle) * (outerRadius + 0.24)
      );

      post.castShadow = true;
      scene.add(post);
    }

    const postStep = (Math.PI * 2) / 32;
    for (let k = 0; k < postAngles.length; k++) {
      const start = postAngles[k];
      const end = postAngles[(k + 1) % postAngles.length];
      let span = end - start;
      if (span < 0) span += Math.PI * 2;
      if (span > postStep * 1.6) continue;

      const mid = start + span / 2;
      const railRadius = outerRadius - 0.02;
      const length = Math.max(2 * railRadius * Math.sin(span / 2), 0.4);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(length, 1.15, 0.32),
        hazardMaterial(Math.max(2, Math.round(length / 0.55)))
      );
      rail.position.set(
        Math.cos(mid) * railRadius,
        surfaceHeight(outerRadius) + 0.58,
        Math.sin(mid) * railRadius
      );
      rail.rotation.y = Math.atan2(-Math.cos(mid), -Math.sin(mid));
      rail.castShadow = true;
      rail.receiveShadow = true;
      scene.add(rail);
    }

    const laneColors = players.map((player) => Number.parseInt(player.color.slice(1), 16));
    const deckLength = padOuter - rampTopRadius;
    const rampLength = rampTopRadius - joinRadius;
    const rampDrop = padY - joinY;
    const rampSpan = Math.hypot(rampLength, rampDrop);

    for (let i = 0; i < laneAngles.length; i++) {
      const lane = laneAngles[i];
      const deck = new THREE.Group();
      deck.rotation.y = -lane;

      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(deckLength, 0.42, padHalfWidth * 2),
        new THREE.MeshStandardMaterial({
          color: 0x3d4852,
          metalness: 0.35,
          roughness: 0.62,
        })
      );
      pad.position.set((rampTopRadius + padOuter) / 2, padY - 0.21, 0);
      pad.castShadow = true;
      pad.receiveShadow = true;
      deck.add(pad);

      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(deckLength * 0.72, 0.08, 0.7),
        new THREE.MeshStandardMaterial({
          color: laneColors[i],
          metalness: 0.2,
          roughness: 0.45,
        })
      );
      stripe.position.set((rampTopRadius + padOuter) / 2, padY + 0.04, 0);
      deck.add(stripe);

      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(rampSpan, 0.42, padHalfWidth * 2),
        new THREE.MeshStandardMaterial({
          color: 0x4a5661,
          metalness: 0.4,
          roughness: 0.55,
        })
      );
      ramp.position.set(
        (joinRadius + rampTopRadius) / 2,
        (joinY + padY) / 2 - 0.12,
        0
      );
      ramp.rotation.z = Math.atan2(rampDrop, rampLength);
      ramp.castShadow = true;
      ramp.receiveShadow = true;
      deck.add(ramp);

      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(deckLength, 0.7, 0.18),
          new THREE.MeshStandardMaterial({
            color: laneColors[i],
            metalness: 0.35,
            roughness: 0.45,
          })
        );
        rail.position.set(
          (rampTopRadius + padOuter) / 2,
          padY + 0.2,
          side * (padHalfWidth - 0.12)
        );
        rail.castShadow = true;
        deck.add(rail);
      }

      const wallHeight = 1.15;
      const tilt = Math.atan2(rampDrop, rampLength);
      const lift = 0.21 + wallHeight / 2;
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(rampSpan, wallHeight, 0.24),
          new THREE.MeshStandardMaterial({
            color: laneColors[i],
            metalness: 0.35,
            roughness: 0.45,
          })
        );
        wall.position.set(
          (joinRadius + rampTopRadius) / 2 - Math.sin(tilt) * lift,
          (joinY + padY) / 2 - 0.12 + Math.cos(tilt) * lift,
          side * padHalfWidth
        );
        wall.rotation.z = tilt;
        wall.castShadow = true;
        wall.receiveShadow = true;
        deck.add(wall);
      }

      scene.add(deck);
    }

    const standTextures: THREE.Texture[] = [];

    // Three rows of stands in the gaps between the ramps.
    // The crowd is one flat repeating strip per row, not a card per person.
    {
      const rowCount = 3;
      const tread = 1.28;
      const rise = 0.74;
      const standInner = outerRadius + 1.15;
      const rimY = surfaceHeight(outerRadius);
      const stepMaterial = new THREE.MeshLambertMaterial({ color: 0x5a3a42 });
      const seatMaterial = new THREE.MeshLambertMaterial({ color: 0x9a4450 });
      const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x2c333b });
      const stepParts: THREE.BufferGeometry[] = [];
      const seatParts: THREE.BufferGeometry[] = [];
      const wallParts: THREE.BufferGeometry[] = [];

      function arcStep(
        inner: number,
        outer: number,
        start: number,
        end: number,
        top: number,
        depth: number,
        parts: THREE.BufferGeometry[]
      ) {
        if (end - start < 0.18 || outer - inner < 0.08) return;
        const shape = new THREE.Shape();
        shape.moveTo(Math.cos(start) * inner, Math.sin(start) * inner);
        shape.absarc(0, 0, inner, start, end, false);
        shape.lineTo(Math.cos(end) * outer, Math.sin(end) * outer);
        shape.absarc(0, 0, outer, end, start, true);
        shape.closePath();
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: false,
          curveSegments: Math.max(4, Math.round((end - start) / 0.28)),
        });
        const holder = new THREE.Object3D();
        holder.rotation.x = Math.PI / 2;
        holder.position.y = top;
        holder.updateMatrix();
        geometry.applyMatrix4(holder.matrix);
        parts.push(geometry);
      }

      const crowdCanvas = document.createElement("canvas");
      const crowdSlots = 8;
      const crowdSlot = 48;
      crowdCanvas.width = crowdSlots * crowdSlot;
      crowdCanvas.height = 64;
      const crowdPaint = crowdCanvas.getContext("2d");
      if (crowdPaint) {
        const shirts = ["#e23d3d", "#2f74e6", "#f0c43a", "#2fad62", "#f4f6f8", "#f07a22", "#8b5cf6", "#14b8c4"];
        const hairs = ["#24180f", "#e2c56a", "#4a3020", "#161616", "#8d3d32", "#1a1a1a", "#c4a574", "#111111"];
        for (let i = 0; i < crowdSlots; i++) {
          const x = i * crowdSlot;
          crowdPaint.fillStyle = "#1c2430";
          crowdPaint.fillRect(x + 8, 44, 14, 14);
          crowdPaint.fillRect(x + 26, 44, 14, 14);
          crowdPaint.fillStyle = "#111111";
          crowdPaint.fillRect(x + 6, 56, 16, 6);
          crowdPaint.fillRect(x + 26, 56, 16, 6);
          crowdPaint.fillStyle = shirts[i];
          crowdPaint.fillRect(x + 10, 24, 28, 22);
          crowdPaint.fillStyle = "#e0b08a";
          crowdPaint.fillRect(x + 4, 30, 8, 14);
          crowdPaint.fillRect(x + 36, 30, 8, 14);
          crowdPaint.beginPath();
          crowdPaint.arc(x + 24, 16, 10, 0, Math.PI * 2);
          crowdPaint.fill();
          crowdPaint.fillStyle = hairs[i];
          crowdPaint.fillRect(x + 14, 6, 20, 8);
        }
      }
      const crowdTexture = new THREE.CanvasTexture(crowdCanvas);
      crowdTexture.colorSpace = THREE.SRGBColorSpace;
      crowdTexture.wrapS = THREE.RepeatWrapping;
      crowdTexture.magFilter = THREE.LinearFilter;
      crowdTexture.minFilter = THREE.LinearFilter;
      standTextures.push(crowdTexture);

      const crowdPositions: number[] = [];
      const crowdUvs: number[] = [];
      const crowdIndices: number[] = [];
      const personWidth = 0.82;

      function addCrowdStrip(from: number, to: number, radius: number, footY: number) {
        const span = to - from;
        const length = span * radius;
        const segments = Math.max(1, Math.round(length / 1.6));
        const height = 0.46;
        const lean = 0.7;
        const base = crowdPositions.length / 3;
        for (let i = 0; i <= segments; i++) {
          const ang = from + span * (i / segments);
          const c = Math.cos(ang);
          const s = Math.sin(ang);
          const along = length * (i / segments);
          crowdPositions.push(c * radius, footY, s * radius);
          crowdPositions.push(c * (radius + lean), footY + height, s * (radius + lean));
          crowdUvs.push(along / personWidth, 0, along / personWidth, 1);
        }
        for (let i = 0; i < segments; i++) {
          const a = base + i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          crowdIndices.push(a, c, b, c, d, b);
        }
      }

      const orderedLanes = [...laneAngles].sort((a, b) => a - b);
      const railOpen = 0.4;
      for (let section = 0; section < orderedLanes.length; section++) {
        const from = orderedLanes[section] + railOpen;
        let to = orderedLanes[(section + 1) % orderedLanes.length] - railOpen;
        if (section === orderedLanes.length - 1) to += Math.PI * 2;
        if (to - from < 0.28) continue;

        arcStep(
          outerRadius + 0.55,
          standInner,
          from,
          to,
          rimY + 0.15,
          1,
          wallParts
        );

        for (let row = 0; row < rowCount; row++) {
          const inner = standInner + row * tread;
          const outer = inner + tread + 0.04;
          const top = rimY + 0.22 + row * rise;
          arcStep(inner, outer, from, to, top, rise + 0.16, stepParts);
          arcStep(inner + 0.08, outer - 0.06, from, to, top + 0.05, 0.08, seatParts);

          addCrowdStrip(from, to, inner + tread * 0.42, top + 0.14);
        }

        const backInner = standInner + rowCount * tread - 0.02;
        const backTop = rimY + 0.22 + (rowCount - 1) * rise + 1.45;
        arcStep(backInner, backInner + 0.42, from, to, backTop, 1.7, wallParts);
      }

      for (const [parts, material] of [
        [stepParts, stepMaterial],
        [seatParts, seatMaterial],
        [wallParts, wallMaterial],
      ] as const) {
        if (parts.length === 0) continue;
        const geometry = mergeGeometries(parts, false);
        for (const part of parts) part.dispose();
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        scene.add(mesh);
      }

      if (crowdPositions.length > 0) {
        const crowdGeometry = new THREE.BufferGeometry();
        crowdGeometry.setAttribute("position", new THREE.Float32BufferAttribute(crowdPositions, 3));
        crowdGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(crowdUvs, 2));
        crowdGeometry.setIndex(crowdIndices);
        const crowdMesh = new THREE.Mesh(
          crowdGeometry,
          new THREE.MeshBasicMaterial({
            map: crowdTexture,
            alphaTest: 0.4,
            toneMapped: false,
            side: THREE.DoubleSide,
          })
        );
        crowdMesh.castShadow = false;
        crowdMesh.receiveShadow = false;
        scene.add(crowdMesh);
      }
    }

    // Simple 3D truck model
    const carWidthScale = 1.1;

    const flameCanvas = document.createElement("canvas");
    flameCanvas.width = 64;
    flameCanvas.height = 64;
    const flamePaint = flameCanvas.getContext("2d");
    if (flamePaint) {
      const glow = flamePaint.createRadialGradient(32, 42, 2, 32, 34, 30);
      glow.addColorStop(0, "rgba(255, 252, 230, 0.95)");
      glow.addColorStop(0.28, "rgba(255, 186, 48, 0.9)");
      glow.addColorStop(0.62, "rgba(230, 52, 8, 0.45)");
      glow.addColorStop(1, "rgba(40, 0, 0, 0)");
      flamePaint.fillStyle = glow;
      flamePaint.fillRect(0, 0, 64, 64);
    }
    const flameMap = new THREE.CanvasTexture(flameCanvas);
    flameMap.colorSpace = THREE.SRGBColorSpace;
    const flameMaterial = new THREE.SpriteMaterial({
      map: flameMap,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    function createTruck(
      ownColor: number,
      shellColor: number,
      weapon: WeaponId,
      x: number,
      z: number,
      rotation: number
    ) {
      const truck = new THREE.Group();

      const ownMaterial = new THREE.MeshStandardMaterial({
        color: ownColor,
        metalness: 0.45,
        roughness: 0.35,
      });

      const shellMaterial = new THREE.MeshStandardMaterial({
        color: shellColor,
        metalness: 0.45,
        roughness: 0.35,
      });

      const darkMaterial = new THREE.MeshStandardMaterial({
        color: 0x171b20,
        metalness: 0.25,
        roughness: 0.6,
      });

      const steel = new THREE.MeshStandardMaterial({
        color: 0xf4f7fb,
        metalness: 0.55,
        roughness: 0.28,
      });
      const edge = new THREE.MeshStandardMaterial({
        color: 0x141414,
        metalness: 0.35,
        roughness: 0.45,
      });
      const accent = new THREE.MeshStandardMaterial({
        color: ownColor,
        metalness: 0.4,
        roughness: 0.32,
      });
      const glass = new THREE.MeshStandardMaterial({
        color: 0x8ddcff,
        metalness: 0.4,
        roughness: 0.15,
        emissive: 0x123344,
      });

      let wheelX = 0.46;
      let wheelZ = [-0.65, 0.68];

      if (weapon === "wedge") {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.4, 1.72), shellMaterial);
        hull.position.y = 0.56;
        hull.castShadow = true;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.48, 0.5), ownMaterial);
        cab.position.set(0, 0.98, -0.5);
        cab.castShadow = true;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.04), glass);
        window.position.set(0, 1.05, -0.76);
        truck.add(hull, cab, window);
        wheelX = 0.64;
        wheelZ = [-0.4, 0.46];
      } else if (weapon === "axe") {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.46, 1.5), shellMaterial);
        hull.position.y = 0.6;
        hull.castShadow = true;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.12, 0.58), ownMaterial);
        cab.position.set(0, 1.32, -0.42);
        cab.castShadow = true;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.04), glass);
        window.position.set(0, 1.48, -0.72);
        truck.add(hull, cab, window);
        wheelX = 0.36;
        wheelZ = [-0.48, 0.4];
      } else if (weapon === "spinner") {
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.38, 28), shellMaterial);
        hull.position.y = 0.58;
        hull.castShadow = true;
        const cab = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), ownMaterial);
        cab.position.set(0, 0.92, -0.28);
        cab.castShadow = true;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.04), glass);
        window.position.set(0, 0.98, -0.54);
        truck.add(hull, cab, window);
        wheelX = 0.72;
        wheelZ = [-0.38, 0.38];
      } else if (weapon === "saw") {
        const hull = new THREE.Mesh(new THREE.SphereGeometry(0.7, 22, 16), shellMaterial);
        hull.scale.set(1.12, 0.58, 1.48);
        hull.position.y = 0.68;
        hull.castShadow = true;
        const cab = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), ownMaterial);
        cab.position.set(0, 1.02, -0.55);
        cab.castShadow = true;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.04), glass);
        window.position.set(0, 1.08, -0.8);
        truck.add(hull, cab, window);
        wheelX = 0.55;
        wheelZ = [-0.55, 0.48];
      } else if (weapon === "plow") {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.34, 2.5), shellMaterial);
        hull.position.y = 0.54;
        hull.castShadow = true;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.58, 0.48), ownMaterial);
        cab.position.set(0, 0.98, -0.9);
        cab.castShadow = true;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.28, 0.04), glass);
        window.position.set(0, 1.08, -1.15);
        truck.add(hull, cab, window);
        wheelX = 0.5;
        wheelZ = [-0.85, 0.72];
      } else {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.42, 0.82), shellMaterial);
        hull.position.set(0, 0.58, -0.42);
        hull.castShadow = true;
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.7, 6), shellMaterial);
        nose.rotation.x = -Math.PI / 2;
        nose.position.set(0, 0.6, 0.52);
        nose.castShadow = true;
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.38), ownMaterial);
        cab.position.set(0, 0.98, -0.52);
        cab.castShadow = true;
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.04), glass);
        window.position.set(0, 1.04, -0.72);
        truck.add(hull, nose, cab, window);
        wheelX = 0.38;
        wheelZ = [-0.48, 0.12];
      }

      if (weapon === "wedge") {
        const scoop = new THREE.MeshStandardMaterial({
          color: 0x8e979f,
          metalness: 0.35,
          roughness: 0.55,
        });
        const scoopLip = new THREE.MeshStandardMaterial({
          color: 0x5e676f,
          metalness: 0.4,
          roughness: 0.46,
        });
        const wedge = new THREE.Group();
        wedge.name = "wedge";
        for (const side of [-1, 1]) {
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.95), scoop);
          arm.position.set(side * 0.46, 0.02, 0.42);
          arm.castShadow = true;
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.48, 0.72), scoop);
          wall.position.set(side * 0.66, 0.04, 1.24);
          wall.castShadow = true;
          wedge.add(arm, wall);
        }
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.62, 0.1), scoop);
        back.position.set(0, 0.12, 0.9);
        back.castShadow = true;
        const floor = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.72), scoop);
        floor.position.set(0, -0.16, 1.24);
        floor.castShadow = true;
        const lip = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.1), scoopLip);
        lip.position.set(0, -0.1, 1.6);
        lip.castShadow = true;
        wedge.add(back, floor, lip);
        wedge.position.set(0, 0.78, 1.02);
        wedge.rotation.x = 0.5;
        truck.add(wedge);
      } else if (weapon === "axe") {
        const axe = new THREE.Group();
        axe.name = "axe";
        axe.position.set(0, 1.05, -0.05);
        axe.rotation.x = -0.55;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.85, 0.16), steel);
        handle.position.y = 0.9;
        handle.castShadow = true;
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.2), accent);
        grip.position.y = 0.22;
        const socket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.4), steel);
        socket.position.set(0, 1.72, 0.02);
        socket.castShadow = true;
        const blade = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.45, 4), steel);
        blade.scale.set(0.95, 1, 1);
        blade.rotation.x = Math.PI / 2;
        blade.position.set(0, 1.62, 0.7);
        blade.castShadow = true;
        const bit = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.16), edge);
        bit.position.set(0, 1.42, 1.32);
        bit.castShadow = true;
        const beard = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.48, 0.22), edge);
        beard.position.set(0, 1.22, 0.48);
        beard.castShadow = true;
        axe.add(handle, grip, socket, blade, bit, beard);
        truck.add(axe);
      } else if (weapon === "spinner") {
        const spinner = new THREE.Group();
        spinner.name = "spinner";
        spinner.position.set(0, 0.78, 1.22);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.2, 0.32), steel);
        bar.castShadow = true;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 12), accent);
        hub.castShadow = true;
        spinner.add(bar, hub);
        for (const side of [-1, 1]) {
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.42), edge);
          tooth.position.set(side * 0.98, 0, 0);
          tooth.castShadow = true;
          spinner.add(tooth);
        }
        truck.add(spinner);
      } else if (weapon === "saw") {
        const saw = new THREE.Group();
        saw.name = "saw";
        saw.position.set(0, 1.14, 0.82);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.1, 28), steel);
        disc.castShadow = true;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 12), accent);
        hub.castShadow = true;
        saw.add(disc, hub);
        for (let toothIndex = 0; toothIndex < 10; toothIndex++) {
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.24), edge);
          const angle = (toothIndex / 10) * Math.PI * 2;
          tooth.position.set(Math.cos(angle) * 0.84, 0, Math.sin(angle) * 0.84);
          tooth.rotation.y = -angle;
          tooth.castShadow = true;
          saw.add(tooth);
        }
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.18), steel);
        post.position.set(0, -0.18, -0.2);
        post.castShadow = true;
        saw.add(post);
        truck.add(saw);
      } else if (weapon === "plow") {
        const plow = new THREE.Group();
        plow.name = "plow";
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.72, 0.32), steel);
        blade.castShadow = true;
        const lip = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.16, 0.14), edge);
        lip.position.set(0, 0.28, 0.16);
        lip.castShadow = true;
        const mark = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.08), accent);
        mark.position.set(0, 0.02, 0.18);
        plow.add(blade, lip, mark);
        plow.position.set(0, 0.78, 1.38);
        plow.rotation.x = 0.85;
        truck.add(plow);
      } else if (weapon === "spike") {
        const spike = new THREE.Group();
        spike.name = "spike";
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.18, 0.18), steel);
        bar.position.set(0, 0.64, 1.12);
        bar.castShadow = true;
        spike.add(bar);
        for (const [x, length, z] of [
          [0, 1.25, 1.55],
          [-0.4, 0.82, 1.32],
          [0.4, 0.82, 1.32],
        ] as const) {
          const prong = new THREE.Mesh(new THREE.ConeGeometry(0.2, length, 8), edge);
          prong.rotation.x = Math.PI / 2;
          prong.position.set(x, 0.64, z);
          prong.castShadow = true;
          spike.add(prong);
        }
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.2), accent);
        band.position.set(0, 0.64, 1.02);
        spike.add(band);
        truck.add(spike);
      }

      for (const side of [-1, 1]) {
        for (const axle of wheelZ) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.18, 20),
            darkMaterial
          );

          wheel.name = "wheel";
          wheel.userData.spin = 0;
          wheel.castShadow = false;
          wheel.position.set(side * wheelX, 0.32, axle);
          truck.add(wheel);
        }
      }

      const blaze = new THREE.Group();
      blaze.name = "blaze";
      blaze.visible = false;
      for (const [x, y, z] of [
        [0, 0.95, 0.05],
        [-0.34, 1.2, -0.25],
        [0.36, 1.1, 0.28],
        [0, 1.55, -0.4],
        [0.08, 0.78, 0.72],
      ] as const) {
        const flame = new THREE.Sprite(flameMaterial.clone());
        flame.position.set(x, y, z);
        flame.userData.baseY = y;
        flame.scale.set(0.9, 1.3, 1);
        blaze.add(flame);
      }
      const fireLight = new THREE.PointLight(0xff6a1a, 0, 7);
      fireLight.position.set(0, 1.15, 0);
      blaze.add(fireLight);
      truck.add(blaze);

      truck.position.set(
        x,
        surfaceHeight(Math.hypot(x, z)) + 0.12,
        z
      );

      truck.rotation.order = "YXZ";
      truck.rotation.y = rotation;
      truck.scale.x = carWidthScale;
      scene.add(truck);

      return truck;
    }

    const trucks = laneAngles.map((lane, index) => {
      const startRadius = (rampTopRadius + padOuter) / 2;
      const own = laneColors[index];
      const shell =
        mode === "teams"
          ? Number.parseInt(teams[teamOf(players[index].id)].color.slice(1), 16)
          : own;
      const truck = createTruck(
        own,
        shell,
        players[index].weapon,
        Math.cos(lane) * startRadius,
        Math.sin(lane) * startRadius,
        Math.atan2(-Math.cos(lane), -Math.sin(lane))
      );
      truck.position.y = padY + 0.12;
      return truck;
    });

    const spawns = trucks.map((truck) => ({
      x: truck.position.x,
      y: truck.position.y,
      z: truck.position.z,
      yaw: truck.rotation.y,
    }));

    // Keyboard controls
    const keys = {
      get forward() {
        return keyDown.current.forward || touchDown.current.forward || gamepadDrive.current.forward;
      },
      set forward(value: boolean) {
        keyDown.current.forward = value;
      },
      get backward() {
        return keyDown.current.backward || touchDown.current.backward || gamepadDrive.current.backward;
      },
      set backward(value: boolean) {
        keyDown.current.backward = value;
      },
      get left() {
        return keyDown.current.left || touchDown.current.left || gamepadDrive.current.left;
      },
      set left(value: boolean) {
        keyDown.current.left = value;
      },
      get right() {
        return keyDown.current.right || touchDown.current.right || gamepadDrive.current.right;
      },
      set right(value: boolean) {
        keyDown.current.right = value;
      },
    };

    function sampleGamepad() {
      const drive = gamepadDrive.current;
      const pads = navigator.getGamepads?.() ?? [];
      let pad: Gamepad | null = null;
      for (const candidate of pads) {
        if (candidate?.connected) {
          pad = candidate;
          break;
        }
      }
      if (!pad) {
        drive.forward = false;
        drive.backward = false;
        drive.left = false;
        drive.right = false;
        drive.steer = 0;
        drive.weapon = false;
        return;
      }

      const dead = 0.18;
      const stickX = pad.axes[0] ?? 0;
      const stickY = pad.axes[1] ?? 0;
      const brake = pad.buttons[6]?.value ?? 0;
      const gas = pad.buttons[7]?.value ?? 0;
      const dUp = pad.buttons[12]?.pressed ?? false;
      const dDown = pad.buttons[13]?.pressed ?? false;
      const dLeft = pad.buttons[14]?.pressed ?? false;
      const dRight = pad.buttons[15]?.pressed ?? false;
      const cross = pad.buttons[0]?.pressed ?? false;
      const circle = pad.buttons[1]?.pressed ?? false;

      if (Math.abs(stickX) > dead) drive.steer = THREE.MathUtils.clamp(-stickX, -1, 1);
      else if (dLeft) drive.steer = 1;
      else if (dRight) drive.steer = -1;
      else drive.steer = 0;

      drive.left = drive.steer > dead;
      drive.right = drive.steer < -dead;

      if (gas > 0.12 || brake > 0.12) {
        drive.forward = gas > 0.12;
        drive.backward = brake > 0.12 && gas <= 0.12;
      } else {
        drive.forward = stickY < -dead || dUp;
        drive.backward = stickY > dead || dDown || circle;
      }
      drive.weapon = cross;

      if ((drive.forward || drive.backward || drive.left || drive.right || drive.weapon) && audio.state === "suspended") {
        void audio.resume();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]
          .includes(event.key)
      ) {
        event.preventDefault();
      }

      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
        keys.forward = true;
        if (audio.state === "suspended") void audio.resume();
      }

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
        keys.backward = true;
      }

      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        keys.left = true;
      }

      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        keys.right = true;
      }

      if (event.key.toLowerCase() === "x") {
        weaponKey.current = true;
        if (audio.state === "suspended") void audio.resume();
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
        keys.forward = false;
      }

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
        keys.backward = false;
      }

      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        keys.left = false;
      }

      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        keys.right = false;
      }

      if (event.key.toLowerCase() === "x") {
        weaponKey.current = false;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let playerSpeed = 0;
    const remoteSpeed = trucks.map(() => 0);
    const remoteSteer = trucks.map(() => 0);
    let playerAngle = -Math.PI / 2;
    let playerKnockX = 0;
    let playerKnockZ = 0;
    const knockX = trucks.map(() => 0);
    const knockZ = trucks.map(() => 0);
    const driveX = trucks.map(() => 0);
    const driveZ = trucks.map(() => 0);
    const heading = spawns.map((spawn) => spawn.yaw);
    const roll = trucks.map(() => 0);
    const rollVel = trucks.map(() => 0);
    const yawRate = trucks.map(() => 0);
    const leanTarget = trucks.map(() => 0);
    let steerSmooth = 0;
    const tipped = trucks.map(() => false);
    const downFor = trucks.map(() => 0);
    const hop = trucks.map(() => 0);
    const weaponAnim = trucks.map(() => 0);
    const weaponOn = trucks.map(() => false);
    const health = trucks.map(() => maxLife);
    const pendingPoints: Array<{ attacker: number; victim: number; points: number }> = [];
    const pinnedTo = trucks.map(() => -1);
    const pinLeft = trucks.map(() => 0);
    const falling = trucks.map(() => false);
    const burnLeft = trucks.map(() => 0);
    const fallToHole = trucks.map(() => false);
    const deathHow = trucks.map(() => "kanten" as "hålet" | "kanten" | "livet");
    const outOrder: number[] = [];
    const fallSpeed = trucks.map(() => 0);
    const slopeX = trucks.map(() => 0);
    const slopeZ = trucks.map(() => 0);
    const contactPairs = new Set<string>();
    const leaderRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.07, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe56a })
    );
    leaderRing.rotation.x = Math.PI / 2;
    leaderRing.visible = false;
    scene.add(leaderRing);
    const leaderLight = new THREE.PointLight(0xffe56a, 0, 7);
    scene.add(leaderLight);

    const cameraOffset = new THREE.Vector3(0, 25, 28.1);
    const slopeNormal = new THREE.Vector3();
    const slopeForward = new THREE.Vector3();
    const slopeRight = new THREE.Vector3();
    const slopeMatrix = new THREE.Matrix4();
    const slopeQuat = new THREE.Quaternion();
    const tipQuat = new THREE.Quaternion();
    const tipAxis = new THREE.Vector3(0, 0, 1);
    const chassisProfile: Array<[number, number]> = [
      [-0.405, 0.375],
      [0.405, 0.375],
      [-0.405, 0.965],
      [0.405, 0.965],
      [-0.315, 0.965],
      [0.315, 0.965],
      [-0.315, 1.835],
      [0.315, 1.835],
      [-0.55, 0],
      [0.55, 0],
      [-0.55, 0.64],
      [0.55, 0.64],
    ];

    const weaponProfile: Record<string, Array<[number, number]>> = {
      wedge: [
        [-0.82, 0.14],
        [0.82, 0.14],
        [-0.82, 1.05],
        [0.82, 1.05],
      ],
      axe: [
        [-0.62, 1.15],
        [0.62, 1.15],
        [-0.62, 3.05],
        [0.62, 3.05],
      ],
      spinner: [
        [-1.12, 0.6],
        [1.12, 0.6],
        [-1.12, 1.0],
        [1.12, 1.0],
      ],
      saw: [
        [-0.92, 0.98],
        [0.92, 0.98],
        [-0.92, 1.32],
        [0.92, 1.32],
      ],
      plow: [
        [-0.9, 0.16],
        [0.9, 0.16],
        [-0.9, 1.2],
        [0.9, 1.2],
      ],
      spike: [
        [-0.5, 0.4],
        [0.5, 0.4],
        [-0.5, 0.95],
        [0.5, 0.95],
      ],
    };

    function chassisClearance(angle: number, index: number) {
      const lean = Math.sin(angle);
      const upright = Math.cos(angle);
      let lowest = 0;
      const points = chassisProfile.concat(weaponProfile[players[index].weapon] ?? []);
      for (const [x, y] of points) {
        const height = x * carWidthScale * lean + y * upright;
        if (height < lowest) lowest = height;
      }
      return -lowest;
    }
    const wheelAxle = new THREE.Quaternion();
    const wheelRoll = new THREE.Quaternion();
    const wheelRollAxis = new THREE.Vector3(0, 1, 0);

    function addTip(index: number, amount: number) {
      if (tipped[index]) return;
      rollVel[index] += amount;
    }

    function stepChassis(
      index: number,
      gasSpeed: number,
      steerInput: number,
      response: number
    ) {
      if (pinnedTo[index] >= 0) {
        driveX[index] *= Math.exp(-12 * dt);
        driveZ[index] *= Math.exp(-12 * dt);
        return;
      }
      const speedAbs = Math.abs(gasSpeed);
      const reverse = gasSpeed < -0.35 ? -1 : 1;
      const pivot = tipped[index]
        ? 0.28
        : 0.9 * THREE.MathUtils.clamp(1.2 - speedAbs / 8, 0, 1);
      const curvature = tipped[index] ? 0.06 : 0.21;
      const maxRate = tipped[index] ? 0.55 : 2.2;
      const wanted = steerInput * reverse * (pivot + speedAbs * curvature);
      const targetRate = THREE.MathUtils.clamp(wanted, -maxRate, maxRate);
      yawRate[index] += (targetRate - yawRate[index]) * Math.min(1, response * dt);
      heading[index] += yawRate[index] * dt;
      if (index === 0) playerAngle = heading[0];

      const forwardX = Math.sin(heading[index]);
      const forwardZ = Math.cos(heading[index]);
      const rightX = Math.cos(heading[index]);
      const rightZ = -Math.sin(heading[index]);
      let along = driveX[index] * forwardX + driveZ[index] * forwardZ;
      let lateral = driveX[index] * rightX + driveZ[index] * rightZ;

      const engine = index === 0 ? 22 : 18;
      along += (gasSpeed - along) * Math.min(1, engine * dt);
      along -= along * Math.abs(yawRate[index]) * 0.04 * dt;

      const radius = Math.hypot(trucks[index].position.x, trucks[index].position.z);
      const slopeGrip =
        radius > outerRadius
          ? 0.92
          : 1 - THREE.MathUtils.clamp(radius / outerRadius, 0, 1) * 0.16;
      const speedGrip = 1 - THREE.MathUtils.clamp((speedAbs - 8) / 10, 0, 1) * 0.22;
      const grip = (tipped[index] ? 0.35 : 1) * slopeGrip * speedGrip;
      lateral *= Math.exp(-(8 + grip * 18) * dt);
      lateral += yawRate[index] * along * (1 - grip) * 0.12 * dt;

      driveX[index] = forwardX * along + rightX * lateral;
      driveZ[index] = forwardZ * along + rightZ * lateral;

      const pace = THREE.MathUtils.clamp((speedAbs - 3) / 10, 0, 1);
      const bank = yawRate[index] * along * (0.022 + pace * 0.012);
      leanTarget[index] = THREE.MathUtils.clamp(
        bank + lateral * 0.02,
        -0.24 - pace * 0.08,
        0.24 + pace * 0.08
      );

      if (index === 0) {
        playerSpeed -= playerSpeed * Math.abs(yawRate[index]) * 0.03 * dt;
      }
    }

    function poseWeapon(index: number) {
      const truck = trucks[index];
      const armed = weaponOn[index];
      const blend = Math.min(1, 8 * dt);

      const wedge = truck.getObjectByName("wedge");
      if (wedge) {
        const target = armed ? -0.9 : 0.5;
        wedge.rotation.x += (target - wedge.rotation.x) * blend;
      }

      const plow = truck.getObjectByName("plow");
      if (plow) {
        const target = armed ? 1.15 : 0.28;
        plow.rotation.x += (target - plow.rotation.x) * blend;
      }

      const spike = truck.getObjectByName("spike");
      if (spike) {
        const target = armed ? 0.55 : 0;
        spike.position.z += (target - spike.position.z) * Math.min(1, 10 * dt);
      }

      const axe = truck.getObjectByName("axe");
      if (axe) {
        let holding = false;
        for (let victim = 0; victim < pinnedTo.length; victim++) {
          if (pinnedTo[victim] === index) holding = true;
        }
        const target = armed || holding ? 0.5 : 0;
        weaponAnim[index] += (target - weaponAnim[index]) * blend;
        axe.rotation.x = -0.55 + Math.sin(weaponAnim[index] * Math.PI) * 1.35;
      }

      const spinner = truck.getObjectByName("spinner");
      if (spinner && armed) spinner.rotation.y += dt * 8;

      const saw = truck.getObjectByName("saw");
      if (saw && armed) saw.rotation.y += dt * 16;
    }

    function lifeShare(value: number) {
      return Math.max(0, Math.min(100, (value / maxLife) * 100));
    }

    function lifeColor(share: number) {
      return share > 60 ? "#4ade80" : share > 30 ? "#facc15" : "#f87171";
    }

    function paintLife(value: number) {
      const left = Math.max(0, Math.round(value));
      const share = lifeShare(value);
      if (lifeLabelRef.current) lifeLabelRef.current.textContent = `Liv: ${left}`;
      if (lifeFillRef.current) {
        lifeFillRef.current.style.width = `${share}%`;
        lifeFillRef.current.style.background = lifeColor(share);
      }
    }

    function paintRivals(values: number[]) {
      for (let index = 0; index < values.length; index++) {
        const value = values[index] ?? 0;
        const left = Math.max(0, Math.round(value));
        const share = lifeShare(value);
        const label = rivalLabelRefs.current[index];
        const fill = rivalFillRefs.current[index];
        if (label) label.textContent = String(left);
        if (fill) {
          fill.style.width = `${share}%`;
          fill.style.background = lifeColor(share);
        }
      }
    }

    function chipLife(victim: number, attacker: number) {
      if (health[victim] <= 0 || falling[victim]) return;
      const before = health[victim];
      health[victim] = Math.max(0, before - 7);
      const dealt = before - health[victim];
      if (dealt > 0 && attacker !== victim) {
        pendingPoints.push({ attacker, victim, points: dealt });
      }
      if (victim === 0) paintLife(health[victim]);
      paintRivals(health);
    }

    function poseBlaze(truck: THREE.Object3D, burning: boolean) {
      const blaze = truck.getObjectByName("blaze");
      if (!blaze) return;
      blaze.visible = burning;
      if (!burning) return;
      const time = performance.now() * 0.012;
      let flameIndex = 0;
      for (const child of blaze.children) {
        if (child instanceof THREE.Sprite) {
          const flicker = 0.7 + Math.sin(time * (2.2 + flameIndex * 0.37) + flameIndex * 1.7) * 0.3;
          const width = (0.82 + (flameIndex % 3) * 0.2) * flicker;
          child.scale.set(width, width * 1.5, 1);
          child.position.y = (child.userData.baseY as number) + Math.sin(time * 1.5 + flameIndex) * 0.14;
          const material = child.material;
          material.opacity = 0.45 + flicker * 0.5;
          flameIndex += 1;
        } else if (child instanceof THREE.PointLight) {
          child.intensity = 12 + Math.sin(time * 3.4) * 7;
        }
      }
    }

    function settleRoll(index: number, riseStrength: number) {
      const truck = trucks[index];

      if (falling[index]) {
        if (deathHow[index] === "livet") {
          burnLeft[index] -= dt;
          if (burnLeft[index] > 0) {
            poseBlaze(truck, true);
            return;
          }
          poseBlaze(truck, false);
          truck.visible = false;
          return;
        }

        fallSpeed[index] += 18 * dt;
        truck.position.y -= fallSpeed[index] * dt;

        if (fallToHole[index]) {
          const sinkRadius = Math.hypot(truck.position.x, truck.position.z) || 1;
          truck.position.x -= (truck.position.x / sinkRadius) * 1.4 * dt;
          truck.position.z -= (truck.position.z / sinkRadius) * 1.4 * dt;
        }

        if (truck.position.y < (fallToHole[index] ? holeMouth - 2.6 : -11)) {
          truck.visible = false;
        }
        return;
      }

      if (index > 0 && eliminated.current.has(index)) return;

      if (!tipped[index]) {
        rollVel[index] -= (roll[index] - leanTarget[index]) * 16 * dt;
        rollVel[index] *= Math.pow(0.93, dt * 60);
        roll[index] += rollVel[index] * dt;

        if (Math.abs(roll[index]) > 1.28) {
          tipped[index] = true;
          downFor[index] = 0;
          rollVel[index] += Math.sign(roll[index] || 1) * 0.6;
        }
      } else {
        downFor[index] += dt;
        const sign = Math.sign(roll[index] || 1);
        const downTarget = sign * Math.PI * 0.92;
        const rise = downFor[index] >= 1 ? riseStrength : 0;

        if (rise > 0) {
          rollVel[index] -= sign * 9 * rise * dt;
          rollVel[index] -= roll[index] * 6 * rise * dt;
        }

        rollVel[index] += (downTarget - roll[index]) * 1.1 * dt;
        rollVel[index] *= Math.pow(0.9, dt * 60);
        roll[index] += rollVel[index] * dt;

        if (rise > 0 && Math.abs(roll[index]) < 0.7) {
          tipped[index] = false;
          downFor[index] = 0;
          rollVel[index] *= 0.2;
        }
      }

      const radius = Math.hypot(truck.position.x, truck.position.z);
      const yaw = heading[index];
      let slopeLift = 0;
      const ground =
        supportHeight(truck.position.x, truck.position.z) ??
        surfaceHeight(Math.min(radius, outerRadius));
      const step = 0.45;
      const sample = (x: number, z: number) => supportHeight(x, z) ?? ground;
      const dhdx =
        (sample(truck.position.x + step, truck.position.z) -
          sample(truck.position.x - step, truck.position.z)) /
        (step * 2);
      const dhdz =
        (sample(truck.position.x, truck.position.z + step) -
          sample(truck.position.x, truck.position.z - step)) /
        (step * 2);

      slopeForward.set(Math.sin(yaw), 0, Math.cos(yaw));
      slopeNormal.set(-dhdx, 1, -dhdz).normalize();
      slopeLift = Math.hypot(slopeNormal.x, slopeNormal.z) * 0.34;

      slopeForward.projectOnPlane(slopeNormal);
      if (slopeForward.lengthSq() < 1e-6) {
        slopeForward.set(Math.sin(yaw), 0, Math.cos(yaw));
      }
      slopeForward.normalize();
      slopeRight.crossVectors(slopeNormal, slopeForward).normalize();
      slopeMatrix.makeBasis(slopeRight, slopeNormal, slopeForward);
      slopeQuat.setFromRotationMatrix(slopeMatrix);
      tipQuat.setFromAxisAngle(tipAxis, roll[index]);
      truck.quaternion.copy(slopeQuat).multiply(tipQuat);

      const rollLift =
        chassisClearance(roll[index], index) + (tipped[index] ? 0.12 : 0);
      hop[index] = Math.max(0, hop[index] - dt * 2.4);
      truck.position.y =
        ground + slopeLift + rollLift / Math.max(slopeNormal.y, 0.5) + hop[index];

      poseWeapon(index);

      const along =
        driveX[index] * Math.sin(yaw) + driveZ[index] * Math.cos(yaw);
      const wheelSpin = (along / 0.32) * dt;
      wheelAxle.setFromAxisAngle(tipAxis, Math.PI / 2);
      for (const child of truck.children) {
        if (child.name !== "wheel") continue;
        child.userData.spin += wheelSpin;
        wheelRoll.setFromAxisAngle(wheelRollAxis, child.userData.spin);
        child.quaternion.copy(wheelAxle).multiply(wheelRoll);
      }
    }

    function truckPower(
      x: number,
      z: number,
      rotationY: number,
      vx: number,
      vz: number
    ) {
      const speed = Math.hypot(vx, vz);
      const radius = Math.hypot(x, z);
      const slope =
        radius > outerRadius
          ? 0.15
          : THREE.MathUtils.clamp(radius / outerRadius, 0, 1);
      const grip = 1 - slope * 0.7;

      let alignment = 1;
      if (speed > 0.2) {
        const forwardX = Math.sin(rotationY);
        const forwardZ = Math.cos(rotationY);
        alignment = Math.abs((forwardX * vx + forwardZ * vz) / speed);
      }

      const pace = THREE.MathUtils.clamp((speed - 4.5) / 10, 0, 1);
      const speedBalance = 1 - pace * 0.5;
      const balance = grip * (0.4 + 0.6 * alignment) * speedBalance;
      return { speed, balance, power: speed * balance };
    }

    function truckVelocity(index: number) {
      return {
        x: driveX[index] + (index === 0 ? playerKnockX : knockX[index]) + slopeX[index],
        z: driveZ[index] + (index === 0 ? playerKnockZ : knockZ[index]) + slopeZ[index],
      };
    }

    function addKnock(index: number, x: number, z: number) {
      if (index === 0) {
        playerKnockX += x;
        playerKnockZ += z;
        return;
      }

      knockX[index] += x;
      knockZ[index] += z;
    }

    function useWeapon(
      attacker: number,
      victim: number,
      towardX: number,
      towardZ: number,
      closing: number
    ) {
      if (!weaponOn[attacker] || closing < 1.5 || falling[victim] || health[victim] <= 0) return;
      const weapon = players[attacker].weapon;
      const fx = Math.sin(heading[attacker]);
      const fz = Math.cos(heading[attacker]);
      const nose = fx * towardX + fz * towardZ;
      const vrx = Math.cos(heading[victim]);
      const vrz = -Math.sin(heading[victim]);
      const sideHit = towardX * vrx + towardZ * vrz;
      const sign = Math.sign(sideHit || 1);
      const arx = Math.cos(heading[attacker]);
      const arz = -Math.sin(heading[attacker]);
      const flank = Math.abs(towardX * arx + towardZ * arz);
      let connected = false;

      if (weapon === "wedge" && nose > 0.42) {
        addTip(victim, sign * Math.min(2.6 + closing * 0.28, 5.4));
        hop[victim] = Math.min(1.35, Math.max(hop[victim], 0.62));
        connected = true;
      } else if (weapon === "axe" && nose > 0.7 && closing > 2.2) {
        addTip(victim, sign * Math.min(5 + closing * 0.12, 7.4));
        if (pinnedTo[victim] < 0 && pinnedTo[attacker] !== victim) {
          pinnedTo[victim] = attacker;
          pinLeft[victim] = 2.6;
        }
        connected = true;
      } else if (weapon === "axe" && closing > 2) {
        addTip(victim, sign * Math.min(3.2 + closing * 0.1, 5));
        connected = true;
      } else if (weapon === "spinner" && flank > 0.45) {
        const shove = Math.min(3.2 + closing * 0.35, 7);
        addKnock(victim, towardX * shove, towardZ * shove);
        addTip(victim, sign * Math.min(2.4 + closing * 0.22, 5));
        connected = true;
      } else if (weapon === "saw" && closing > 1.8) {
        addTip(victim, sign * Math.min(3.6 + closing * 0.28, 6.4));
        const shove = Math.min(2.2 + closing * 0.22, 5);
        addKnock(victim, towardX * shove, towardZ * shove);
        if (victim === 0) playerSpeed *= 0.5;
        else {
          driveX[victim] *= 0.45;
          driveZ[victim] *= 0.45;
        }
        connected = true;
      } else if (weapon === "plow" && nose > 0.28) {
        const shove = Math.min(2.8 + closing * 0.3, 6.5);
        addKnock(victim, towardX * shove, towardZ * shove);
        hop[victim] = Math.min(1.35, Math.max(hop[victim], 0.38));
        connected = true;
      } else if (weapon === "spike" && nose > 0.45) {
        const punch = Math.min(4.2 + closing * 0.45, 9);
        addKnock(victim, fx * punch, fz * punch);
        connected = true;
      }

      if (connected) chipLife(victim, attacker);
    }

    function bodyBox(index: number) {
      const weapon = players[index].weapon;
      if (weapon === "spinner") return { length: 1.25, width: 1.12 * carWidthScale };
      if (weapon === "axe") return { length: 1.9, width: 0.78 * carWidthScale };
      if (weapon === "spike") return { length: 1.9, width: 0.7 * carWidthScale };
      if (weapon === "saw") return { length: 1.65, width: 0.95 * carWidthScale };
      if (weapon === "wedge" || weapon === "plow") return { length: 1.75, width: 0.82 * carWidthScale };
      return { length: 1.2, width: 0.62 * carWidthScale };
    }

    function outwardExtent(index: number, nx: number, nz: number) {
      const yaw = heading[index];
      const forwardX = Math.sin(yaw);
      const forwardZ = Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const box = bodyBox(index);
      return (
        box.length * Math.abs(forwardX * nx + forwardZ * nz) +
        box.width * Math.abs(rightX * nx + rightZ * nz)
      );
    }

    // Oriented box in the funnel plane, so a hit on the flank is different
    // from a hit on the nose.
    function obbContact(i: number, j: number) {
      const a = trucks[i];
      const b = trucks[j];
      const aYaw = heading[i];
      const bYaw = heading[j];
      const aForward = { x: Math.sin(aYaw), z: Math.cos(aYaw) };
      const aRight = { x: Math.cos(aYaw), z: -Math.sin(aYaw) };
      const bForward = { x: Math.sin(bYaw), z: Math.cos(bYaw) };
      const bRight = { x: Math.cos(bYaw), z: -Math.sin(bYaw) };
      const aReachBox = bodyBox(i);
      const bReachBox = bodyBox(j);
      const deltaX = b.position.x - a.position.x;
      const deltaZ = b.position.z - a.position.z;
      const axes = [aForward, aRight, bForward, bRight];

      let minOverlap = Infinity;
      let nx = 0;
      let nz = 0;

      for (const axis of axes) {
        const dist = deltaX * axis.x + deltaZ * axis.z;
        const aReach =
          aReachBox.length * Math.abs(aForward.x * axis.x + aForward.z * axis.z) +
          aReachBox.width * Math.abs(aRight.x * axis.x + aRight.z * axis.z);
        const bReach =
          bReachBox.length * Math.abs(bForward.x * axis.x + bForward.z * axis.z) +
          bReachBox.width * Math.abs(bRight.x * axis.x + bRight.z * axis.z);
        const overlap = aReach + bReach - Math.abs(dist);

        if (overlap <= 0) return null;

        if (overlap < minOverlap) {
          minOverlap = overlap;
          const sign = dist < 0 ? -1 : 1;
          nx = axis.x * sign;
          nz = axis.z * sign;
        }
      }

      return { overlap: minOverlap, nx, nz };
    }

    // Camera and rendering
    let animationFrame = 0;
    let running = true;

    let previousTime = 0;
    let dt = 1 / 60;
    let countdownElapsed = 0;
    let matchElapsed = 0;

    function holeRadiusNow() {
      if (!raceStarted.current || matchElapsed < 90) return innerRadius;
      const grow = Math.min((matchElapsed - 90) / 30, 1);
      return innerRadius + grow * 0.95;
    }

    function refreshHole(radius: number) {
      const builtRim = innerRadius + 0.08;
      const rimScale = (radius + 0.08) / builtRim;
      holeRim.scale.set(rimScale, rimScale, rimScale);
      holeRim.position.y = surfaceHeight(radius) + 0.04;
      holeCover.position.y = surfaceHeight(radius) + 0.1;
      holeGlow.distance = 11 + (radius - innerRadius) * 2;
      pit.position.y = surfaceHeight(radius);
      pit.scale.set(radius / innerRadius, 1, radius / innerRadius);

      if (Math.abs(radius - shownHole) > 0.025) {
        shownHole = radius;
        holeCover.geometry.dispose();
        holeCover.geometry = new THREE.RingGeometry(
          innerRadius + 0.04,
          Math.max(radius, innerRadius + 0.06),
          72
        );
      }

      for (const stripe of holeStripes) {
        const stripeRadius = radius + 0.7;
        stripe.mesh.position.set(
          Math.cos(stripe.angle) * stripeRadius,
          surfaceHeight(stripeRadius) + 0.1,
          Math.sin(stripe.angle) * stripeRadius
        );
      }
    }
    let countdownLabel = "3";
    const raceStarted = { current: false };
    const matchOver = { current: false };
    let shownTime = 120;
    let lastSnapAt = 0;
    let playerPoints = 0;
    const rivalPoints = trucks.map(() => 0);
    const lastHitBy = trucks.map(() => -1);
    const lastHitAt = trucks.map(() => -10);
    const roundTotal = Math.min(5, Math.max(1, Math.round(rounds) || 1));
    let roundNow = 1;
    let activeSummary: MatchSnap["summary"] = null;
    let guestRound = 1;
    let guestSummaryKey = "";
    let shake = 0;
    const popups: { sprite: THREE.Sprite; life: number }[] = [];
    const audio = new AudioContext();
    audioRef.current = audio;

    function playCrash(strength: number) {
      if (audio.state === "suspended") void audio.resume();
      const now = audio.currentTime;
      const tone = audio.createOscillator();
      const toneGain = audio.createGain();
      tone.type = "sawtooth";
      tone.frequency.setValueAtTime(80 + strength * 12, now);
      tone.frequency.exponentialRampToValueAtTime(42, now + 0.12);
      toneGain.gain.setValueAtTime(Math.min(0.05 + strength * 0.008, 0.16), now);
      toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      tone.connect(toneGain);
      toneGain.connect(audio.destination);
      tone.start(now);
      tone.stop(now + 0.18);

      const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.07), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let sample = 0; sample < data.length; sample++) {
        data[sample] = (Math.random() * 2 - 1) * (1 - sample / data.length);
      }
      const noise = audio.createBufferSource();
      const noiseGain = audio.createGain();
      noise.buffer = buffer;
      noiseGain.gain.setValueAtTime(0.1, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      noise.connect(noiseGain);
      noiseGain.connect(audio.destination);
      noise.start(now);
    }

    function showPoints(x: number, y: number, z: number, points: number) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.font = "bold 80px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 10;
      context.strokeStyle = "#1c1400";
      context.fillStyle = "#facc15";
      context.strokeText(`+${points}`, 128, 64);
      context.fillText(`+${points}`, 128, 64);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(x, y + 2.4, z);
      sprite.scale.set(2.6, 1.3, 1);
      scene.add(sprite);
      popups.push({ sprite, life: 0.85 });
    }

    function stopOutward(index: number, nx: number, nz: number) {
      const knockAlongX = index === 0 ? playerKnockX : knockX[index];
      const knockAlongZ = index === 0 ? playerKnockZ : knockZ[index];
      const outward =
        (driveX[index] + knockAlongX + slopeX[index]) * nx +
        (driveZ[index] + knockAlongZ + slopeZ[index]) * nz;
      if (outward <= 0) return;

      const driveOut = driveX[index] * nx + driveZ[index] * nz;
      const takeDrive = Math.min(Math.max(driveOut, 0), outward);
      driveX[index] -= takeDrive * nx;
      driveZ[index] -= takeDrive * nz;
      const left = outward - takeDrive;
      if (left <= 0) return;
      if (index === 0) {
        playerKnockX -= left * nx;
        playerKnockZ -= left * nz;
        return;
      }
      knockX[index] -= left * nx;
      knockZ[index] -= left * nz;
    }

    function laneWorld(along: number, side: number, lane: number) {
      const c = Math.cos(lane);
      const s = Math.sin(lane);
      return {
        x: along * c - side * s,
        z: along * s + side * c,
      };
    }

    function containTruck(index: number) {
      const truck = trucks[index];
      let x = truck.position.x;
      let z = truck.position.z;

      for (const lane of laneAngles) {
        const { along, side } = laneLocal(x, z, lane);
        if (along < joinRadius - 0.15 || along > padOuter + 0.2) continue;
        const outward = side >= 0 ? 1 : -1;
        const nx = outward * -Math.sin(lane);
        const nz = outward * Math.cos(lane);
        const extent = outwardExtent(index, nx, nz);
        const wallInner = (along >= rampTopRadius ? padHalfWidth - 0.21 : padHalfWidth - 0.12) - extent;
        const past = Math.abs(side) - wallInner;
        if (past <= 0 || Math.abs(side) > padHalfWidth + extent + 0.45) continue;
        const next = laneWorld(along, outward * wallInner, lane);
        x = next.x;
        z = next.z;
        stopOutward(index, nx, nz);
      }

      const radius = Math.hypot(x, z);
      if (radius > 0.05) {
        const angle = Math.atan2(z, x);
        const rampGap = laneAngles.some((lane) => {
          const delta = Math.atan2(Math.sin(angle - lane), Math.cos(angle - lane));
          return Math.abs(delta) < 0.34;
        });
        const nx = x / radius;
        const nz = z / radius;
        const maxRim = Math.max(outerRadius - 0.2 - outwardExtent(index, nx, nz), innerRadius + 1);
        if (!rampGap && radius > maxRim && radius < outerRadius + 2.4) {
          x *= maxRim / radius;
          z *= maxRim / radius;
          stopOutward(index, nx, nz);
        }
      }

      truck.position.x = x;
      truck.position.z = z;
    }

    function clearOverlap() {
      for (let i = 0; i < trucks.length; i++) {
        if (falling[i] || (i > 0 && eliminated.current.has(i))) continue;
        for (let j = i + 1; j < trucks.length; j++) {
          if (falling[j] || eliminated.current.has(j)) continue;
          const hit = obbContact(i, j);
          if (!hit || hit.overlap < 0.02) continue;
          const shift = hit.overlap * 0.5;
          trucks[i].position.x -= hit.nx * shift;
          trucks[i].position.z -= hit.nz * shift;
          trucks[j].position.x += hit.nx * shift;
          trucks[j].position.z += hit.nz * shift;
        }
      }
    }

    function resetArena() {
      activeSummary = null;
      eliminated.current.clear();
      outOrder.length = 0;
      contactPairs.clear();
      pendingPoints.length = 0;
      countdownElapsed = 0;
      matchElapsed = 0;
      countdownLabel = "3";
      shownTime = 120;
      raceStarted.current = false;
      matchOver.current = false;
      playerSpeed = 0;
      playerKnockX = 0;
      playerKnockZ = 0;
      steerSmooth = 0;
      playerAngle = spawns[0].yaw;
      shake = 0;
      for (let i = 0; i < trucks.length; i++) {
        const truck = trucks[i];
        truck.visible = true;
        truck.position.set(spawns[i].x, spawns[i].y, spawns[i].z);
        heading[i] = spawns[i].yaw;
        remoteSpeed[i] = 0;
        remoteSteer[i] = 0;
        knockX[i] = 0;
        knockZ[i] = 0;
        driveX[i] = 0;
        driveZ[i] = 0;
        roll[i] = 0;
        rollVel[i] = 0;
        yawRate[i] = 0;
        leanTarget[i] = 0;
        tipped[i] = false;
        downFor[i] = 0;
        hop[i] = 0;
        weaponAnim[i] = 0;
        weaponOn[i] = false;
        health[i] = maxLife;
        pinnedTo[i] = -1;
        pinLeft[i] = 0;
        falling[i] = false;
        burnLeft[i] = 0;
        fallToHole[i] = false;
        deathHow[i] = "kanten";
        fallSpeed[i] = 0;
        slopeX[i] = 0;
        slopeZ[i] = 0;
        lastHitBy[i] = -1;
        lastHitAt[i] = -10;
        const wedge = truck.getObjectByName("wedge");
        if (wedge) wedge.rotation.x = 0.5;
        const plow = truck.getObjectByName("plow");
        if (plow) plow.rotation.x = 0.28;
        const spike = truck.getObjectByName("spike");
        if (spike) spike.position.z = 0;
        const axe = truck.getObjectByName("axe");
        if (axe) axe.rotation.x = -0.55;
        const blaze = truck.getObjectByName("blaze");
        if (blaze) blaze.visible = false;
      }
      if (timeLabelRef.current) timeLabelRef.current.textContent = "Tid: 2:00";
      if (pinLabelRef.current) pinLabelRef.current.textContent = "";
      paintLife(maxLife);
      paintRivals(health);
      refreshHole(innerRadius);
    }

    advanceRound.current = () => {
      if (!matchOver.current || roundNow >= roundTotal) return;
      roundNow += 1;
      resetArena();
      setRoundMark(roundNow);
      setRoundSummary(null);
      setPlayerOut(false);
      setOpponentsLeft(trucks.length - 1);
      setCountdown("3");
    };

    function animate(time = 0) {
      if (!running) return;

      animationFrame = requestAnimationFrame(animate);

      dt = Math.min((time - previousTime) / 1000 || 0, 0.04);
      previousTime = time;
      sampleGamepad();

      const link = onlineRef.current;
      if (link && !link.host) {
        const picture = link.snap.current;
        if (picture) {
          for (let i = 0; i < picture.trucks.length; i++) {
            const truck = trucks[i];
            const shot = picture.trucks[i];
            if (!truck || !shot) continue;
            truck.position.set(shot.x, shot.y, shot.z);
            truck.quaternion.set(shot.qx, shot.qy, shot.qz, shot.qw);
            truck.visible = shot.visible;
            weaponOn[i] = Boolean(shot.armed);
            poseWeapon(i);
            poseBlaze(truck, shot.hp <= 0 && shot.visible);
          }
          const mine = picture.trucks[link.seat];
          if (mine && scoreLabelRef.current) {
            scoreLabelRef.current.textContent = `Poäng: ${mine.score}`;
          }
          if (mine) paintLife(mine.hp);
          paintRivals(picture.trucks.map((shot) => shot.hp));
          if (timeLabelRef.current) {
            const left = Math.max(0, Math.ceil(picture.timeLeft));
            timeLabelRef.current.textContent = `Tid: ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
          }
          if (picture.banner !== countdownLabel) {
            countdownLabel = picture.banner;
            setCountdown(picture.banner);
          }
          const shownRound = picture.round ?? 1;
          if (shownRound !== guestRound) {
            guestRound = shownRound;
            setRoundMark(shownRound);
          }
          if (picture.summary) {
            const summaryKey = `${shownRound}:${picture.summary.more}:${picture.summary.standings.map((row) => row.points).join(",")}`;
            if (summaryKey !== guestSummaryKey) {
              guestSummaryKey = summaryKey;
              const mine = picture.trucks[link.seat]?.score ?? 0;
              let bestOther = 0;
              picture.trucks.forEach((shot, index) => {
                if (index !== link.seat) bestOther = Math.max(bestOther, shot.score);
              });
              const outcome: RoundOutcome =
                mine > bestOther ? "win" : mine < bestOther ? "loss" : "tie";
              setPlayerOut(false);
              setRoundSummary({
                outcome,
                standings: picture.summary.standings.map((row) => ({ ...row, teamColor: null })),
                fellOut: picture.summary.fellOut.map((row) => ({ ...row, teamColor: null })),
                round: shownRound,
                rounds: picture.rounds ?? roundTotal,
                more: picture.summary.more,
              });
            }
          } else if (guestSummaryKey) {
            guestSummaryKey = "";
            setRoundSummary(null);
            setPlayerOut(false);
          }
          if (picture.banner === "") raceStarted.current = true;
          matchElapsed = Math.max(0, 120 - picture.timeLeft);
          refreshHole(holeRadiusNow());
          const focus = trucks[link.seat] ?? trucks[0];
          const desiredCameraPosition = new THREE.Vector3(
            focus.position.x,
            focus.position.y + 25,
            focus.position.z + 28.1
          );
          camera.position.lerp(desiredCameraPosition, 0.04);
          camera.lookAt(focus.position.x, focus.position.y + 0.5, focus.position.z);
        }
        link.sendInput({
          f: keys.forward,
          b: keys.backward,
          l: keys.left,
          r: keys.right,
          x: weaponKey.current || weaponTouch.current || gamepadDrive.current.weapon,
        });
        renderer.render(scene, camera);
        return;
      }

      const player = trucks[0];

      function givePoints(index: number, points: number) {
        if (points <= 0) return;
        if (index === 0) {
          playerPoints += points;
          if (scoreLabelRef.current) {
            scoreLabelRef.current.textContent = `Poäng: ${playerPoints}`;
          }
          return;
        }
        rivalPoints[index] += points;
      }

      function publishResults(outcome: RoundOutcome) {
        const standings = players.map((person, index) => ({
          name: person.name,
          color: person.color,
          teamColor: mode === "teams" ? teams[teamOf(person.id)].color : null,
          points: index === 0 ? playerPoints : rivalPoints[index],
        }));
        standings.sort((a, b) => b.points - a.points);

        const fellOut = outOrder.map((index) => ({
          name: players[index].name,
          color: players[index].color,
          teamColor: mode === "teams" ? teams[teamOf(players[index].id)].color : null,
          how: deathHow[index],
        }));

        setScore(playerPoints);
        const more = roundNow < roundTotal;
        activeSummary = {
          standings: standings.map(({ name, color, points }) => ({ name, color, points })),
          fellOut: fellOut.map(({ name, color, how }) => ({ name, color, how })),
          more,
        };
        setRoundSummary({ outcome, standings, fellOut, round: roundNow, rounds: roundTotal, more });
      }

      function finishByScore() {
        if (matchOver.current) return;
        matchOver.current = true;
        let best = 0;
        for (let rival = 1; rival < trucks.length; rival++) {
          best = Math.max(best, rivalPoints[rival]);
        }
        const outcome: RoundOutcome =
          playerPoints > best ? "win" : playerPoints < best ? "loss" : "tie";
        publishResults(outcome);
      }

      function knockOut(index: number, intoHole: boolean, pushed = false) {
        if (falling[index]) return;
        falling[index] = true;
        fallToHole[index] = intoHole;
        deathHow[index] = intoHole ? "hålet" : "kanten";
        outOrder.push(index);

        if (pushed) {
          const attacker = lastHitBy[index];
          const fresh = matchElapsed - lastHitAt[index] <= 4;
          if (attacker >= 0 && attacker !== index && fresh) {
            givePoints(attacker, 50);
            const truck = trucks[attacker];
            showPoints(truck.position.x, truck.position.y, truck.position.z, 50);
          }
        }

        if (index === 0) {
          setPlayerOut(true);
          return;
        }

        if (eliminated.current.has(index)) return;
        eliminated.current.add(index);
        setOpponentsLeft((count) => count - 1);

        if (eliminated.current.size >= trucks.length - 1 && !falling[0]) {
          finishByScore();
        }
      }

      function wreckFromHealth(index: number) {
        if (health[index] > 0 || falling[index]) return;
        burnLeft[index] = 1.5;
        knockOut(index, false);
        deathHow[index] = "livet";
        poseBlaze(trucks[index], true);
      }

      if (!matchOver.current && !raceStarted.current) {
        countdownElapsed += dt;
        let label = "3";
        if (countdownElapsed >= 1) label = "2";
        if (countdownElapsed >= 2) label = "1";
        if (countdownElapsed >= 3) {
          label = "KÖR";
          raceStarted.current = true;
        }
        if (label !== countdownLabel) {
          countdownLabel = label;
          setCountdown(label);
        }
      } else if (!matchOver.current) {
        matchElapsed += dt;
        if (countdownLabel === "KÖR" && matchElapsed >= 0.7) {
          countdownLabel = "";
          setCountdown("");
        }

        const left = Math.max(0, 120 - matchElapsed);
        const shown = Math.ceil(left);
        if (shown !== shownTime) {
          shownTime = shown;
          const minutes = Math.floor(shown / 60);
          const seconds = String(shown % 60).padStart(2, "0");
          if (timeLabelRef.current) {
            timeLabelRef.current.textContent = `Tid: ${minutes}:${seconds}`;
          }
        }

        if (falling[0]) {
          let alive = 0;
          for (let rival = 1; rival < trucks.length; rival++) {
            if (!eliminated.current.has(rival) && !falling[rival]) alive++;
          }
          if (alive <= 1) finishByScore();
        }

        if (left <= 0) finishByScore();
      }

      function updateSlope(index: number) {
        if (falling[index]) return;

        const truck = trucks[index];
        const radius = Math.hypot(truck.position.x, truck.position.z);

        if (radius < innerRadius + 0.05 || radius > outerRadius) {
          slopeX[index] *= Math.pow(0.9, dt * 60);
          slopeZ[index] *= Math.pow(0.9, dt * 60);
          return;
        }

        const grade =
          (7.02 * 1.7 * Math.pow(radius / outerRadius, 0.7)) / outerRadius;
        const accel = 3 * (grade / Math.hypot(1, grade));
        slopeX[index] -= (truck.position.x / radius) * accel * dt;
        slopeZ[index] -= (truck.position.z / radius) * accel * dt;

        const slide = Math.hypot(slopeX[index], slopeZ[index]);
        const maxSlide = 1.8;
        if (slide > maxSlide) {
          slopeX[index] *= maxSlide / slide;
          slopeZ[index] *= maxSlide / slide;
        }
      }

      // AI for every opponent
      let leaderIndex = -1;
      let leaderScore = 0;
      let shareLead = 0;
      for (let n = 0; n < trucks.length; n++) {
        if (falling[n] || (n > 0 && eliminated.current.has(n))) continue;
        const points = n === 0 ? playerPoints : rivalPoints[n];
        if (points > leaderScore) {
          leaderScore = points;
          leaderIndex = n;
          shareLead = 1;
        } else if (points === leaderScore) {
          shareLead += 1;
        }
      }
      if (leaderScore <= 0 || shareLead !== 1) leaderIndex = -1;

      for (let i = 1; i < trucks.length; i++) {
        const opponent = trucks[i];

        // Skip opponents that have already been eliminated
        if (eliminated.current.has(i)) {
          continue;
        }

        if (!raceStarted.current) {
          opponent.position.set(spawns[i].x, spawns[i].y, spawns[i].z);
          heading[i] = spawns[i].yaw;
          continue;
        }

        if (matchOver.current) continue;

        const remotePad = onlineRef.current?.humans[i]
          ? onlineRef.current.inputs.current[i] ?? { f: false, b: false, l: false, r: false, x: false }
          : null;
        if (remotePad) {
          weaponOn[i] = remotePad.x;
          if (pinnedTo[i] >= 0) {
            remoteSpeed[i] = 0;
            remoteSteer[i] = 0;
          }
          if (!falling[i] && remotePad.f) remoteSpeed[i] += 12 * drivePace * dt;
          if (!falling[i] && remotePad.b) remoteSpeed[i] -= 12 * drivePace * dt;
          remoteSpeed[i] *= Math.pow(0.993, dt * 60);
          remoteSpeed[i] = THREE.MathUtils.clamp(
            remoteSpeed[i],
            tipped[i] ? -2 * drivePace : -6 * drivePace,
            tipped[i] ? 3 * drivePace : 13 * drivePace
          );
          const wantedSteer = (remotePad.l ? 1 : 0) - (remotePad.r ? 1 : 0);
          remoteSteer[i] += (wantedSteer - remoteSteer[i]) * Math.min(1, 22 * dt);
          if (!falling[i]) {
            stepChassis(i, remoteSpeed[i], remoteSteer[i], 16);
            updateSlope(i);
            opponent.position.x += (driveX[i] + knockX[i] + slopeX[i]) * dt;
            opponent.position.z += (driveZ[i] + knockZ[i] + slopeZ[i]) * dt;
          }
          knockX[i] *= Math.pow(0.86, dt * 60);
          knockZ[i] *= Math.pow(0.86, dt * 60);
          const stand = supportHeight(opponent.position.x, opponent.position.z);
          if (stand !== null) opponent.position.y = stand + 0.12;
          continue;
        }

        const radiusNow = Math.hypot(opponent.position.x, opponent.position.z);
        const dangerRadius = 8.2;
        const holdRadius = 13.2;
        let targetX = 0;
        let targetZ = 0;
        let attacking = false;
        let strikeGap = Infinity;

        if (radiusNow > joinRadius + 1) {
          const lane = laneAngles[i];
          targetX = Math.cos(lane) * holdRadius;
          targetZ = Math.sin(lane) * holdRadius;
        } else if (radiusNow < dangerRadius) {
          const outward = Math.max(radiusNow, 0.4);
          targetX = (opponent.position.x / outward) * (dangerRadius + 5);
          targetZ = (opponent.position.z / outward) * (dangerRadius + 5);
        } else {
          let prey = -1;
          let preyDistance = Infinity;

          for (let other = 0; other < trucks.length; other++) {
            if (other === i || falling[other] || eliminated.current.has(other)) continue;
            const gap = Math.hypot(
              trucks[other].position.x - opponent.position.x,
              trucks[other].position.z - opponent.position.z
            );
            let weighted = other === 0 ? gap * 0.72 : gap;
            if (other === leaderIndex) weighted *= 0.45;
            if (weighted < preyDistance) {
              preyDistance = weighted;
              prey = other;
              strikeGap = gap;
            }
          }

          if (prey >= 0 && preyDistance < 15) {
            attacking = true;
            const preyTruck = trucks[prey];
            const flank = i % 2 === 0 ? 1 : -1;
            const preyYaw = heading[prey];
            targetX = preyTruck.position.x + Math.cos(preyYaw) * flank * 2.4;
            targetZ = preyTruck.position.z - Math.sin(preyYaw) * flank * 2.4;
            const aimRadius = Math.hypot(targetX, targetZ) || 1;
            if (aimRadius < dangerRadius) {
              targetX *= dangerRadius / aimRadius;
              targetZ *= dangerRadius / aimRadius;
            }
          } else {
            const cruiseAngle = performance.now() * 0.00022 + i * 2.1;
            targetX = Math.cos(cruiseAngle) * holdRadius;
            targetZ = Math.sin(cruiseAngle) * holdRadius;
          }
        }

        if (radiusNow < joinRadius + 1) {
          const aimRadius = Math.hypot(targetX, targetZ) || 1;
          const bowlLimit = outerRadius - 2.4;
          if (aimRadius > bowlLimit) {
            targetX *= bowlLimit / aimRadius;
            targetZ *= bowlLimit / aimRadius;
          }
        }

        const dx = targetX - opponent.position.x;
        const dz = targetZ - opponent.position.z;
        const cruise = (tipped[i]
          ? 2.4
          : radiusNow > joinRadius + 1 || radiusNow < dangerRadius
            ? 8
            : attacking
              ? 7.2
              : 5.4) * drivePace;
        const desired = Math.atan2(dx, dz);
        const error = Math.atan2(
          Math.sin(desired - heading[i]),
          Math.cos(desired - heading[i])
        );
        const steerInput = THREE.MathUtils.clamp(error / 0.4, -1, 1);
        stepChassis(i, cruise, steerInput, 16);

        updateSlope(i);
        opponent.position.x += (driveX[i] + knockX[i] + slopeX[i]) * dt;
        opponent.position.z += (driveZ[i] + knockZ[i] + slopeZ[i]) * dt;
        knockX[i] *= Math.pow(0.86, dt * 60);
        knockZ[i] *= Math.pow(0.86, dt * 60);

        const stand = supportHeight(opponent.position.x, opponent.position.z);
        if (stand !== null) opponent.position.y = stand + 0.12;
        weaponOn[i] = attacking && strikeGap < 4.2;
      }

      let focusX = player.position.x;
      let focusY = player.position.y;
      let focusZ = player.position.z;

      if (falling[0] && !(deathHow[0] === "livet" && burnLeft[0] > 0)) {
        let watching = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (let i = 1; i < trucks.length; i++) {
          if (falling[i] || eliminated.current.has(i)) continue;
          sumX += trucks[i].position.x;
          sumY += trucks[i].position.y;
          sumZ += trucks[i].position.z;
          watching++;
        }
        if (watching > 0) {
          focusX = sumX / watching;
          focusY = sumY / watching;
          focusZ = sumZ / watching;
        } else {
          focusX = 0;
          focusY = 0;
          focusZ = 0;
        }
      }

      const desiredCameraPosition = new THREE.Vector3(
        focusX + cameraOffset.x,
        focusY + cameraOffset.y,
        focusZ + cameraOffset.z
      );
      if (shake > 0.01) {
        desiredCameraPosition.x += (Math.random() - 0.5) * shake;
        desiredCameraPosition.y += (Math.random() - 0.5) * shake * 0.45;
        desiredCameraPosition.z += (Math.random() - 0.5) * shake;
        shake *= Math.pow(0.84, dt * 60);
      }
      camera.position.lerp(desiredCameraPosition, 0.04);

      camera.lookAt(focusX, focusY + 0.5, focusZ);

      if (!raceStarted.current) {
        player.position.set(spawns[0].x, spawns[0].y, spawns[0].z);
        playerAngle = spawns[0].yaw;
        heading[0] = playerAngle;
        playerSpeed = 0;
      } else if (!matchOver.current) {
      if (pinnedTo[0] >= 0) {
        playerSpeed = 0;
        steerSmooth = 0;
      }
      if (!falling[0] && keys.forward) playerSpeed += 12 * drivePace * dt;
      if (!falling[0] && keys.backward) playerSpeed -= 12 * drivePace * dt;

      playerSpeed *= Math.pow(0.993, dt * 60);
      playerSpeed = THREE.MathUtils.clamp(
        playerSpeed,
        tipped[0] ? -2 * drivePace : -6 * drivePace,
        tipped[0] ? 3 * drivePace : 13 * drivePace
      );

      const wantedSteer =
        Math.abs(gamepadDrive.current.steer) > 0.05
          ? gamepadDrive.current.steer
          : (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
      steerSmooth += (wantedSteer - steerSmooth) * Math.min(1, 22 * dt);

      if (!falling[0]) {
        stepChassis(0, playerSpeed, steerSmooth, 16);
        updateSlope(0);
        player.position.x += (driveX[0] + playerKnockX + slopeX[0]) * dt;
        player.position.z += (driveZ[0] + playerKnockZ + slopeZ[0]) * dt;
      }
      playerKnockX *= Math.pow(0.86, dt * 60);
      playerKnockZ *= Math.pow(0.86, dt * 60);

      if (!falling[0]) {
        const stand = supportHeight(player.position.x, player.position.z);
        if (stand !== null) player.position.y = stand + 0.12;
      }
      }

      weaponOn[0] =
        weaponKey.current || weaponTouch.current || gamepadDrive.current.weapon;

      if (raceStarted.current && !matchOver.current) {
      // Truck collisions. Boxes follow the trucks, so a flank hit tips
      // and a nose hit mostly shoves. The truck with more speed and balance
      // pushes the other along its direction of travel. The shove and the
      // tip are applied once per crash, then again only after they separate.
      const touching = new Set<string>();

      for (let i = 0; i < trucks.length; i++) {
        if (falling[i] || (i > 0 && eliminated.current.has(i))) continue;

        for (let j = i + 1; j < trucks.length; j++) {
          if (falling[j] || eliminated.current.has(j)) continue;

          const hit = obbContact(i, j);
          if (!hit) continue;

          const id = `${i}-${j}`;
          touching.add(id);

          const a = trucks[i];
          const b = trucks[j];
          const { overlap, nx, nz } = hit;
          const aVel = truckVelocity(i);
          const bVel = truckVelocity(j);
          const aPower = truckPower(
            a.position.x,
            a.position.z,
            heading[i],
            aVel.x,
            aVel.z
          );
          const bPower = truckPower(
            b.position.x,
            b.position.z,
            heading[j],
            bVel.x,
            bVel.z
          );

          const advantage = aPower.power - bPower.power;
          const aShare = advantage >= 0 ? 0.22 : 0.78;
          const correct = overlap;
          if (correct > 0.012) {
            a.position.x -= nx * correct * aShare;
            a.position.z -= nz * correct * aShare;
            b.position.x += nx * correct * (1 - aShare);
            b.position.z += nz * correct * (1 - aShare);
          }

          if (!contactPairs.has(id)) {
            contactPairs.add(id);

            const closing = Math.max(
              0,
              -((bVel.x - aVel.x) * nx + (bVel.z - aVel.z) * nz)
            );
            const winner = advantage >= 0 ? i : j;
            const loser = advantage >= 0 ? j : i;
            const winVel = winner === i ? aVel : bVel;
            const winSpeed = Math.hypot(winVel.x, winVel.z);
            const outX = winner === i ? nx : -nx;
            const outZ = winner === i ? nz : -nz;

            let travelX = outX;
            let travelZ = outZ;
            if (winSpeed > 0.35) {
              travelX = winVel.x / winSpeed;
              travelZ = winVel.z / winSpeed;
            }

            let dirX = travelX * 0.7 + outX * 0.3;
            let dirZ = travelZ * 0.7 + outZ * 0.3;
            const dirLen = Math.hypot(dirX, dirZ) || 1;
            dirX /= dirLen;
            dirZ /= dirLen;

            const force = Math.min(
              closing * 1.15 + Math.abs(advantage) * 0.7,
              14
            );
            addKnock(loser, dirX * force, dirZ * force);
            addKnock(winner, -dirX * force * 0.16, -dirZ * force * 0.16);
            lastHitBy[loser] = winner;
            lastHitAt[loser] = matchElapsed;

            if (winner === 0 || loser === 0) {
              shake = Math.min(0.9, Math.max(shake, force * 0.05));
              playCrash(force);
            }

            if (loser === 0) playerSpeed *= 0.55;
            if (winner === 0) playerSpeed *= 0.9;

            const ontoX = loser === j ? nx : -nx;
            const ontoZ = loser === j ? nz : -nz;
            const loserRot = heading[loser];
            const sideHit =
              ontoX * Math.cos(loserRot) + ontoZ * -Math.sin(loserRot);
            const frontHit =
              ontoX * Math.sin(loserRot) + ontoZ * Math.cos(loserRot);
            const square = Math.abs(sideHit);
            const frontal = Math.abs(frontHit);
            const flank = square > 0.8 && frontal < 0.45;

            if (flank) {
              const loserBalance = loser === i ? aPower.balance : bPower.balance;
              const unstable = THREE.MathUtils.clamp(
                1.25 - loserBalance,
                0.35,
                1
              );
              let tip =
                square * Math.max(closing - 2.5, 0) * 1.15 * unstable;

              if (tipped[winner]) tip += 2.2 * square;

              const hard =
                closing > 7.5 && (loserBalance < 0.55 || closing > 10);
              const sign = Math.sign(sideHit || 1);

              if (hard) {
                addTip(loser, sign * Math.min(Math.max(tip, 7.6), 9));
              } else if (tip > 1.2) {
                addTip(loser, sign * Math.min(tip, 4.4));
              }
            }

            useWeapon(i, j, nx, nz, closing);
            useWeapon(j, i, -nx, -nz, closing);
            if (health[i] <= 0) wreckFromHealth(i);
            if (health[j] <= 0) wreckFromHealth(j);
          }

          const aHeight = supportHeight(a.position.x, a.position.z);
          const bHeight = supportHeight(b.position.x, b.position.z);
          if (aHeight !== null) a.position.y = aHeight + 0.12;
          if (bHeight !== null) b.position.y = bHeight + 0.12;
        }
      }

      for (const id of contactPairs) {
        if (!touching.has(id)) contactPairs.delete(id);
      }

      for (let victim = 0; victim < trucks.length; victim++) {
        const holder = pinnedTo[victim];
        if (holder < 0) continue;
        pinLeft[victim] -= dt;
        const lost =
          pinLeft[victim] <= 0 ||
          falling[victim] ||
          falling[holder] ||
          eliminated.current.has(victim) ||
          eliminated.current.has(holder);
        if (lost) {
          pinnedTo[victim] = -1;
          pinLeft[victim] = 0;
          continue;
        }
        const fx = Math.sin(heading[holder]);
        const fz = Math.cos(heading[holder]);
        trucks[victim].position.x = trucks[holder].position.x + fx * 2.05;
        trucks[victim].position.z = trucks[holder].position.z + fz * 2.05;
        driveX[victim] = 0;
        driveZ[victim] = 0;
        if (victim === 0) {
          playerSpeed = 0;
          playerKnockX = 0;
          playerKnockZ = 0;
        } else {
          knockX[victim] = 0;
          knockZ[victim] = 0;
        }
      }
      if (pinLabelRef.current) {
        pinLabelRef.current.textContent =
          pinnedTo[0] >= 0 ? "Fast i yxan" : pinnedTo.some((holder) => holder === 0) ? "Yxan sitter fast" : "";
      }

      for (const gain of pendingPoints) {
        givePoints(gain.attacker, gain.points);
        lastHitBy[gain.victim] = gain.attacker;
        lastHitAt[gain.victim] = matchElapsed;
        const truck = trucks[gain.attacker];
        showPoints(truck.position.x, truck.position.y, truck.position.z, gain.points);
      }
      pendingPoints.length = 0;

      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < trucks.length; i++) {
          if (falling[i] || (i > 0 && eliminated.current.has(i))) continue;
          containTruck(i);
        }
        clearOverlap();
      }
      for (let i = 0; i < trucks.length; i++) {
        if (falling[i] || (i > 0 && eliminated.current.has(i))) continue;
        containTruck(i);
      }

      for (let i = 0; i < trucks.length; i++) {
        if (falling[i] || (i > 0 && eliminated.current.has(i))) continue;
        const holeDistance = Math.hypot(trucks[i].position.x, trucks[i].position.z);
        if (holeDistance < holeRadiusNow()) {
          knockOut(i, true, true);
        } else if (supportHeight(trucks[i].position.x, trucks[i].position.z) === null) {
          knockOut(i, false, true);
        }
      }
      }

      settleRoll(0, tipped[0] && keys.forward && raceStarted.current ? 1 : 0);

      for (let i = 1; i < trucks.length; i++) {
        settleRoll(i, tipped[i] ? 0.28 : 0);
      }

      if (leaderIndex >= 0) {
        const leader = trucks[leaderIndex];
        const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.06;
        leaderRing.visible = true;
        leaderRing.position.set(leader.position.x, leader.position.y + 0.18, leader.position.z);
        leaderRing.scale.set(pulse, pulse, pulse);
        leaderLight.position.set(leader.position.x, leader.position.y + 1.4, leader.position.z);
        leaderLight.intensity = 18;
      } else {
        leaderRing.visible = false;
        leaderLight.intensity = 0;
      }

      const openHole = holeRadiusNow();
      refreshHole(openHole);
      const blinkEvery = raceStarted.current && matchElapsed >= 90 ? 5000 : 10000;
      const dangerFlash = performance.now() % blinkEvery < 700;
      const dangerBlink = dangerFlash ? 0.95 : 0.34;
      holeGlow.intensity = dangerFlash ? 70 : 16;
      for (const material of dangerPulse) {
        material.opacity = dangerBlink;
      }

      for (let i = popups.length - 1; i >= 0; i--) {
        const popup = popups[i];
        popup.life -= dt;
        popup.sprite.position.y += dt * 1.6;
        const material = popup.sprite.material;
        material.opacity = Math.max(popup.life / 0.85, 0);
        if (popup.life <= 0) {
          scene.remove(popup.sprite);
          material.map?.dispose();
          material.dispose();
          popups.splice(i, 1);
        }
      }

      const publisher = onlineRef.current;
      if (publisher?.host && performance.now() - lastSnapAt > 50) {
        lastSnapAt = performance.now();
        publisher.publish({
          timeLeft: Math.max(0, 120 - matchElapsed),
          banner: countdownLabel,
          round: roundNow,
          rounds: roundTotal,
          summary: activeSummary,
          trucks: trucks.map((truck, index) => ({
            x: truck.position.x,
            y: truck.position.y,
            z: truck.position.z,
            qx: truck.quaternion.x,
            qy: truck.quaternion.y,
            qz: truck.quaternion.z,
            qw: truck.quaternion.w,
            visible: truck.visible,
            score: index === 0 ? playerPoints : rivalPoints[index],
            out: falling[index] || eliminated.current.has(index),
            hp: health[index],
            armed: weaponOn[index],
          })),
        });
      }

      renderer.render(scene, camera);
    }

    animate();

    window.addEventListener("resize", resizeRenderer);
    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(mount);

    return () => {
      running = false;
      advanceRound.current = null;
      cancelAnimationFrame(animationFrame);
      audioRef.current = null;
      for (const texture of standTextures) texture.dispose();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeRenderer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);

      scene.traverse((object) => {
        if (object instanceof THREE.Sprite) {
          const material = object.material;
          material.map?.dispose();
          material.dispose();
        }
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();

          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];

          materials.forEach((material) => material.dispose());
        }
      });

      renderer.dispose();
      void audio.close();
      renderer.domElement.remove();
    };
  }, [mode, players]);

  function restart() {
    onExit();
  }

  function holdDrive(control: "forward" | "backward" | "left" | "right", down: boolean) {
    touchDown.current[control] = down;
    setHeld((current) => ({ ...current, [control]: down }));
    if (down && audioRef.current?.state === "suspended") void audioRef.current.resume();
  }

  function holdWeapon(down: boolean) {
    weaponTouch.current = down;
    setHeld((current) => ({ ...current, weapon: down }));
    if (down && audioRef.current?.state === "suspended") void audioRef.current.resume();
  }

  const roundTotal = Math.min(5, Math.max(1, Math.round(rounds) || 1));
  const canAdvance = !online || online.host;

  return (
    <div
      style={{
        width: "100%",
        height: "100svh",
        position: "relative",
        overflow: "hidden",
        background: "#111820",
        touchAction: "none",
      }}
    >
      <div
        ref={mountRef}
        style={{
          position: "absolute",
          inset: 0,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          left: "max(12px, env(safe-area-inset-left))",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 14, letterSpacing: 1, color: "#cbd5e1" }}>
          FUNNEL CRASH
        </div>
        {roundTotal > 1 && (
          <div style={{ fontSize: 16, marginTop: 4 }}>
            Runda {roundMark}/{roundTotal}
          </div>
        )}
        <div ref={scoreLabelRef} style={{ fontSize: "clamp(22px, 6vw, 28px)", fontWeight: 700, color: "#facc15" }}>
          Poäng: {score}
        </div>
        <div style={{ fontSize: 16, marginTop: 4 }}>
          Motståndare kvar: {opponentsLeft}
        </div>
        <div ref={timeLabelRef} style={{ fontSize: 16, marginTop: 4 }}>
          Tid: {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
        </div>
        <div ref={lifeLabelRef} style={{ fontSize: 16, marginTop: 4 }}>
          Liv: {maxLife}
        </div>
        <div
          style={{
            marginTop: 6,
            width: 120,
            height: 8,
            borderRadius: 99,
            background: "#1e293b",
            overflow: "hidden",
          }}
        >
          <div ref={lifeFillRef} style={{ width: "100%", height: "100%", background: "#4ade80" }} />
        </div>
        <div style={{ fontSize: 13, marginTop: 4, color: "#cbd5e1" }}>Håll in X</div>
        <div ref={pinLabelRef} style={{ fontSize: 16, marginTop: 6, fontWeight: 800, color: "#f8fafc" }} />
      </div>
      <div
        style={{
          position: "absolute",
          top: touchDrive
            ? "max(64px, calc(env(safe-area-inset-top) + 54px))"
            : "max(12px, env(safe-area-inset-top))",
          right: "max(12px, env(safe-area-inset-right))",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        {players.map((person, index) =>
          index === (online?.seat ?? 0) ? null : (
            <div key={person.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: 156, fontSize: 14 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: person.color,
                    flex: "0 0 auto",
                  }}
                />
                <div
                  style={{
                    fontWeight: 700,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {person.name}
                </div>
                <div
                  ref={(node) => {
                    rivalLabelRefs.current[index] = node;
                  }}
                  style={{ marginLeft: "auto", fontWeight: 800 }}
                >
                  {maxLife}
                </div>
              </div>
              <div
                style={{
                  marginTop: 3,
                  width: 156,
                  height: 7,
                  borderRadius: 99,
                  background: "#1e293b",
                  overflow: "hidden",
                }}
              >
                <div
                  ref={(node) => {
                    rivalFillRefs.current[index] = node;
                  }}
                  style={{ width: "100%", height: "100%", background: "#4ade80" }}
                />
              </div>
            </div>
          )
        )}
      </div>
      {playerOut && !roundSummary && (
        <div
          style={{
            position: "absolute",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            color: "#ffffff",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>Åskådare</div>
          <button
            onClick={restart}
            style={{
              marginTop: 8,
              padding: "8px 14px",
              fontSize: 15,
              fontWeight: 700,
              border: "none",
              borderRadius: 8,
              background: "#facc15",
              cursor: "pointer",
            }}
          >
            Till lobbyn
          </button>
        </div>
      )}
      {countdown && !playerOut && !roundSummary && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            color: "#ffffff",
            fontFamily: "system-ui, sans-serif",
            fontSize: "clamp(56px, 18vw, 96px)",
            fontWeight: 800,
            letterSpacing: 2,
          }}
        >
          {countdown}
        </div>
      )}
      {touchDrive && !roundSummary && (
        <div
          style={{
            position: "absolute",
            left: "max(16px, env(safe-area-inset-left))",
            right: "max(16px, env(safe-area-inset-right))",
            bottom: "max(16px, env(safe-area-inset-bottom))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
            <DriveButton label="◀" pressed={held.left} onHold={(down) => holdDrive("left", down)} />
            <DriveButton label="▶" pressed={held.right} onHold={(down) => holdDrive("right", down)} />
          </div>
          <div style={{ pointerEvents: "auto" }}>
            <DriveButton label="X" pressed={held.weapon} onHold={holdWeapon} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, pointerEvents: "auto" }}>
            <DriveButton label="▲" pressed={held.forward} onHold={(down) => holdDrive("forward", down)} />
            <DriveButton label="▼" pressed={held.backward} onHold={(down) => holdDrive("backward", down)} />
          </div>
        </div>
      )}
      {roundSummary && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(8, 12, 16, 0.72)",
            padding: 24,
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              maxHeight: "100%",
              overflow: "auto",
              boxSizing: "border-box",
              background: "#18222b",
              border: "1px solid #2a3846",
              borderRadius: 16,
              padding: "22px 22px 18px",
              color: "#ffffff",
              fontFamily: "system-ui, sans-serif",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 13, letterSpacing: 1.5, color: "#cbd5e1" }}>
              FUNNEL CRASH
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, marginTop: 4 }}>
              {roundSummary.rounds > 1
                ? roundSummary.more
                  ? `Runda ${roundSummary.round} av ${roundSummary.rounds}`
                  : "Matchen är klar"
                : "Rundan är klar"}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 18,
                fontWeight: 800,
                color:
                  roundSummary.outcome === "win"
                    ? "#facc15"
                    : roundSummary.outcome === "tie"
                      ? "#e2e8f0"
                      : "#f87171",
              }}
            >
              {roundSummary.more
                ? roundSummary.outcome === "win"
                  ? "Du leder"
                  : roundSummary.outcome === "loss"
                    ? "Du är efter"
                    : "Lika"
                : roundSummary.outcome === "win"
                  ? "Du vann"
                  : roundSummary.outcome === "loss"
                    ? "Du förlorade"
                    : "Oavgjort"}
            </div>

            <div
              style={{
                marginTop: 18,
                fontSize: 13,
                letterSpacing: 1,
                color: "#94a3b8",
                fontWeight: 700,
              }}
            >
              {roundSummary.rounds > 1 ? "TOTALT" : "POÄNG"}
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {roundSummary.standings.map((row, index) => (
                <div
                  key={row.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "#111820",
                  }}
                >
                  <div style={{ width: 22, fontWeight: 800, color: "#cbd5e1" }}>
                    {index + 1}
                  </div>
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: row.teamColor ?? row.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "0 0 auto",
                    }}
                  >
                    {row.teamColor && (
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: row.color,
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, fontWeight: 700 }}>{row.name}</div>
                  <div style={{ fontWeight: 800, color: "#facc15" }}>{row.points}</div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 18,
                fontSize: 13,
                letterSpacing: 1,
                color: "#94a3b8",
                fontWeight: 700,
              }}
            >
              ÅKTE UR
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {roundSummary.fellOut.length === 0 ? (
                <div style={{ color: "#cbd5e1", fontSize: 15 }}>Ingen åkte ur.</div>
              ) : (
                roundSummary.fellOut.map((row) => (
                  <div
                    key={`${row.name}-${row.how}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#111820",
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        background: row.teamColor ?? row.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "0 0 auto",
                      }}
                    >
                      {row.teamColor && (
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: row.color,
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: 1, fontWeight: 700 }}>{row.name}</div>
                    <div style={{ color: "#f87171", fontWeight: 700 }}>
                      {row.how === "hålet" ? "Hålet" : row.how === "livet" ? "Inget liv" : "Kanten"}
                    </div>
                  </div>
                ))
              )}
            </div>

            {roundSummary.more && canAdvance && (
              <button
                onClick={() => advanceRound.current?.()}
                style={{
                  marginTop: 18,
                  width: "100%",
                  padding: "12px 22px",
                  fontSize: 18,
                  fontWeight: 800,
                  border: "none",
                  borderRadius: 10,
                  background: "#facc15",
                  color: "#111820",
                  cursor: "pointer",
                }}
              >
                Nästa runda
              </button>
            )}
            {roundSummary.more && !canAdvance && (
              <div style={{ marginTop: 18, color: "#cbd5e1", fontWeight: 700 }}>
                Väntar på nästa runda
              </div>
            )}
            <button
              onClick={restart}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "12px 22px",
                fontSize: 18,
                fontWeight: 800,
                border: "none",
                borderRadius: 10,
                background: roundSummary.more ? "transparent" : "#facc15",
                color: roundSummary.more ? "#94a3b8" : "#111820",
                cursor: "pointer",
              }}
            >
              Till lobbyn
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DriveButton({
  label,
  pressed,
  onHold,
}: {
  label: string;
  pressed: boolean;
  onHold: (down: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      style={{
        width: 78,
        height: 78,
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.35)",
        background: pressed ? "rgba(250, 204, 21, 0.92)" : "rgba(17, 24, 32, 0.62)",
        color: pressed ? "#111820" : "#f8fafc",
        fontSize: 30,
        fontWeight: 800,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {label}
    </button>
  );
}
