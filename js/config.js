window.RR = window.RR || {};

// Native Atari playfield coordinates; rendering stretches horizontal pixels.
window.RR.Config = (function () {
  'use strict';

  const PALETTE = {
    water: '#584FDA',
    river: '#584FDA',
    land: '#3EAE2C',
    landDark: '#1A7418',
    hud: '#ABABAB',
    black: '#000000',
    yellow: '#FFF456',
    plane: '#FFF456',
    player: '#FFF456',
    score: '#FFF456',
    brand: '#FFF456',
    plane2: '#000000',
    white: '#F2F2F2',
    fuel: '#D03030',
    fuelRed: '#F2F2F2',
    tanker: '#6868D8',
    tankerDeck: '#000000',
    tankerHull: '#D06028',
    helicopter: '#3EC8C8',
    helicopterCabin: '#3030A0',
    helicopterRotor: '#E87820',
    jet: '#7C80F0',
    road: '#CDCDCD',
    roadEdge: '#797979',
    roadLine: '#FFF456',
    bridge: '#C85F24',
    bridgeDark: '#833008',
    bridgeEdge: '#451904',
    explosion: '#FFF456',
    explosion2: '#FFC51D',
    tree: '#B2D241',
  };

  const TUNE = {
    minSpeed: 30,
    cruiseSpeed: 60,
    maxSpeed: 110,
    steerSpeed: 52,
    acceleration: 90,
    fuelDrain: 3.2,
    refuelRate: 60,
    bulletSpeed: 220,
    fireInterval: 0.18,
    deathTime: 1.2,
    startReserves: 3,
    maxReserves: 9,
    extraJetScore: 10000,
    lowFuel: 25,
    sectionLength: 1024,
  };

  const SCORES = { tanker: 30, helicopter: 60, fuel: 80, jet: 100, bridge: 500 };
  const C = {
    W: 160,
    H: 199,
    PLAY_H: 162,
    PLANE_Y: 150,
    PLANE_WIDTH: 7,
    PLANE_HEIGHT: 13,
    ASPECT: 4 / 3,
    PALETTE: PALETTE,
    PAL: PALETTE,
    TUNE: TUNE,
    SCORES: SCORES,
  };
  return C;
})();

window.RR.config = window.RR.Config;
