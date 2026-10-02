'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { buildArtifact, ROOT, OUTPUT } = require('./build-artifact');

const sandbox = {
  console,
  Math,
  performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const filename of ['config.js', 'sprites.js', 'world.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', filename), 'utf8'), sandbox, { filename });
}
const RR = sandbox.RR;

function openRiver() {
  return {
    entities: [],
    banks: () => ({ left: 0, right: 160, islands: [], land: 'land', section: 0 }),
    ensure() {},
    checkpointBefore: () => 0,
    sectionAt: () => 0,
  };
}

function game(options = {}) {
  const instance = new RR.Game({ worldFactory: openRiver, ...options });
  instance.start();
  instance.step(1 / 60, { up: true });
  assert.equal(instance.phase, 'playing');
  return instance;
}

function entity(type, x, d, attributes = {}) {
  const dimensions = {
    tanker: [16, 8], helicopter: [8, 10], fuel: [7, 24],
    jet: [16, 8], bridge: [32, 22],
  };
  return {
    id: `fixture-${type}`, type, x, baseX: x, d,
    width: dimensions[type][0], height: dimensions[type][1],
    dir: 1, speed: 0, alive: true, section: 0, ...attributes,
  };
}

test('o rio é determinístico, contínuo e continua gerando fases', () => {
  const a = RR.World.create(1982);
  const b = RR.World.create(1982);
  const encountered = new Map();
  for (let d = 0; d <= 14000; d += 50) {
    a.ensure(d);
    b.ensure(d);
    assert.equal(JSON.stringify(a.entities), JSON.stringify(b.entities));
    assert.ok(a.entities.length < 50, 'o cenário descarta objetos distantes e não cresce sem limite');
    for (const object of a.entities) encountered.set(object.id, object);
  }
  const types = new Set([...encountered.values()].map((e) => e.type));
  for (const type of ['tanker', 'helicopter', 'fuel', 'jet', 'bridge']) assert.ok(types.has(type), type);
  assert.ok(a.entities.some((e) => e.d > 14000), 'o percurso não termina após as primeiras fases');
  const opening = a.banks(100);
  assert.deepEqual([opening.left, opening.right, opening.islands.length, opening.land], [44, 116, 0, 'land'], 'o trecho inicial é o canal reto do cartucho');
  assert.notEqual(RR.Config.PALETTE.landDark, '#0C4A1C', 'o verde escuro do cartucho não é uma tela preta');
  let dark = 0;
  let islands = 0;
  for (let d = 0; d <= 14000; d += 4) {
    const banks = a.banks(d);
    assert.ok(banks.left >= 16 && banks.right <= 144 && banks.right - banks.left >= 8, `canal em ${d}`);
    if (banks.land === 'landDark') dark++;
    for (const island of banks.islands) {
      islands++;
      assert.ok(island.left > banks.left && island.right < banks.right && island.right > island.left, `ilha em ${d}`);
      assert.ok(island.left - banks.left >= 4 && banks.right - island.right >= 4, `passagem em torno da ilha em ${d}`);
    }
  }
  assert.ok(dark > 0, 'trechos pares usam o verde escuro, ainda assim verde');
  assert.ok(islands > 0, 'há ilhas centrais');
  const stations = [...encountered.values()].filter((e) => e.type === 'fuel').sort((x, y) => x.d - y.d);
  assert.ok(stations.length >= 20, 'há postos ao longo do percurso');
  for (let i = 1; i < stations.length; i++) {
    assert.ok(stations[i].d - stations[i - 1].d < 1400, 'combustível alcançável antes de esgotar o tanque em velocidade normal');
  }
});

