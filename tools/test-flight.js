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
  return intervals.map(function (interval) { return [interval[0] + 5, interval[1] - 5]; });
}

function pilotInput() {
  // Observe the river, then issue exactly the same directional and fire inputs
  // a human can issue. No simulation state or world object is modified here.
  let safe = [];
  for (const lead of [50, 30, 15, 0]) {
    safe = [[0, 160]];
    for (let offset = -8; offset <= lead; offset += 5) {
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
    return entity.alive && gap > -18 && gap < 140 && (entity.type === 'bridge' || Math.abs(entity.x - target) < 50);
  }).sort(function (a, b) { return a.d - b.d; });
  const next = ahead[0];
  const input = {};
  if (next) {
    target = Math.max(lane[0], Math.min(lane[1], next.x));
    const gap = next.d - game.distance;
    if (next.type === 'fuel') {
      if (game.fuel >= 99 && gap > -5 && gap < 18 && Math.abs(target - game.x) < 4) input.fire = true;
      else if (game.fuel >= 95 && gap > 25 && Math.abs(target - game.x) < 4) input.fire = true;
      else if (Math.abs(gap) < 28) input.down = true;
    } else {
      if (gap > 0 && Math.abs(target - game.x) < 4) input.fire = true;
      if (gap < 90 && Math.abs(target - game.x) > 5) input.down = true;
    }
  }
  if (target - game.x > 0.4) input.right = true;
  if (target - game.x < -0.4) input.left = true;
  return input;
}

const checkpoints = [];
const limit = 60 * 240;
const finishDistance = 8 * context.window.RR.Config.TUNE.sectionLength + 28;
for (let frame = 0; frame < limit && (game.bridges < 8 || game.distance < finishDistance); frame++) {
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

assert.equal(game.bridges, 8, 'Normal controls must reach the eighth bridge.');
assert(game.distance >= finishDistance, 'The pilot must fly beyond the eighth bridge and its restart point.');
assert(game.fuel > 0, 'The flight needs actual refueling to remain viable.');
console.log(JSON.stringify({ flight: 'passed', inputOnly: true, checkpoints: checkpoints, distance: Number(game.distance.toFixed(1)), score: game.score, fuel: Number(game.fuel.toFixed(1)), jetsRemaining: game.lives }));
