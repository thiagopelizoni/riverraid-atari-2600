'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {}, console };
vm.createContext(context);
for (const name of ['config', 'sprites', 'world', 'game']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), context);
}

const game = new context.window.RR.Game();
game.start();
game.action('start');

function waterIntervals(distance) {
  const banks = game.world.banks(distance);
  const intervals = banks.islands.length ?
    [[banks.left, banks.islands[0].left], [banks.islands[0].right, banks.right]] :
    [[banks.left, banks.right]];
  return intervals.map(function (interval) { return [interval[0] + 4, interval[1] - 4]; });
}

function pilotInput() {
  // Observe the river, then issue exactly the same directional and fire inputs
  // a human can issue. No simulation state or world object is modified here.
  let safe = [];
  for (const lead of [80, 40, 20, 0]) {
    safe = [[0, 160]];
    for (let offset = -8; offset <= lead; offset += 2) {
      const water = waterIntervals(game.distance + offset);
      safe = safe.flatMap(function (current) {
        return water.map(function (interval) {
          return [Math.max(current[0], interval[0]), Math.min(current[1], interval[1])];
        });
      }).filter(function (interval) { return interval[1] >= interval[0]; });
    }
    if (safe.length) break;
  }
  assert(safe.length, 'The pilot needs a reachable water channel.');
  const lane = safe.reduce(function (best, interval) {
    const center = (interval[0] + interval[1]) / 2;
    return Math.abs(center - game.x) < Math.abs((best[0] + best[1]) / 2 - game.x) ? interval : best;
  }, safe[0]);
  let target = (lane[0] + lane[1]) / 2;
  const ahead = game.world.entities.filter(function (entity) {
    const gap = entity.d - game.distance;
    const visible = entity.type === 'fuel' ? gap > -12 && gap < 100 : gap > 2 && gap < 150;
    return entity.alive && visible && (entity.type === 'bridge' || Math.abs(entity.x - target) < 50);
  }).sort(function (a, b) { return a.d - b.d; });
  const next = ahead[0];
  const input = {};
  if (next && next.type === 'bridge') {
    target = Math.max(lane[0], Math.min(lane[1], next.x));
    const gap = next.d - game.distance;
    if (gap > 0 && Math.abs(target - game.x) < 8) input.fire = true;
    if (gap < 160) input.down = true;
  } else if (next && next.type === 'fuel' && game.fuel < 60) {
    target = Math.max(lane[0], Math.min(lane[1], next.x));
    if (Math.abs(next.d - game.distance) < 40) input.down = true;
  } else {
    const threat = ahead.find(function (entity) { return entity.type !== 'fuel' && entity.type !== 'bridge'; });
    if (threat) {
      const gap = threat.d - game.distance;
      if (gap > 8 && gap < 130 && Math.abs(threat.x - game.x) < 8) input.fire = true;
      if (gap < 110) input.down = true;
    }
    const full = ahead.find(function (entity) { return entity.type === 'fuel' && game.fuel > 92; });
    if (full && Math.abs(full.x - game.x) < 4 && full.d - game.distance > 10) input.fire = true;
  }
  if (target - game.x > 0.4) input.right = true;
  if (target - game.x < -0.4) input.left = true;
  return input;
}

const checkpoints = [];
const limit = 60 * 240;
for (let frame = 0; frame < limit && game.bridges < 2; frame++) {
  const previous = game.bridges;
  game.step(1 / 60, pilotInput());
  assert.equal(game.lives, 4, 'The flight must preserve all four jets.');
  assert.equal(game.phase, 'playing', 'The pilot must survive every simulated frame.');
  if (game.bridges > previous) {
    checkpoints.push({
      bridge: game.bridges,
      distance: Number(game.distance.toFixed(1)),
      score: game.score,
      fuel: Number(game.fuel.toFixed(1)),
    });
  }
}

assert.equal(game.bridges, 2, 'Normal controls must destroy the first bridges of the cartridge river.');
assert(game.distance > 1000, 'The pilot must fly through the opening sections.');
assert(game.fuel > 0, 'The flight needs actual refueling to remain viable.');
console.log(JSON.stringify({ flight: 'passed', inputOnly: true, checkpoints: checkpoints, distance: Number(game.distance.toFixed(1)), score: game.score, fuel: Number(game.fuel.toFixed(1)), jetsRemaining: game.lives }));
