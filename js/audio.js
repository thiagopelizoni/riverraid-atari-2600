(function () {
  'use strict';
  var RR = window.RR = window.RR || {};
  var context = null;
  var master = null;
  var motor = null;
  var motorGain = null;
  var rumble = null;
  var rumbleGain = null;
  var fuelTone = null;
  var fuelGain = null;
  var alarmTone = null;
  var alarmGain = null;
  var noiseBuffer = null;
  var isRefueling = false;
  var lastMotorFrequency = -1;
  var lastMotorGain = -1;
  var lastFuelFrequency = -1;
  var lastFuelGain = -1;
  var lastAlarmGain = -1;
  var resuming = false;
  var Audio = { muted: false, available: true };

  function oscillator(frequency, type, gain) {
    var source = context.createOscillator();
    var volume = context.createGain();
    source.type = type;
    source.frequency.value = frequency;
    volume.gain.value = gain;
    source.connect(volume);
    volume.connect(master);
    source.start();
    return { source: source, gain: volume };
  }

  function initialize() {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { Audio.available = false; return; }
    try {
      context = new Context({ latencyHint: 'interactive' });
      master = context.createGain();
      master.gain.value = Audio.muted ? 0 : .34;
      master.connect(context.destination);
      var engineVoice = oscillator(55, 'square', 0);
      motor = engineVoice.source;
      motorGain = engineVoice.gain;
      var rumbleVoice = oscillator(28, 'square', 0);
      rumble = rumbleVoice.source;
      rumbleGain = rumbleVoice.gain;
      var fuelVoice = oscillator(330, 'square', 0);
      fuelTone = fuelVoice.source;
      fuelGain = fuelVoice.gain;
      var alarmVoice = oscillator(220, 'square', 0);
      alarmTone = alarmVoice.source;
      alarmGain = alarmVoice.gain;
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      var register = 0x7fff;
      for (var i = 0; i < data.length; i++) {
        var bit = (register ^ (register >> 1)) & 1;
        register = (register >> 1) | (bit << 14);
        data[i] = (register & 1) ? .8 : -.8;
      }
    } catch (error) { context = null; Audio.available = false; }
  }

  function unlock() {
    if (!context && Audio.available) initialize();
    if (context && context.state === 'suspended' && !resuming) {
      resuming = true;
      context.resume().then(function () { resuming = false; }, function () { resuming = false; });
    }
  }

  function setMuted(muted) {
    Audio.muted = !!muted;
    if (master) master.gain.setTargetAtTime(Audio.muted ? 0 : .34, context.currentTime, .015);
  }

  function ready() { return context && context.state === 'running' && !Audio.muted; }

  function tone(frequency, endFrequency, duration, gain, offset) {
    if (!ready()) return;
    var start = context.currentTime + (offset || 0);
    var source = context.createOscillator();
    var volume = context.createGain();
    source.type = 'square';
    source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(gain, start + .003);
    volume.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(volume);
    volume.connect(master);
    source.start(start);
    source.stop(start + duration + .015);
    source.onended = function () { source.disconnect(); volume.disconnect(); };
  }

  function noise(duration, gain, cutoff) {
    if (!ready()) return;
    var start = context.currentTime;
    var source = context.createBufferSource();
    var volume = context.createGain();
    var filter = context.createBiquadFilter();
    source.buffer = noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff || 2400, start);
    filter.frequency.exponentialRampToValueAtTime(160, start + duration);
    volume.gain.setValueAtTime(gain, start);
    volume.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter);
    filter.connect(volume);
    volume.connect(master);
    source.start(start);
    source.stop(start + duration);
    source.onended = function () { source.disconnect(); filter.disconnect(); volume.disconnect(); };
  }

  function engine(speed, fuel, isFlying) {
    if (!context || !motor) return;
    var now = context.currentTime;
    var normalized = Math.max(0, Math.min(1, speed > 1 ? speed / 100 : speed || 0));
    var frequency = 48 + Math.round(normalized * 11) * 6;
    var gain = isFlying ? .09 : 0;
    if (frequency !== lastMotorFrequency) {
      motor.frequency.setTargetAtTime(frequency, now, .025);
      rumble.frequency.setTargetAtTime(Math.round(frequency / 2), now, .025);
      lastMotorFrequency = frequency;
    }
    if (gain !== lastMotorGain) {
      motorGain.gain.setTargetAtTime(gain, now, .02);
      rumbleGain.gain.setTargetAtTime(isFlying ? .025 : 0, now, .02);
      lastMotorGain = gain;
    }
    var fuelFrequency = (Math.floor(now * 12) % 2) ? 440 : 330;
    if (fuel >= 99.9) fuelFrequency *= 2;
    var fuelVolume = isFlying && isRefueling ? .1 : 0;
    if (fuelVolume && fuelFrequency !== lastFuelFrequency) {
      fuelTone.frequency.setValueAtTime(fuelFrequency, now);
      lastFuelFrequency = fuelFrequency;
    }
    if (fuelVolume !== lastFuelGain) { fuelGain.gain.setTargetAtTime(fuelVolume, now, .008); lastFuelGain = fuelVolume; }
    var alarmVolume = isFlying && fuel < 25 && !isRefueling && (Math.floor(now * 5) % 2 === 0) ? .12 : 0;
    if (alarmVolume !== lastAlarmGain) { alarmGain.gain.setTargetAtTime(alarmVolume, now, .008); lastAlarmGain = alarmVolume; }
  }

  function refuel(active) { isRefueling = !!active; }
  function shot() { tone(850, 145, .075, .18); }
  function explode() { noise(.42, .44, 3000); tone(110, 28, .28, .12); }
  function bridge() { noise(.55, .5, 3900); tone(150, 35, .36, .15); }
  function extraLife() {
    [220, 330, 440, 660].forEach(function (frequency, index) { tone(frequency, frequency, .13, .14, index * .115); });
  }
  function stop() { isRefueling = false; engine(0, 100, false); }

  Audio.unlock = unlock;
  Audio.setMuted = setMuted;
  Audio.engine = engine;
  Audio.shot = shot;
  Audio.explode = explode;
  Audio.refuel = refuel;
  Audio.bridge = bridge;
  Audio.extraLife = extraLife;
  Audio.stop = stop;
  RR.Audio = Audio;
})();
