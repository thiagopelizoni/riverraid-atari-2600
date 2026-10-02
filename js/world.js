window.RR = window.RR || {};

window.RR.World = (function () {
  'use strict';

  // Cartridge geography (River Raid, Thomas Jentzsch disassembly):
  // 16-bit LFSR seeded $A814, 16 blocks per section, 32 lines per half-block,
  // last half-block is the bridge. Odd levels are straight (pattern 7, bright
  // green $D6). Even levels bend and grow islands (darker green $D2). COLUBK
  // stays blue; COLUPF is the bank. PF0 is always land, so the channel cannot
  // collapse into a black screen.
  const ORIGIN = 64;
  const BLOCK = 32;
  const SECTION = 1024;
  const BANK = [0x00, 0xa1, 0x91, 0x7f, 0x6b, 0x55, 0x3d, 0x23, 0x07, 0xa9, 0x90, 0x75, 0x58, 0x39, 0x18];
  const SHAPE_POS = [143, 141, 7, 10, 132, 13, 128, 18, 124, 22, 120, 26, 116, 30, 112];
  const ENEMY = [7, 5, 7, 5, 4, 7, 5, 5];
  const PAGE_FLAG = [0, 2, 1, 3];
  const ID = { plane: 4, heli: 5, ship: 7, house: 9, fuel: 10 };
  const NEAR_TO_FAR = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 0, 0];
  const SIZE = { tanker: [16, 8], helicopter: [8, 10], fuel: [7, 24], jet: [8, 6], bridge: [32, 22], house: [14, 7] };
  const PAGE_FC = page('000000000000000000000000000000000000000103070f1f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f1f0f07030100000000000000000103070f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f0f07030100000000000000000103070f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f07030100000000000000000103070707070707070707070707070707070301000000000000000001030303030303030303030303030303030100000000000000000101010101010101010101010101010100000000000000002a3e1c08496b7f7f3e1c08080800000000022e3c18080a2e3e3e3c180808080000000000020810004008214410040800000000000000000000000000000000');
  const PAGE_FD = page('80c0e0f0f8fcfefffffffffffffffffffffffffffffffffefcf8f0e0c080c0e0f0f8fcfefefefefefefefefefefefefefefefefcf8f0e0c080c0e0f0f8fcfcfcfcfcfcfcfcfcfcfcfcfcfcfcfcf8f0e0c080c0e0f0f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f0e0c080c0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0e0c080c0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0c080c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c08080808080808080808080808080808000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');

  function page(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return bytes;
  }

  function asl(a) { return { a: (a << 1) & 0xff, c: (a >> 7) & 1 }; }
  function rol(value, c) { return { a: ((value << 1) | c) & 0xff, c: (value >> 7) & 1 }; }
  function sbc(a, value, c) {
    const result = a - value - (1 - c);
    return { a: result & 0xff, c: result >= 0 ? 1 : 0 };
  }
  function adc(a, value, c) {
    const result = a + value + c;
    return { a: result & 0xff, c: result > 255 ? 1 : 0 };
  }

  function patternByte(pageBit, low, y) {
    const address = (pageBit ? 256 : 0) + low + y;
    if (address < 256) return PAGE_FC[address];
    if (address < 512) return PAGE_FD[address - 256];
    return 0;
  }

  function create() {
    let randomLo = 0x14;
    let randomHi = 0xa8;
    let level = 1;
    let sectionBlock = 17;
    let blockPart = 1;
    let patternId = 12;
    let playfieldState = 0;
    let colorFlag = 1;
    const blocks = [];
    const entities = [];
    const decorations = [];
    const materialized = new Set();

    function nextRandom16() {
      let a = randomHi;
      let c;
      ({ a, c } = asl(a));
      ({ a, c } = asl(a));
      ({ a, c } = asl(a));
      a = (a ^ randomHi) & 0xff;
      ({ a, c } = asl(a));
      ({ a: randomLo, c } = rol(randomLo, c));
      ({ a: randomHi, c } = rol(randomHi, c));
    }

    function getPageFlag(x) {
      if (x === 0 || x >= 9) return 0;
      return 1;
    }

    function wideBank(x, diff, flags) {
      const page = ((getPageFlag(x) << 1) | 1) & 0xff;
      const loaded = loadPFPattern(page, x, diff, flags);
      return { flags: loaded.flags, pf1: 7, pf2: loaded.pf2 };
    }

    function loadPFPattern(a, x, diff, flags) {
      if (playfieldState & 0x80) a = PAGE_FLAG[a & 3];
      flags = (flags | a) & 0xff;
      return { flags: flags, pf2: (BANK[x] + diff) & 0xff, a: (BANK[x] + diff) & 0xff };
    }

    function buildPatterns(prevId, flags) {
      let c = 1;
      let a = prevId;
      let x = prevId;
      ({ a, c } = sbc(a, patternId, c));
      let diff = a;
      let pf1 = 0;
      let pf2 = 0;
      if (c === 0) {
        diff = (diff + 1) & 0xff;
        const prevBig = x >= 8;
        x = patternId;
        if (prevBig) {
          ({ flags, pf1, pf2 } = wideBank(x, diff, flags));
        } else if (x < 9) {
          ({ flags, pf2, a } = loadPFPattern(getPageFlag(x), x, diff, flags));
          pf1 = a;
          pf2 = 0;
        } else {
          a = adc(0xff, prevId, 1).a;
          if (a < 0x80) {
            pf1 = a;
            a = ((getPageFlag(x) << 1) | 1) & 0xff;
            ({ flags, pf2 } = loadPFPattern(a, x, diff, flags));
          } else {
            ({ flags, pf1, pf2 } = wideBank(x, diff, flags));
          }
        }
      } else {
        if (a !== 0) diff = (diff - 1) & 0xff;
        if (x >= 9) {
          if (patternId >= 8) {
            ({ flags, pf1, pf2 } = wideBank(x, diff, flags));
          } else {
            ({ a } = sbc(15, patternId, 0));
            pf1 = a;
            a = ((getPageFlag(x) << 1) | 1) & 0xff;
            ({ flags, pf2 } = loadPFPattern(a, x, diff, flags));
          }
        } else {
          ({ flags, pf2, a } = loadPFPattern(getPageFlag(x), x, diff, flags));
          pf1 = a;
          pf2 = 0;
        }
      }
      if (playfieldState & 0x80) {
        const swap = pf1;
        pf1 = pf2;
        pf2 = swap;
      }
      return { flags: flags, pf1: pf1, pf2: pf2 };
    }

    function chooseId(valleyWidth) {
      if (sectionBlock === 1) {
        playfieldState = 0;
        patternId = 12;
        return;
      }
      if (level & 1) {
        patternId = 7;
        return;
      }
      if (sectionBlock === 2) {
        if (playfieldState === 0xc0) {
          playfieldState = 0x80;
          patternId = 0;
          return;
        }
        playfieldState = 0;
      } else {
        const mixed = (((playfieldState << 1) ^ playfieldState) & 0x80) !== 0;
        if (mixed) playfieldState = (playfieldState & 0x40) ? 0xc0 : 0;
        else if ((randomLo & 0x30) === 0) {
          if (playfieldState & 0x80) {
            playfieldState = 0x80;
            patternId = 0;
            return;
          }
          playfieldState = 0x40;
          patternId = 0;
          return;
        }
      }
      let max = 14;
      let a = randomLo & 0x0f;
      if (a < 2) a += 2;
      if (playfieldState & 0x80) max = 13;
      if (valleyWidth) max = 8;
      if (a > max) a = max;
      patternId = a;
    }

    function spawn(flags, valleyWidth, prevId) {
      if (flags & 0x80) return { type: 'bridge', x: 63, dir: 1 };
      let type = 'fuel';
      let id = ID.fuel;
      let state = 0;
      if (((sectionBlock + blockPart) & 0xff) >= 18) {
        type = 'house';
        id = ID.house;
        state = 5;
      } else {
        const threshold = ((63 - level) << 1) & 0xff;
        if (randomHi > threshold) {
          id = ENEMY[randomHi & (level >= 3 ? 7 : 1)];
          type = id === ID.plane ? 'jet' : id === ID.ship ? 'tanker' : 'helicopter';
          if (id === ID.ship) state = 5;
        } else if ((randomLo & 0x40) === 0) {
          type = 'fuel';
        } else {
          type = 'house';
          id = ID.house;
          state = 5;
        }
      }
      let c = 1;
      let a = 0;
      if (type === 'house') {
        const smaller = Math.min(patternId, prevId);
        if (level & 1) {
          a = randomLo & 0x1f;
          ({ a } = adc(a, 8, 0));
          if (a >= 25) ({ a } = adc(a, 92, 1));
        } else {
          a = SHAPE_POS[smaller] || 0;
          if ((playfieldState & 0x80) && smaller !== 0) a = 71;
        }
        return { type: type, x: a, dir: 1 };
      }
      if (patternId === prevId && (level & 1)) {
        a = state ? 106 : 97;
        ({ a, c } = sbc(a, valleyWidth, 1));
        const temp = a;
        a = randomLo & 0x3f;
        ({ a, c } = adc(a, 45, 0));
        ({ a, c } = adc(a, valleyWidth, c));
        if (a >= temp) a = temp;
        return { type: type, x: a, dir: type === 'fuel' || (randomLo & 0x80) === 0 ? 1 : -1 };
      }
      let maxId = Math.max(patternId, prevId);
      const limit = (playfieldState & 0x80) ? 10 : 13;
      if (maxId > limit && id === ID.ship) {
        type = 'helicopter';
        id = 6;
        state = 0;
      }
      a = maxId;
      ({ a, c } = asl(a));
      ({ a, c } = asl(a));
      if (a !== 0 && (playfieldState & 0x80)) {
        a ^= 0xff;
        ({ a, c } = adc(a, 81, c));
        if (randomLo & 0x80) {
          a ^= 0xff;
          ({ a, c } = adc(a, 160, c));
          ({ a, c } = adc(a, 2, 0));
          ({ a, c } = adc(a, valleyWidth, c));
          return { type: type, x: a, dir: 1 };
        }
      } else {
        ({ a, c } = adc(a, 16, c));
        if ((randomLo & 0x80) === 0) {
          ({ a, c } = adc(a, 2, 0));
          ({ a, c } = adc(a, valleyWidth, c));
          return { type: type, x: a, dir: 1 };
        }
        a ^= 0xff;
        ({ a, c } = adc(a, 161, c));
      }
      c = id >= ID.fuel ? 1 : 0;
      ({ a, c } = sbc(a, 9, c));
      ({ a, c } = sbc(a, valleyWidth, c));
      if (state) ({ a, c } = sbc(a, 10, c));
      return { type: type, x: a, dir: type === 'fuel' ? 1 : -1 };
    }

    function createBlock() {
      const valleyWidth = level < 5 ? 6 : 0;
      let flags = colorFlag ? 4 : 0;
      const prevId = patternId;
      blockPart = (blockPart - 1) & 0xff;
      if (blockPart !== 0) {
        if (sectionBlock === 1) flags = (level & 1) ? 0x80 : 0x84;
        nextRandom16();
      } else {
        sectionBlock = (sectionBlock - 1) & 0xff;
        if (sectionBlock === 0) {
          if (level >= 48) level = 46;
          level += 1;
          sectionBlock = 16;
        }
        nextRandom16();
        chooseId(valleyWidth);
        blockPart = 2;
      }
      const built = buildPatterns(prevId, flags);
      flags = built.flags;
      colorFlag = flags & 4 ? 1 : 0;
      blocks.push({
        level: level,
        flags: flags,
        pf1: built.pf1,
        pf2: built.pf2,
        object: spawn(flags, valleyWidth, prevId),
      });
    }

    function ensureBlock(index) {
      while (blocks.length <= index) createBlock();
    }

    function banks(distance) {
      const timeline = Math.max(0, distance + ORIGIN);
      const index = Math.floor(timeline / BLOCK);
      const line = Math.floor(timeline) - index * BLOCK;
      ensureBlock(index);
      const block = blocks[index];
      const y = NEAR_TO_FAR[line] || 0;
      const pf1 = patternByte(block.flags & 1, block.pf1, y);
      const pf2 = patternByte(block.flags & 2, block.pf2, y);
      const bits = [1, 1, 1, 1];
      for (let i = 7; i >= 0; i--) bits.push((pf1 >> i) & 1);
      for (let i = 0; i < 8; i++) bits.push((pf2 >> i) & 1);
      const leftSide = bits.slice();
      for (let i = 19; i >= 0; i--) bits.push(leftSide[i]);
      let first = bits.indexOf(0);
      let last = bits.lastIndexOf(0);
      if (first < 0) { first = 8; last = 31; }
      const islands = [];
      if ((block.flags & 0x80) === 0) {
        for (let i = first; i <= last; i++) {
          if (bits[i] !== 1) continue;
          const start = i;
          while (i <= last && bits[i] === 1) i++;
          islands.push({ left: start * 4, right: i * 4 });
          i--;
        }
      }
      return {
        left: first * 4,
        right: (last + 1) * 4,
        islands: islands,
        land: block.flags & 4 ? 'land' : 'landDark',
        section: block.level - 1,
        bridge: (block.flags & 0x80) !== 0,
      };
    }

    function materialize(index) {
      if (materialized.has(index)) return;
      materialized.add(index);
      ensureBlock(index);
      const block = blocks[index];
      const object = block.object;
      const size = SIZE[object.type];
      const d = index * BLOCK + 16 - ORIGIN;
      const center = object.type === 'bridge' ? 80 : object.x + (object.type === 'tanker' || object.type === 'house' ? 8 : 4);
      if (object.type === 'house') {
        decorations.push({ id: index + ':house', type: 'house', x: center, d: d, width: size[0], height: size[1] });
        return;
      }
      const moving = object.type === 'tanker' || object.type === 'helicopter';
      entities.push({
        id: index + ':' + object.type,
        type: object.type,
        x: center,
        baseX: center,
        d: d,
        width: size[0],
        height: size[1],
        dir: object.dir,
        speed: object.type === 'jet' ? 60 : moving && block.level > 1 ? 30 : 0,
        alive: true,
        section: block.level,
        checkpoint: object.type === 'bridge' ? (index + 1) * BLOCK - ORIGIN : undefined,
      });
    }

    function ensure(distance) {
      if (!Number.isFinite(distance)) return;
      const first = Math.floor((distance - 180 + ORIGIN) / BLOCK);
      const last = Math.floor((distance + 400 + ORIGIN) / BLOCK);
      for (let index = Math.max(0, first); index <= last; index++) materialize(index);
      for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].d < distance - 220 || entities[i].d > distance + 480) entities.splice(i, 1);
      }
      for (let i = decorations.length - 1; i >= 0; i--) {
        if (decorations[i].d < distance - 220 || decorations[i].d > distance + 480) decorations.splice(i, 1);
      }
      for (const index of materialized) {
        const d = index * BLOCK - ORIGIN;
        if (d < distance - 220 || d > distance + 480) materialized.delete(index);
      }
    }

    function checkpointBefore(distance) {
      const index = Math.floor((distance + ORIGIN) / BLOCK);
      for (let i = index; i >= 0; i--) {
        ensureBlock(i);
        if ((blocks[i].flags & 0x80) && (i + 1) * BLOCK - ORIGIN < distance) return (i + 1) * BLOCK - ORIGIN;
      }
      return 0;
    }

    function sectionAt(distance) {
      const timeline = Math.max(0, distance + ORIGIN);
      ensureBlock(Math.floor(timeline / BLOCK));
      return blocks[Math.floor(timeline / BLOCK)].level - 1;
    }

    return {
      seed: 0xa814,
      entities: entities,
      decorations: decorations,
      banks: banks,
      ensure: ensure,
      checkpointBefore: checkpointBefore,
      sectionAt: sectionAt,
      sectionLength: SECTION,
    };
  }

  return { create: create };
})();