test('a partida aguarda o joystick e começa com um avião e três reservas', () => {
  const g = new RR.Game({ worldFactory: openRiver });
  assert.equal(g.phase, 'title');
  g.start();
  assert.equal(g.phase, 'ready');
  const distance = g.distance;
  g.step(1, {});
  assert.equal(g.distance, distance);
  assert.equal(g.lives, 4);
  g.step(1 / 60, { fire: true });
  assert.equal(g.phase, 'playing');
  assert.ok(g.distance > distance, 'o primeiro comando já movimenta o avião');
});

test('o joystick governa direção e velocidade sem parar o avanço do rio', () => {
  const slow = game();
  const fast = game();
  slow.step(1, { down: true });
  fast.step(1, { up: true });
  assert.ok(slow.speed > 0 && slow.speed < fast.speed);
  assert.ok(slow.distance > 0 && fast.distance > slow.distance);
  const x = fast.x;
  fast.step(0.1, { right: true });
  assert.ok(fast.x > x);
  fast.step(0.2, { left: true });
  assert.ok(fast.x < x);
});

test('o botão dispara continuamente com um único míssil na tela', () => {
  const g = game();
  g.step(1 / 60, { fire: true });
  assert.equal(g.bullets.length, 1);
  const first = g.bullets[0];
  for (let i = 0; i < 20; i++) {
    g.step(1 / 120, { fire: true });
    assert.ok(g.bullets.length <= 1, 'um só míssil ativo');
  }
  assert.equal(g.bullets[0], first, 'segurar o botão não empilha mísseis');
  let repeated = false;
  for (let i = 0; i < 180; i++) {
    g.step(1 / 120, { fire: true });
    if (g.bullets.some((bullet) => bullet !== first)) repeated = true;
    assert.ok(g.bullets.length <= 1);
  }
  assert.ok(repeated, 'segurar o botão dispara outro míssil após o anterior desaparecer');
});

test('a dificuldade B guia o míssil com o avião e a dificuldade A mantém o tiro reto', () => {
  const guided = game();
  guided.step(1 / 60, { fire: true });
  const guidedX = guided.bullets[0].x;
  guided.step(0.1, { right: true });
  assert.ok(guided.bullets[0].x > guidedX);
  const straight = game();
  straight.action('difficulty');
  assert.equal(straight.expert, true);
  straight.step(1 / 60, { fire: true });
  const straightX = straight.bullets[0].x;
  straight.step(0.1, { right: true });
  assert.equal(straight.bullets[0].x, straightX);
  assert.ok(straight.x > straightX);
});

test('cada alvo concede a pontuação do cartucho uma única vez', () => {
  for (const [type, score] of Object.entries({ tanker: 30, helicopter: 60, fuel: 80, jet: 100, bridge: 500 })) {
    const g = game();
    const target = entity(type, 80, 100, { checkpoint: 128 });
    g.world.entities.push(target);
    g.hit(target);
    assert.equal(g.score, score, type);
    assert.equal(target.alive, false, type);
    g.hit(target);
    assert.equal(g.score, score, `o mesmo ${type} não concede pontos duas vezes`);
  }
});

test('a colisão de míssil é verificada durante o deslocamento', () => {
  const g = game();
  const target = entity('tanker', g.x, g.distance + 35);
  g.world.entities.push(target);
  g.step(0.2, { fire: true });
  assert.equal(target.alive, false, 'o míssil não atravessa o navio entre quadros');
  assert.equal(g.score, 30);
  assert.equal(g.phase, 'playing');
});

test('um míssil acerta o primeiro alvo e é bloqueado pelo terreno', () => {
  const g = game();
  const first = entity('tanker', g.x, g.distance + 25);
  const second = entity('helicopter', g.x, g.distance + 45);
  g.world.entities.push(second, first);
  g.step(0.16, { fire: true });
  assert.equal(first.alive, false);
  assert.equal(second.alive, true);
  assert.equal(g.score, 30);

  const blocked = game();
  const target = entity('helicopter', blocked.x, blocked.distance + 65);
  blocked.world.entities.push(target);
  const origin = blocked.distance;
  blocked.world.banks = (d) => ({
    left: 0, right: 160,
    islands: d > origin + 30 && d < origin + 45 ? [{ left: 70, right: 90 }] : [],
    section: 0,
  });
  blocked.step(0.18, { fire: true });
  assert.equal(target.alive, true);
  assert.equal(blocked.score, 0);
  assert.equal(blocked.bullets.length, 0);
});

