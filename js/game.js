window.RR = window.RR || {};

(function (RR) {
  'use strict';

  const C = RR.Config;
  const T = C.TUNE;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const silent = new Proxy({}, { get: () => () => {} });
  const controls = ['left', 'right', 'up', 'down', 'fire'];
  // Six-by-eight HUD digits and the cartridge's compact signature. The 0, 1,
  // 2, 3, 7 and 9 bitmaps were sampled from original Atari 2600 captures.
  const scoreFont = {
    0: ['.1111.', '11..11', '11..11', '11..11', '11..11', '11..11', '11..11', '.1111.'],
    1: ['..11..', '.111..', '..11..', '..11..', '..11..', '..11..', '..11..', '.1111.'],
    2: ['.1111.', '1...11', '....11', '....11', '.1111.', '11....', '11....', '111111'],
    3: ['.1111.', '1...11', '....11', '...11.', '...11.', '....11', '1...11', '.1111.'],
    4: ['...11.', '..111.', '.1.11.', '11.11.', '111111', '...11.', '...11.', '...11.'],
    5: ['111111', '11....', '11....', '11111.', '....11', '....11', '1...11', '.1111.'],
    6: ['.1111.', '11...1', '11....', '11111.', '11..11', '11..11', '11..11', '.1111.'],
    7: ['111111', '1....1', '....11', '...11.', '..11..', '..11..', '..11..', '..11..'],
    8: ['.1111.', '11..11', '11..11', '.1111.', '11..11', '11..11', '11..11', '.1111.'],
    9: ['.1111.', '11..11', '11..11', '11..11', '.11111', '....11', '1...11', '.1111.'],
    '!': ['..11..', '..11..', '..11..', '..11..', '..11..', '......', '..11..', '..11..'],
  };
  const signature = [
    '................................',
    '....11111111....1111111.........',
    '.1.....1...1...11...............',
    '111.11.1.1.1..11..111.1.111.1..1',
    '1.1.1..1.1.1.11.1.1...1.1.1.11.1',
    '111.1..1.1.111..1.111.1.1.1.1111',
    '1.1.1..1.1.11...1...1.1.1.1.1.11',
    '1.1.11.1.1.1....1.111.1.111.1..1',
  ];

  // The simulation has no DOM or audio dependency. All coordinates are Atari
  // pixels; distance is measured forward along the river, in scanlines.
  class Game {
    constructor(options = {}) {
      this.audio = options.audio || silent;
      this.worldFactory = options.worldFactory || (() => RR.World.create());
      this.world = options.world || this.worldFactory();
      this.expert = false;
      this.gameMode = 1;
      this.player = 0;
      this.players = [];
      this.phase = 'title';
      this.previousPhase = 'playing';
      this.reason = '';
      this.time = 0;
      this.highScore = 0;
      this.startArmed = true;
      this.onScore = options.onScore || (() => {});
      this.initializePilot();
      this.world.ensure(this.distance);
    }

    initializePilot() {
      this.x = 80;
      this.distance = 0;
      this.speed = T.cruiseSpeed;
      this.fuel = 100;
      this.score = 0;
      this.lives = 4; // One jet on the river and three jets in reserve.
      this.checkpoint = 0;
      this.bridges = 0;
      this.nextExtraLife = 10000;
      this.bullets = [];
      this.effects = [];
      this.fireTimer = 0;
      this.deathTimer = 0;
      this.refueling = false;
      this.bank = 0;
    }

    snapshotPilot() {
      const { score, lives, checkpoint, bridges, nextExtraLife } = this;
      return { score, lives, checkpoint, bridges, nextExtraLife };
    }

    start() {
      this.initializePilot();
      this.player = 0;
      this.players = [this.snapshotPilot()];
      if (this.gameMode === 2) this.players.push(this.snapshotPilot());
      this.world = this.worldFactory();
      this.world.ensure(0);
      this.phase = 'ready';
      this.reason = '';
      this.audio.stop();
    }

    action(action) {
      if (action === 'start') {
        if (this.phase === 'title' || this.phase === 'gameover') this.start();
        else if (this.phase === 'ready') this.phase = 'playing';
        else this.togglePause();
      } else if (action === 'pause') this.togglePause();
      else if (action === 'reset') this.start();
      else if (action === 'difficulty') this.expert = !this.expert;
      else if (action === 'select' || action === 'select1' || action === 'select2') {
        this.gameMode = action === 'select1' ? 1 : action === 'select2' ? 2 : 3 - this.gameMode;
        this.start();
      }
    }

    togglePause() {
      if (this.phase === 'paused') this.phase = this.previousPhase;
      else if (['playing', 'ready', 'dying'].includes(this.phase)) {
        this.previousPhase = this.phase;
        this.phase = 'paused';
        this.audio.stop();
      }
    }

    scorePoints(points) {
      this.score = Math.min(1000000, this.score + points);
      while (this.score >= this.nextExtraLife) {
        this.nextExtraLife += 10000;
        this.lives = Math.min(10, this.lives + 1);
        this.audio.extraLife();
      }
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.onScore(this.score);
      }
    }

    hit(entity) {
      if (!entity.alive) return;
      entity.alive = false;
      this.scorePoints(C.SCORES[entity.type]);
      this.effects.push({ x: entity.x, d: entity.d, age: 0, bridge: entity.type === 'bridge' });
      if (entity.type === 'bridge') {
        // Destroying the bridge establishes the next restart point immediately,
        // even if the pilot crashes before actually flying over the road.
        this.checkpoint = Math.max(this.checkpoint, entity.checkpoint || entity.d + 28);
        this.bridges = Math.max(this.bridges, entity.section || this.bridges + 1);
        this.audio.bridge();
      } else this.audio.explode();
    }

    die(reason) {
      if (this.phase !== 'playing') return;
      this.phase = 'dying';
      this.reason = reason;
      this.deathTimer = T.deathTime;
      this.lives = Math.max(0, this.lives - 1);
      this.bullets = [];
      this.refueling = false;
      this.audio.stop();
      this.audio.explode();
    }

    resumeLife() {
      this.players[this.player] = this.snapshotPilot();
      if (this.gameMode === 2) {
        const other = 1 - this.player;
        if (this.players[other].lives > 0) this.player = other;
      }
      const pilot = this.players[this.player];
      if (!pilot || pilot.lives === 0) {
        this.phase = 'gameover';
        this.startArmed = false;
        this.audio.stop();
        return;
      }
      Object.assign(this, pilot);
      this.distance = this.checkpoint;
      this.world = this.worldFactory();
      this.world.ensure(this.distance);
      const banks = this.world.banks(this.distance);
      this.x = (banks.left + banks.right) / 2;
      if (banks.islands.some(i => this.x > i.left - 5 && this.x < i.right + 5)) {
        this.x = (banks.left + banks.islands[0].left) / 2;
      }
      this.fuel = 100;
      this.speed = T.cruiseSpeed;
      this.bullets = [];
      this.effects = [];
      this.fireTimer = 0;
      this.refueling = false;
      this.phase = 'ready';
    }

    onLand(x, d, halfWidth = 0) {
      const banks = this.world.banks(d);
      if (x - halfWidth < banks.left || x + halfWidth > banks.right) return true;
      return banks.islands.some(i => x + halfWidth > i.left && x - halfWidth < i.right);
    }

    step(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0 || this.phase === 'paused') return;
      // Read the current input in every substep: no deferred keyboard frame.
      while (dt > 1e-8) {
        const part = Math.min(dt, 1 / 120);
        this.advance(part, input);
        dt -= part;
      }
    }

    advance(dt, input) {
      this.time += dt;
      if (this.phase === 'title' || this.phase === 'gameover') {
        if (!input.fire) this.startArmed = true;
        if (input.fire && this.startArmed) this.start();
        else return;
      }
      if (this.phase === 'ready') {
        if (!controls.some(key => input[key])) return;
        this.phase = 'playing';
      }
      if (this.phase === 'dying') {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.resumeLife();
        return;
      }
      if (this.phase !== 'playing') return;

      const target = input.up && !input.down ? T.maxSpeed : input.down && !input.up ? T.minSpeed : T.cruiseSpeed;
      this.speed += clamp(target - this.speed, -T.acceleration * dt, T.acceleration * dt);
      this.distance += this.speed * dt;
      this.world.ensure(this.distance);
      const oldX = this.x;
      const direction = Number(!!input.right) - Number(!!input.left);
      this.x = clamp(this.x + direction * T.steerSpeed * dt, 4, C.W - 4);
      this.bank = direction;
      this.fireTimer = Math.max(0, this.fireTimer - dt);

      for (const entity of this.world.entities) {
        if (!entity.alive || !entity.speed || Math.abs(entity.d - this.distance) > C.H + 40) continue;
        entity.x += entity.dir * entity.speed * dt;
        const banks = this.world.banks(entity.d);
        const half = entity.width / 2;
        // Aircraft cross the banks; boats and helicopters patrol their channel.
        if (entity.type === 'jet') {
          if (entity.x < -half) entity.x = C.W + half;
          if (entity.x > C.W + half) entity.x = -half;
        } else {
          let left = banks.left + half, right = banks.right - half;
          for (const island of banks.islands) {
            if (entity.x < (island.left + island.right) / 2) right = Math.min(right, island.left - half);
            else left = Math.max(left, island.right + half);
          }
          if (entity.x <= left || entity.x >= right) {
            entity.x = clamp(entity.x, left, right);
            entity.dir *= -1;
          }
        }
      }

      if (input.fire && this.fireTimer <= 0 && this.bullets.length === 0) {
        this.bullets.push({ x: this.x, d: this.distance + 7 });
        this.fireTimer = T.fireInterval;
        this.audio.shot();
      }
      for (const bullet of this.bullets) {
        if (!this.expert) bullet.x += this.x - oldX;
        const start = bullet.d;
        bullet.d += (T.bulletSpeed + this.speed) * dt;
        // Resolve the nearest target first, so a single missile cannot pass
        // through a tanker and destroy another object behind it.
        const targets = this.world.entities.filter(e => e.alive &&
          e.d + e.height / 2 >= start - 2 && e.d - e.height / 2 <= bullet.d + 2 &&
          (e.type === 'bridge' || Math.abs(e.x - bullet.x) <= e.width / 2 + 0.5));
        targets.sort((a, b) => a.d - b.d);
        if (targets.length) {
          const target = targets[0];
          // An island or bank between the missile and a target blocks the shot.
          let blocked = false;
          for (let d = start; d <= Math.min(bullet.d, target.d); d += 1) {
            if (this.onLand(bullet.x, d)) { blocked = true; break; }
          }
          if (!blocked) this.hit(target);
          bullet.dead = true;
        } else {
          for (let d = start; d <= bullet.d; d += 1) {
            if (this.onLand(bullet.x, d)) { bullet.dead = true; break; }
          }
        }
        if (bullet.d > this.distance + C.PLANE_Y + 6) bullet.dead = true;
      }
      this.bullets = this.bullets.filter(b => !b.dead);

      this.refueling = false;
      for (const entity of this.world.entities) {
        if (!entity.alive || Math.abs(entity.d - this.distance) > entity.height / 2 + 5) continue;
        if (entity.type === 'bridge') {
          this.die('ponte');
          return;
        }
        if (Math.abs(entity.x - this.x) > entity.width / 2 + 3) continue;
        if (entity.type === 'fuel') this.refueling = true;
        else { this.die('colisão'); return; }
      }

      // The sprite tapers at the nose and tail. Checking individual occupied
      // pixels lets a pilot skim the riverbank without a rectangular hitbox.
      const plane = RR.Sprites.plane;
      for (let y = 0; y < plane.length; y++) {
        for (let x = 0; x < plane[y].length; x++) {
          if (plane[y][x] !== '0' && plane[y][x] !== '.' && plane[y][x] !== ' ' &&
            this.onLand(this.x + x - plane[y].length / 2 + 0.5, this.distance + plane.length / 2 - y - 0.5)) {
            this.die('margem');
            return;
          }
        }
      }

      this.fuel = clamp(this.fuel + (this.refueling ? T.refuelRate : 0) * dt - T.fuelDrain * dt, 0, 100);
      if (this.fuel <= 0) { this.die('combustível'); return; }
      this.audio.refuel(this.refueling);
      this.audio.engine(this.speed / T.maxSpeed, this.fuel, true);
      for (const effect of this.effects) effect.age += dt;
      this.effects = this.effects.filter(e => e.age < 0.35);
    }
  }

  RR.Game = Game;

  RR.boot = function () {
    const canvas = document.getElementById('screen');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const frame = document.createElement('canvas');
    frame.width = C.W;
    frame.height = C.H;
    const g = frame.getContext('2d', { alpha: false });
    const game = new Game({ audio: RR.Audio, onScore: saveRecord });
    RR.game = game;
    let muted = false, monochrome = false, last = null, statusText = '';
    let record = 0;
    try { record = Number(localStorage.getItem('riverraid2600.highScore')) || 0; } catch (_) { /* Storage is optional. */ }
    game.highScore = record;

    function saveRecord(score) {
      try { localStorage.setItem('riverraid2600.highScore', String(score)); } catch (_) { /* Private browsing can deny storage. */ }
    }

    function label(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function action(type) {
      RR.Audio.unlock();
      if (type === 'mute') {
        muted = !muted;
        RR.Audio.setMuted(muted);
        label('mute-state', muted ? 'som desligado' : 'som ligado');
        const button = document.querySelector('[data-action="mute"]');
        if (button) button.setAttribute('aria-pressed', String(muted));
      } else if (type === 'color') {
        monochrome = !monochrome;
        canvas.classList.toggle('bw', monochrome);
        label('tv-state', monochrome ? 'TV em preto e branco' : 'TV colorida');
        const button = document.querySelector('[data-switch="tv"]');
        if (button) button.setAttribute('aria-pressed', String(monochrome));
      } else if (type === 'fullscreen') {
        const tv = document.querySelector('.tv');
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else tv.requestFullscreen?.().catch(() => {});
      } else {
        game.action(type);
        label('diff-state', game.expert ? 'A · tiros retos' : 'B · tiros guiados');
        label('game-state', `JOGO ${game.gameMode} · ${game.gameMode === 1 ? '1 JOGADOR' : '2 JOGADORES'}`);
        const button = document.querySelector('[data-switch="difficulty"]');
        if (button) button.setAttribute('aria-pressed', String(game.expert));
      }
      syncStatus();
    }
    RR.Input.init(action);

    function pauseOnLeave() {
      RR.Input.clear();
      if (game.phase === 'playing' || game.phase === 'dying') game.togglePause();
      RR.Audio.stop();
      last = null;
      syncStatus();
    }
    window.addEventListener('blur', pauseOnLeave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseOnLeave(); });

    function syncStatus() {
      const messages = {
        title: 'Pronto para voar. Aperte Enter ou toque em INICIAR.',
        ready: `Jogador ${game.player + 1}. Mova o direcional ou dispare para decolar.`,
        playing: `Jogador ${game.player + 1} em voo.`,
        paused: 'Jogo pausado. Aperte P ou CONTINUAR para retomar.',
        dying: game.reason === 'combustível' ? 'Combustível esgotado.' : 'Avião perdido.',
        gameover: `Fim de jogo. Recorde: ${game.highScore}. Aperte Enter para jogar novamente.`
      };
      if (statusText !== messages[game.phase]) {
        statusText = messages[game.phase];
        label('status', statusText);
      }
      label('pause-button', game.phase === 'paused' ? 'CONTINUAR' : 'PAUSAR');
      label('start-button', game.phase === 'title' || game.phase === 'gameover' ? 'INICIAR' : game.phase === 'ready' ? 'DECOLAR' : 'REINICIAR');
      const start = document.getElementById('start-button');
      if (start) start.setAttribute('data-action', ['title', 'gameover', 'ready'].includes(game.phase) ? 'start' : 'reset');
      const pause = document.getElementById('pause-button');
      if (pause) { pause.disabled = game.phase === 'title' || game.phase === 'gameover'; pause.setAttribute('aria-pressed', String(game.phase === 'paused')); }
    }

    function sprite(rows, x, y, colors, flip = false) {
      if (!rows) return;
      const left = Math.round(x - rows[0].length / 2), top = Math.round(y - rows.length / 2);
      for (let row = 0; row < rows.length; row++) for (let col = 0; col < rows[row].length; col++) {
        const pixel = rows[row][flip ? rows[row].length - 1 - col : col];
        if (pixel === '.' || pixel === '0' || pixel === ' ') continue;
        g.fillStyle = colors[pixel] || colors[1] || '#ffffff';
        g.fillRect(left + col, top + row, 1, 1);
      }
    }

    function text(value, x, y, color, scale = 1, centered = false) {
      value = String(value).toUpperCase();
      const font = RR.Font;
      const width = value.length * 6 * scale - scale;
      if (centered) x -= width / 2;
      g.fillStyle = color;
      for (const letter of value) {
        const rows = font[letter] || font['?'] || font[' '];
        if (rows) for (let row = 0; row < rows.length; row++) for (let col = 0; col < rows[row].length; col++) {
          if (rows[row][col] === '1') g.fillRect(Math.round(x + col * scale), y + row * scale, scale, scale);
        }
        x += 6 * scale;
      }
    }

    function render() {
      const p = C.PALETTE;
      g.fillStyle = p.water;
      g.fillRect(0, 0, C.W, C.H);
      for (let y = 0; y < C.PLAY_H; y++) {
        const banks = game.world.banks(game.distance + C.PLANE_Y - y);
        g.fillStyle = p[banks.land] || p.land;
        g.fillRect(0, y, banks.left, 1);
        g.fillRect(banks.right, y, C.W - banks.right, 1);
        for (const island of banks.islands) g.fillRect(island.left, y, island.right - island.left, 1);
      }
      g.save();
      g.beginPath();
      g.rect(0, 0, C.W, C.PLAY_H);
      g.clip();
      for (const decoration of game.world.decorations || []) {
        const y = C.PLANE_Y - (decoration.d - game.distance);
        if (y < -decoration.height || y > C.PLAY_H + decoration.height) continue;
        sprite(RR.Sprites[decoration.type], decoration.x, y, decoration.type === 'house' ?
          { 1: p.white, 2: p.black } : { 1: p.tree, 2: '#391701' });
      }
      for (const entity of game.world.entities) {
        const y = C.PLANE_Y - (entity.d - game.distance);
        if (y < -entity.height || y > C.PLAY_H + entity.height) continue;
        if (entity.type === 'bridge') {
          const banks = game.world.banks(entity.d);
          g.fillStyle = p.roadEdge;
          g.fillRect(0, Math.round(y - 9), C.W, 18);
          g.fillStyle = p.road;
          g.fillRect(0, Math.round(y - 7), C.W, 14);
          g.fillStyle = p.roadLine || '#d6d6d6';
          g.fillRect(0, Math.round(y), C.W, 1);
          if (!entity.alive) {
            g.fillStyle = p.water;
            g.fillRect(banks.left, Math.round(y - 11), banks.right - banks.left, 22);
          } else {
            for (let row = -11; row < 11; row++) {
              const inset = Math.abs(row) >= 9 ? 4 : 0;
              g.fillStyle = Math.abs(row) >= 9 ? p.bridgeEdge : Math.floor((row + 11) / 2) % 2 ? p.bridge : p.bridgeDark;
              g.fillRect(banks.left + inset, Math.round(y + row), banks.right - banks.left - inset * 2, 1);
            }
          }
        } else if (entity.alive) {
          const colors = entity.type === 'fuel' ? { 1: p.fuel, 2: p.white, 3: p.black } :
            entity.type === 'helicopter' ? { 1: p.helicopter, 2: p.helicopterCabin, 3: p.helicopterRotor } :
            entity.type === 'jet' ? { 1: p.jet, 2: p.black, 3: p.white } :
            { 1: p.tanker, 2: p.tankerDeck, 3: p.tankerHull };
          const rows = entity.type === 'helicopter' ? RR.Sprites.helicopterFrames[Math.floor(game.time * 12) % RR.Sprites.helicopterFrames.length] : RR.Sprites[entity.type];
          sprite(rows, entity.x, y, colors, entity.dir < 0);
        }
      }
      g.fillStyle = p.plane;
      for (const bullet of game.bullets) g.fillRect(Math.round(bullet.x), Math.round(C.PLANE_Y - (bullet.d - game.distance)), 1, 4);
      for (const effect of game.effects) {
        const y = C.PLANE_Y - (effect.d - game.distance);
        const rows = RR.Sprites.explosionFrames[Math.min(2, Math.floor(effect.age / 0.12))];
        sprite(rows, effect.x, y, { 1: '#ffcc43', 2: '#ed7632', 3: '#ffffff' });
      }
      if (game.phase === 'dying') {
        const rows = RR.Sprites.explosionFrames[Math.floor((T.deathTime - game.deathTimer) * 10) % RR.Sprites.explosionFrames.length];
        sprite(rows, game.x, C.PLANE_Y, { 1: p.explosion, 2: p.explosion2, 3: p.white });
      } else if (game.phase !== 'gameover') {
        const rows = game.bank < 0 ? RR.Sprites.planeLeft || RR.Sprites.plane : game.bank > 0 ? RR.Sprites.planeRight || RR.Sprites.plane : RR.Sprites.plane;
        sprite(rows, game.x, C.PLANE_Y, { 1: game.player === 1 ? p.plane2 : p.plane, 2: p.plane });
      }
      g.restore();

      g.fillStyle = p.hud || '#a8a8a8';
      g.fillRect(0, C.PLAY_H, C.W, C.H - C.PLAY_H);
      g.fillStyle = p.black;
      g.fillRect(0, 161, C.W, 1);
      const score = game.score === 1000000 ? '!!!!!!' : String(game.score);
      for (let i = 0; i < score.length; i++) sprite(scoreFont[score[i]], 99 - (score.length - 1 - i) * 8, 167, { 1: p.yellow });
      sprite(scoreFont[Math.max(0, game.lives - 1)], 60, 194, { 1: game.player === 1 ? p.plane2 : p.plane });
      sprite(signature, 88, 194, { 1: p.yellow });
      g.fillStyle = p.black;
      g.fillRect(65, 173, 39, 15);
      g.fillStyle = p.hud;
      g.fillRect(66, 174, 37, 13);
      g.fillStyle = p.black;
      for (const x of [68, 82, 98]) g.fillRect(x, 174, 1, 3);
      sprite(['1111', '1...', '1...', '111.', '1...', '1...', '1111'], 70, 182, { 1: p.black });
      sprite(['1111', '1...', '1...', '111.', '1...', '1...', '1...'], 100, 182, { 1: p.black });
      sprite(['.1.', '11.', '.1.', '.1.', '111'], 81, 178, { 1: p.black });
      sprite(['111', '..1', '111', '1..', '111'], 88, 183, { 1: p.black });
      // Analog fuel needle sweeps from E, through 1/2, to F, like the cartridge.
      const needleTop = 69 + game.fuel * 0.3;
      g.fillStyle = game.fuel < T.lowFuel && Math.floor(game.time * 5) % 2 ? '#b21d17' : p.black;
      for (let row = 0; row < 9; row++) g.fillRect(Math.round(77 + (needleTop - 77) * (1 - row / 8)), 177 + row, 2, 1);
      if (game.fuel >= 99.9) { g.fillStyle = p.yellow; g.fillRect(99, 179, 2, 8); }
      if (game.gameMode === 2) text(`P${game.player + 1}`, 126, 181, p.black);

      if (game.phase === 'title' || game.phase === 'gameover' || game.phase === 'paused' || game.phase === 'ready') {
        const title = game.phase === 'title' ? 'RIVER RAID' : game.phase === 'gameover' ? 'FIM DE JOGO' : game.phase === 'paused' ? 'PAUSA' : `JOGADOR ${game.player + 1}`;
        g.fillStyle = 'rgba(0,0,0,0.83)';
        g.fillRect(13, 53, 134, game.phase === 'title' ? 56 : 42);
        text(title, 80, 62, '#e8e84d', 1, true);
        if (game.phase === 'title') text('CAROL SHAW - 1982', 80, 76, '#ffffff', 1, true);
        text(game.phase === 'paused' ? 'P PARA CONTINUAR' : game.phase === 'ready' ? 'MOVA OU DISPARE' : 'ENTER OU BOTAO', 80, game.phase === 'title' ? 89 : 80, '#ffffff', 1, true);
        if (game.phase === 'title' || game.phase === 'gameover') text(`RECORDE ${game.highScore}`, 80, game.phase === 'title' ? 100 : 92, '#d5cfb4', 0.75, true);
      }

      // Paint native pixels into physical device pixels; CSS supplies the
      // non-square Atari aspect ratio without introducing image smoothing.
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.max(160, Math.round(rect.width * ratio));
      const height = Math.max(192, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, 0, 0, width, height);
      // One scanline per logical row, aligned to device pixels, avoids moire.
      if (height >= C.H * 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        for (let y = 0; y < C.H; y++) ctx.fillRect(0, Math.floor((y + 1) * height / C.H) - 1, width, 1);
      }
    }

    function tick(timestamp) {
      const input = RR.Input.poll();
      if (controls.some(key => input[key])) RR.Audio.unlock();
      if (last !== null) game.step(Math.min((timestamp - last) / 1000, 0.06), input);
      last = timestamp;
      syncStatus();
      render();
      requestAnimationFrame(tick);
    }
    syncStatus();
    render();
    requestAnimationFrame(tick);
  };
})(window.RR);
