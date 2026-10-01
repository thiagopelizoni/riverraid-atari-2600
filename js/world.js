window.RR = window.RR || {};

window.RR.World = (function () {
  'use strict';

  const LENGTH = 700;
  const DIMENSIONS = {
    tanker: [16, 8], helicopter: [8, 10], fuel: [7, 24], jet: [16, 8], bridge: [32, 22],
  };

  // Half-widths are authored at landmarks, then quantized to four Atari pixels.
  // Mirrored banks and central islands reproduce the reflected 2600 playfield.
  const COURSES = [
    {
      banks: [[0, 16], [44, 16], [66, 36], [172, 36], [252, 52], [340, 52], [412, 48], [508, 40], [570, 36], [640, 16], [700, 16]],
      islands: [[360, 504, 12]],
    },
    {
      banks: [[0, 16], [48, 16], [136, 56], [216, 64], [368, 56], [432, 64], [528, 40], [644, 16], [700, 16]],
      islands: [[144, 508, 32]],
    },
    {
      banks: [[0, 16], [44, 16], [116, 40], [216, 52], [300, 52], [376, 36], [464, 44], [544, 44], [640, 16], [700, 16]],
      islands: [[184, 324, 24], [400, 536, 20]],
    },
    {
      banks: [[0, 16], [48, 16], [144, 48], [228, 56], [320, 64], [412, 56], [504, 36], [584, 32], [640, 16], [700, 16]],
      islands: [[172, 484, 32]],
    },
    {
      banks: [[0, 16], [48, 16], [144, 40], [232, 48], [320, 36], [408, 52], [492, 48], [568, 36], [640, 16], [700, 16]],
      islands: [[180, 284, 20], [368, 532, 24]],
    },
  ];

  function randomFor(seed, section, salt) {
    let n = (seed ^ Math.imul(section + 1, 0x9E3779B9) ^ Math.imul(salt + 1, 0x85EBCA6B)) >>> 0;
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    return (n >>> 0) / 4294967296;
  }

  function sectionAt(distance) { return Math.max(0, Math.floor(distance / LENGTH)); }

  function interpolate(knots, distance) {
    for (let i = 1; i < knots.length; i++) {
      if (distance <= knots[i][0]) {
        const previous = knots[i - 1], next = knots[i];
        const fraction = Math.max(0, (distance - previous[0]) / (next[0] - previous[0]));
        return previous[1] + (next[1] - previous[1]) * fraction;
      }
    }
    return knots[knots.length - 1][1];
  }

  function create(seed) {
    seed = Number.isFinite(seed) ? seed >>> 0 : 1982;
    const entities = [];
    const decorations = [];
    const generated = new Set();
    const cache = new Map();

    function course(section) {
      if (!cache.has(section)) {
        const index = section < COURSES.length ? section : 1 + Math.floor(randomFor(seed, section, 0) * (COURSES.length - 1));
        cache.set(section, COURSES[index]);
      }
      return cache.get(section);
    }

    function banks(distance) {
      const section = sectionAt(distance);
      const offset = Math.max(0, distance - section * LENGTH);
      const layout = course(section);
      const halfWidth = Math.max(16, Math.round(interpolate(layout.banks, offset) / 4) * 4);
      const islands = [];
      for (const island of layout.islands) {
        if (offset <= island[0] || offset >= island[1]) continue;
        const taper = Math.min(1, (offset - island[0]) / 44, (island[1] - offset) / 44);
        const halfIsland = Math.floor(Math.min(island[2] * taper, halfWidth - 20) / 4) * 4;
        if (halfIsland >= 4) islands.push({ left: 80 - halfIsland, right: 80 + halfIsland });
      }
      return {
        left: 80 - halfWidth,
        right: 80 + halfWidth,
        islands: islands,
        land: section % 2 || islands.length ? 'landDark' : 'land',
        section: section,
      };
    }

    function channels(distance, height) {
      // Intersect the water at the nose, center and tail of an object.
      const samples = [-height / 2, 0, height / 2].map(function (offset) { return banks(distance + offset); });
      const left = Math.max.apply(null, samples.map(function (b) { return b.left; }));
      const right = Math.min.apply(null, samples.map(function (b) { return b.right; }));
      const islandLeft = samples.reduce(function (n, b) { return b.islands.length ? Math.min(n, b.islands[0].left) : n; }, right);
      const islandRight = samples.reduce(function (n, b) { return b.islands.length ? Math.max(n, b.islands[0].right) : n; }, left);
      return islandRight > islandLeft ? [[left, islandLeft], [islandRight, right]] : [[left, right]];
    }

    function add(type, offset, section, salt, lane) {
      const dimensions = DIMENSIONS[type];
      const d = section * LENGTH + offset;
      const intervals = channels(d, dimensions[1]);
      const channel = intervals[Math.min(intervals.length - 1, lane === undefined ? Math.floor(randomFor(seed, section, salt) * intervals.length) : lane)];
      const margin = dimensions[0] / 2 + 2;
      const left = channel[0] + margin, right = channel[1] - margin;
      const x = type === 'bridge' ? 80 : Math.round(left + (right - left) * (0.2 + 0.6 * randomFor(seed, section, salt + 99)));
      const moving = type === 'tanker' || type === 'helicopter';
      const speed = type === 'jet' ? 40 + Math.min(35, section * 1.4) : moving ? 5 + Math.min(16, section * 1.1) + randomFor(seed, section, salt + 55) * 4 : 0;
      entities.push({
        id: section + ':' + type + ':' + salt,
        type: type,
        x: x,
        baseX: x,
        d: d,
        width: dimensions[0],
        height: dimensions[1],
        dir: randomFor(seed, section, salt + 2) < 0.5 ? -1 : 1,
        speed: speed,
        alive: true,
        section: section + 1,
        checkpoint: type === 'bridge' ? d + 28 : undefined,
      });
    }

    function decorate(section) {
      for (const offset of [140, 560]) {
        const d = section * LENGTH + offset;
        const b = banks(d);
        const side = randomFor(seed, section, offset) < 0.5 ? -1 : 1;
        const x = side < 0 ? b.left - 15 : b.right + 15;
        if (x < 8 || x > 152) continue;
        decorations.push({ id: section + ':house:' + offset, type: 'house', x: x, d: d, width: 14, height: 7 });
        decorations.push({ id: section + ':tree:' + offset, type: 'tree', x: x + side * 4, d: d - 13, width: 10, height: 6 });
      }
    }

    function generate(section) {
      if (generated.has(section)) return;
      generated.add(section);
      if (section === 0) {
        // The opening tableau follows the cartridge's SELECT screenshot:
        // cleared starter bridge, centered tanker, right fuel, left helicopter.
        entities.push({ id: 'starter', type: 'bridge', x: 80, baseX: 80, d: 4, width: 32, height: 22, dir: 1, speed: 0, alive: false, section: 0, checkpoint: 0, starter: true });
        add('tanker', 66, section, 0);
        entities[entities.length - 1].x = entities[entities.length - 1].baseX = 80;
        add('fuel', 101, section, 1);
        entities[entities.length - 1].x = entities[entities.length - 1].baseX = 94;
        add('helicopter', 132, section, 2);
        entities[entities.length - 1].x = entities[entities.length - 1].baseX = 70;
        add('fuel', 292, section, 9);
        add('tanker', 348, section, 3);
        add('fuel', 438, section, 4, 0);
        add('helicopter', 516, section, 5);
        add('fuel', 574, section, 6);
        add('tanker', 628, section, 7);
      } else {
        const positions = [126, 208, 292, 374, 458, 548, 618];
        const fuelSlots = section < 4 ? [2, 5] : [section % 2 ? 2 : 4];
        positions.forEach(function (offset, index) {
          if (fuelSlots.indexOf(index) >= 0) {
            add('fuel', offset, section, index, section % 2);
          } else {
            const jetSlot = section >= 2 && index === (section % 2 ? 1 : 4);
            add(jetSlot ? 'jet' : index % 2 ? 'helicopter' : 'tanker', offset, section, index);
          }
        });
      }
      add('bridge', LENGTH, section, 8);
      decorate(section);
    }

    function ensure(distance) {
      if (!Number.isFinite(distance)) return;
      const first = sectionAt(distance - 180);
      const last = sectionAt(distance + 350);
      for (let section = first; section <= last; section++) generate(section);
      // A fresh world can jump directly to any checkpoint without replaying all
      // previous sections. Discard old scenery so an endless raid stays bounded.
      for (let i = entities.length - 1; i >= 0; i--) if (entities[i].d < distance - 180 || entities[i].d > (last + 1) * LENGTH) entities.splice(i, 1);
      for (let i = decorations.length - 1; i >= 0; i--) if (decorations[i].d < distance - 180 || decorations[i].d > (last + 1) * LENGTH) decorations.splice(i, 1);
      for (const section of generated) if (section < first || section > last) generated.delete(section);
      for (const section of cache.keys()) if (section < first - 1 || section > last + 1) cache.delete(section);
    }

    function checkpointBefore(distance) {
      const bridge = Math.max(0, Math.floor((distance - 28) / LENGTH));
      return bridge ? bridge * LENGTH + 28 : 0;
    }

    return {
      seed: seed,
      entities: entities,
      decorations: decorations,
      banks: banks,
      ensure: ensure,
      checkpointBefore: checkpointBefore,
      sectionAt: sectionAt,
      sectionLength: LENGTH,
    };
  }

  return { create: create };
})();