test('voar consome combustível e sobrevoar o posto reabastece sem destruí-lo', () => {
  const g = game();
  g.fuel = 20;
  g.step(0.2, {});
  assert.ok(g.fuel < 20);
  g.speed = 30;
  g.fuel = 10;
  const station = entity('fuel', g.x, g.distance + 5);
  g.world.entities.push(station);
  g.step(0.2, { down: true });
  assert.ok(g.fuel > 10, 'o avião reabastece enquanto atravessa o posto');
  assert.equal(station.alive, true);
  assert.equal(g.score, 0);
  g.fuel = 99;
  station.d = g.distance + 5;
  g.step(0.1, { down: true });
  assert.ok(g.fuel <= 100, 'o tanque tem capacidade limitada');
});

test('ficar sem combustível, atingir margem, ilha ou alvo derruba o avião', () => {
  const dry = game();
  dry.fuel = 0.01;
  dry.step(0.1, {});
  assert.equal(dry.phase, 'dying');

  const shore = game();
  shore.world.banks = () => ({ left: 90, right: 160, islands: [], section: 0 });
  shore.step(1 / 60, {});
  assert.equal(shore.phase, 'dying');

  const island = game();
  island.world.banks = () => ({ left: 0, right: 160, islands: [{ left: 70, right: 90 }], section: 0 });
  island.step(1 / 60, {});
  assert.equal(island.phase, 'dying');

  for (const type of ['tanker', 'helicopter', 'jet', 'bridge']) {
    const g = game();
    g.world.entities.push(entity(type, g.x, g.distance));
    g.step(1 / 60, {});
    assert.equal(g.phase, 'dying', type);
  }
});

test('destruir a ponte estabelece o ponto de retorno e restaura o tanque após a morte', () => {
  const g = game();
  const bridge = entity('bridge', 80, 700, { checkpoint: 728, section: 1 });
  g.world.entities.push(bridge);
  g.hit(bridge);
  assert.equal(g.checkpoint, 728);
  g.distance = 900;
  g.fuel = 7;
  g.die('tanker');
  g.step(2, {});
  assert.equal(g.phase, 'ready');
  assert.equal(g.lives, 3);
  assert.equal(g.distance, 728);
  assert.equal(g.fuel, 100);
  assert.equal(g.score, 500);
});

test('cada 10.000 pontos concede uma reserva, até o limite de nove reservas', () => {
  const g = game();
  g.scorePoints(9990);
  assert.equal(g.lives, 4);
  g.scorePoints(10);
  assert.equal(g.lives, 5);
  g.scorePoints(20000);
  assert.equal(g.lives, 7, 'cruzar duas marcas concede dois aviões');
  g.scorePoints(100000);
  assert.equal(g.lives, 10);
});

test('o limite de um milhão de pontos preserva o recorde e encerra os bônus repetidos', () => {
  const records = [];
  const g = game({ onScore: (score) => records.push(score) });
  g.scorePoints(999990);
  g.scorePoints(30);
  assert.equal(g.score, 1000000);
  assert.equal(g.highScore, 1000000);
  assert.equal(records.at(-1), 1000000);
  g.lives = 2;
  g.scorePoints(500);
  assert.equal(g.score, 1000000);
  assert.equal(g.lives, 2, 'alvos adicionais no limite não concedem o mesmo bônus novamente');
});

test('a pausa preserva a simulação e retoma a mesma partida', () => {
  const g = game();
  g.step(0.1, { fire: true });
  g.action('pause');
  assert.equal(g.phase, 'paused');
  const before = JSON.stringify({ distance: g.distance, x: g.x, fuel: g.fuel, score: g.score, bullets: g.bullets, time: g.time });
  g.step(10, { up: true, right: true, fire: true });
  assert.equal(JSON.stringify({ distance: g.distance, x: g.x, fuel: g.fuel, score: g.score, bullets: g.bullets, time: g.time }), before);
  g.action('pause');
  assert.equal(g.phase, 'playing');
  g.step(0.1, {});
  assert.ok(g.distance > JSON.parse(before).distance);
});

test('perder os quatro aviões encerra a partida e permite uma nova partida completa', () => {
  const g = game();
  g.scorePoints(500);
  for (let i = 0; i < 4; i++) {
    if (g.phase === 'ready') g.step(1 / 60, { fire: true });
    g.die('tanker');
    g.step(2, {});
  }
  assert.equal(g.phase, 'gameover');
  assert.equal(g.lives, 0);
  g.start();
  assert.equal(g.phase, 'ready');
  assert.equal(g.score, 0);
  assert.equal(g.distance, 0);
  assert.equal(g.fuel, 100);
  assert.equal(g.lives, 4);
});

test('segurar o tiro durante a última morte não apaga a tela de fim de jogo', () => {
  const g = game();
  g.scorePoints(500);
  g.lives = 1;
  g.die('tanker');
  g.step(2, { fire: true });
  assert.equal(g.phase, 'gameover');
  g.step(5, { fire: true });
  assert.equal(g.phase, 'gameover');
  assert.equal(g.score, 500);
  g.step(1 / 60, {});
  g.step(1 / 60, { fire: true });
  assert.equal(g.phase, 'playing', 'soltar e pressionar novamente inicia uma nova partida');
  assert.equal(g.score, 0);
  assert.equal(g.lives, 4);
});

test('no jogo 2 os pilotos alternam com pontuação, reservas e checkpoint independentes', () => {
  const g = new RR.Game({ worldFactory: openRiver });
  g.action('select2');
  assert.equal(g.gameMode, 2);
  g.step(1 / 60, { fire: true });
  g.scorePoints(30);
  g.hit(entity('bridge', 80, 700, { checkpoint: 728, section: 1 }));
  g.die('tanker');
  g.step(2, {});
  assert.equal(g.player, 1);
  assert.equal(g.score, 0);
  assert.equal(g.lives, 4);
  assert.equal(g.checkpoint, 0);
  g.step(1 / 60, { fire: true });
  g.scorePoints(60);
  g.die('tanker');
  g.step(2, {});
  assert.equal(g.player, 0);
  assert.equal(g.score, 530);
  assert.equal(g.lives, 3);
  assert.equal(g.checkpoint, 728);
  assert.equal(g.distance, 728);
});

test('a simulação produz o mesmo resultado para quadros de tamanhos diferentes', () => {
  const a = game();
  const b = game();
  a.step(1, { up: true, fire: true });
  for (let i = 0; i < 120; i++) b.step(1 / 120, { up: true, fire: true });
  for (const key of ['distance', 'speed', 'fuel', 'x', 'score', 'lives']) {
    assert.ok(Math.abs(a[key] - b[key]) < 1e-7, key);
  }
  assert.equal(a.bullets.length, b.bullets.length);
});

test('o artefato entrega um documento HTML completo sem arquivos CSS/JS separados', () => {
  const result = buildArtifact();
  const html = fs.readFileSync(OUTPUT, 'utf8');
  assert.ok(result.bytes > 10000);
  assert.match(html, /^\s*<!doctype html>/i);
  assert.match(html, /<meta\b[^>]*name=["']viewport["']/i);
  assert.match(html, /<canvas\b/i);
  assert.match(html, /<\/html>\s*$/i);
  assert.doesNotMatch(html, /<script\b[^>]*src=/i);
  assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet["']/i);
});
