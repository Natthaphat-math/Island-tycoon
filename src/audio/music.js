// audio/music.js — a tiny Web Audio synth + step sequencer for the soundtrack.
// No audio files: every instrument is built from oscillators, noise and envelopes,
// and songs (audio/songs.js) are plain note data. Because we sequence the music
// ourselves we can:
//   - fade instrument layers in and out with the time of day (morning / midday / afternoon)
//   - add a percussion layer while the player keeps a tap streak going
//   - tune coin sounds to the current chord and time them to the beat
(function (root) {
  'use strict';
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const LOOKAHEAD = 0.15;                 // seconds scheduled ahead of the clock
  const PART_FADE = 1.2;                  // time constant for layer fades (s)

  // ------------------------------------------------------------------ instruments
  // Every voice: (A, dest, t, midi, dur, vel) where A is the engine (ctx, noise, waves).
  function env(A, t, peak, attack, decay, floor = 0.0001) {
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(floor, t + attack + decay);
    return g;
  }
  function osc(A, type, freq, t, stop, dest) {
    const o = A.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest); o.start(t); o.stop(stop);
    return o;
  }
  function noise(A, t, stop, dest) {
    const s = A.ctx.createBufferSource();
    s.buffer = A.noiseBuf; s.loop = true;
    s.loopStart = 0; s.loopEnd = A.noiseBuf.duration;
    s.connect(dest); s.start(t, Math.random() * 0.9); s.stop(stop);
    return s;
  }
  function filter(A, type, freq, q, dest) {
    const f = A.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
    f.connect(dest);
    return f;
  }

  const INST = {
    // wooden bar: fundamental + a fast-dying 4th partial + a tiny click
    marimba(A, dest, t, m, dur, v) {
      const f = mtof(m), len = Math.min(0.9, 0.3 + dur * 0.5);
      const g = env(A, t, v, 0.003, len); g.connect(dest);
      osc(A, 'sine', f, t, t + len + 0.05, g);
      const g2 = env(A, t, v * 0.3, 0.002, 0.06); g2.connect(dest);
      osc(A, 'sine', f * 3.93, t, t + 0.1, g2);
      const g3 = env(A, t, v * 0.08, 0.001, 0.012); g3.connect(dest);
      osc(A, 'sine', f * 9.2, t, t + 0.03, g3);
    },
    // thumb piano: rounder, longer ring, inharmonic shimmer
    kalimba(A, dest, t, m, dur, v) {
      const f = mtof(m);
      const g = env(A, t, v, 0.002, 1.1); g.connect(dest);
      osc(A, 'sine', f, t, t + 1.2, g);
      const g2 = env(A, t, v * 0.25, 0.002, 0.12); g2.connect(dest);
      osc(A, 'sine', f * 5.4, t, t + 0.15, g2);
      const g3 = env(A, t, v * 0.12, 0.002, 0.5); g3.connect(dest);
      osc(A, 'sine', f * 2.01, t, t + 0.55, g3);
    },
    // steel drum: FM with a bright attack that mellows out, plus a soft octave
    steelpan(A, dest, t, m, dur, v) {
      const ctx = A.ctx, f = mtof(m), len = Math.min(1.4, 0.45 + dur * 0.8);
      const g = env(A, t, v, 0.006, len); g.connect(dest);
      const car = ctx.createOscillator(); car.frequency.setValueAtTime(f, t);
      const mod = ctx.createOscillator(); mod.frequency.setValueAtTime(f * 2, t);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.25);
      mod.connect(mg); mg.connect(car.frequency); car.connect(g);
      car.start(t); mod.start(t); car.stop(t + len + 0.05); mod.stop(t + len + 0.05);
      const g2 = env(A, t, v * 0.22, 0.01, len * 0.6); g2.connect(dest);
      osc(A, 'sine', f * 2, t, t + len, g2);
    },
    // warm pad: two detuned saws through a soft low-pass, slow swell
    pad(A, dest, t, m, dur, v) {
      const ctx = A.ctx, f = mtof(m), end = t + dur + 0.6;
      const lp = filter(A, 'lowpass', 1300, 0.4, dest);
      const g = ctx.createGain(); g.connect(lp);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + Math.min(0.35, dur * 0.4));
      g.gain.setValueAtTime(v, t + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      for (const d of [-8, 7]) { const o = osc(A, 'sawtooth', f, t, end, g); o.detune.value = d; }
    },
    // round plucked bass
    bass(A, dest, t, m, dur, v) {
      const f = mtof(m), len = Math.max(0.12, dur);
      const lp = filter(A, 'lowpass', 750, 0.8, dest);
      const g = A.ctx.createGain(); g.connect(lp);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.006);
      g.gain.exponentialRampToValueAtTime(v * 0.35, t + len);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08);
      osc(A, 'sine', f, t, t + len + 0.1, g);
      const g2 = A.ctx.createGain(); g2.gain.value = 0.45; g2.connect(g);
      osc(A, 'triangle', f * 2, t, t + len + 0.1, g2);
    },
    // soft kick: sine drop
    kick(A, dest, t, m, dur, v) {
      const g = env(A, t, v, 0.002, 0.28); g.connect(dest);
      const o = osc(A, 'sine', 150, t, t + 0.32, g);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    },
    rim(A, dest, t, m, dur, v) {
      const bp = filter(A, 'bandpass', 2100, 1.4, dest);
      const g = env(A, t, v, 0.001, 0.09); g.connect(bp);
      noise(A, t, t + 0.12, g);
      const g2 = env(A, t, v * 0.5, 0.001, 0.03); g2.connect(dest);
      osc(A, 'triangle', 420, t, t + 0.05, g2);
    },
    shaker(A, dest, t, m, dur, v) {
      const hp = filter(A, 'highpass', 6500, 0.7, dest);
      const g = env(A, t, v, 0.008, 0.05); g.connect(hp);
      noise(A, t, t + 0.08, g);
    },
    woodblock(A, dest, t, m, dur, v) {
      const g = env(A, t, v, 0.001, 0.07); g.connect(dest);
      osc(A, 'sine', mtof(m || 88), t, t + 0.09, g);
      const g2 = env(A, t, v * 0.3, 0.001, 0.02); g2.connect(dest);
      osc(A, 'triangle', mtof(m || 88) * 1.5, t, t + 0.04, g2);
    },
    conga(A, dest, t, m, dur, v) {
      const f = mtof(m || 57);
      const g = env(A, t, v, 0.002, 0.2); g.connect(dest);
      const o = osc(A, 'sine', f * 1.35, t, t + 0.24, g);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      const g2 = env(A, t, v * 0.25, 0.001, 0.015); g2.connect(dest);
      noise(A, t, t + 0.03, g2);
    },
    // --- chiptune voices -------------------------------------------------
    pulse(A, dest, t, m, dur, v, duty = 0.25) {
      const ctx = A.ctx, f = mtof(m), len = Math.max(0.05, dur);
      const g = ctx.createGain(); g.connect(dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.004);
      g.gain.linearRampToValueAtTime(v * 0.7, t + Math.min(0.12, len));
      g.gain.setValueAtTime(v * 0.7, t + len);
      g.gain.linearRampToValueAtTime(0.0001, t + len + 0.04);
      const o = osc(A, A.pulseWave(duty), f, t, t + len + 0.06, g);
      if (len > 0.3) {                               // delayed vibrato on held notes
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 5.8; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.012, t + 0.35);
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + len + 0.06);
      }
    },
    pulse12(A, dest, t, m, dur, v) { INST.pulse(A, dest, t, m, dur, v, 0.125); },
    pulse50(A, dest, t, m, dur, v) { INST.pulse(A, dest, t, m, dur, v, 0.5); },
    tribass(A, dest, t, m, dur, v) {
      const g = A.ctx.createGain(); g.connect(dest);
      const len = Math.max(0.06, dur * 0.9);
      g.gain.setValueAtTime(v, t); g.gain.setValueAtTime(v, t + len); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.02);
      osc(A, A.triWave, mtof(m), t, t + len + 0.03, g);
    },
    chiphat(A, dest, t, m, dur, v) {
      const hp = filter(A, 'highpass', 8000, 0.7, dest);
      const g = env(A, t, v, 0.001, 0.035); g.connect(hp);
      noise(A, t, t + 0.05, g);
    },
    chipsnare(A, dest, t, m, dur, v) {
      const bp = filter(A, 'bandpass', 1800, 0.6, dest);
      const g = env(A, t, v, 0.001, 0.14); g.connect(bp);
      noise(A, t, t + 0.16, g);
      const g2 = env(A, t, v * 0.6, 0.001, 0.07); g2.connect(dest);
      const o = osc(A, A.triWave, 220, t, t + 0.09, g2);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.07);
    },
    chipkick(A, dest, t, m, dur, v) {
      const g = env(A, t, v, 0.001, 0.14); g.connect(dest);
      const o = osc(A, A.triWave, 170, t, t + 0.16, g);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    },
    chiptom(A, dest, t, m, dur, v) {
      const g = env(A, t, v, 0.001, 0.16); g.connect(dest);
      const o = osc(A, A.triWave, mtof(m || 50) * 1.6, t, t + 0.18, g);
      o.frequency.exponentialRampToValueAtTime(mtof(m || 50), t + 0.1);
    },
  };

  // Coin sounds. Bells for the acoustic songs, blips for the chiptune one.
  // cur: bronze warm and low, silver brighter, gold with a shimmer on top.
  const COIN = {
    bell(A, dest, t, m, cur, v) {
      const f = mtof(m), bright = cur === 'bronze' ? 0.5 : cur === 'silver' ? 1 : 1.3;
      const g = env(A, t, v, 0.002, 0.55); g.connect(dest);
      osc(A, 'sine', f, t, t + 0.6, g);
      const g2 = env(A, t, v * 0.35 * bright, 0.002, 0.22); g2.connect(dest);
      osc(A, 'sine', f * 2.76, t, t + 0.25, g2);
      const g3 = env(A, t, v * 0.12 * bright, 0.001, 0.1); g3.connect(dest);
      osc(A, 'sine', f * 5.4, t, t + 0.12, g3);
      if (cur === 'gold') { const g4 = env(A, t + 0.02, v * 0.3, 0.002, 0.4); g4.connect(dest); osc(A, 'sine', f * 2, t + 0.02, t + 0.45, g4); }
    },
    blip(A, dest, t, m, cur, v) {
      const step = cur === 'bronze' ? 5 : cur === 'silver' ? 7 : 12;
      INST.pulse(A, dest, t, m, 0.05, v * 0.6, 0.5);
      INST.pulse(A, dest, t + 0.055, m + step, 0.14, v * 0.6, 0.5);
    },
  };

  // ------------------------------------------------------------------ engine
  class Engine {
    constructor(songs) {
      this.songs = songs;                    // IslandSongs
      this.ctx = null; this.song = null; this.playing = false;
      this.part = 'midday'; this.streak = 0;
      this.tuned = true; this.quantize = 16;  // 0 = off, 16 = sixteenth notes, 8 = eighth notes
      this.volume = 0.7;
      this.listeners = [];
    }

    // must be called from a user gesture (tap / click) the first time
    unlock() {
      if (!this.ctx) this.build();
      if (this.ctx.state !== 'running') this.ctx.resume();
    }
    // ctx: optional (an OfflineAudioContext renders previews)
    build(given) {
      const AC = root.AudioContext || root.webkitAudioContext;
      const ctx = this.ctx = given || new AC({ latencyHint: 'interactive' });
      const nb = this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // 8-step triangle (the stair-stepped NES kind)
      const tri = [];
      for (let i = 0; i < 32; i++) tri.push(Math.round((i < 16 ? i : 31 - i) / 15 * 7) / 7 * 2 - 1);
      this.triWave = this.waveFrom(tri);
      this.pulseWaves = {};

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 3.5;
      this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      this.tone = filter(this, 'lowpass', 18000, 0.5, this.master);
      this.master.connect(this.comp); this.comp.connect(ctx.destination);
      this.bus = ctx.createGain(); this.bus.connect(this.tone);
      // reverb: generated impulse (decaying noise)
      const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c); let last = 0;
        for (let i = 0; i < len; i++) { last = last * 0.55 + (Math.random() * 2 - 1) * 0.45; ch[i] = last * Math.pow(1 - i / len, 3.2); }
      }
      this.verb = ctx.createConvolver(); this.verb.buffer = ir;
      const vg = ctx.createGain(); vg.gain.value = 0.9; this.verb.connect(vg); vg.connect(this.tone);
      // echo: dotted-eighth delay with a darkening feedback loop
      this.delay = ctx.createDelay(2);
      this.fb = ctx.createGain(); this.fb.gain.value = 0.32;
      const dl = filter(this, 'lowpass', 2800, 0.5, this.fb);
      this.delay.connect(dl); this.fb.connect(this.delay);
      const dg = ctx.createGain(); dg.gain.value = 0.8; this.delay.connect(dg); dg.connect(this.tone);
      // coins get their own strip so they sit on top of the music
      this.coinStrip = this.strip({ rev: 0.22, del: 0.12, level: 0.9 });
      this.channels = {};
    }
    waveFrom(samples) {
      const n = samples.length, re = new Float32Array(n / 2), im = new Float32Array(n / 2);
      for (let k = 1; k < n / 2; k++) {
        let a = 0, b = 0;
        for (let i = 0; i < n; i++) { const ph = 2 * Math.PI * k * i / n; a += samples[i] * Math.cos(ph); b += samples[i] * Math.sin(ph); }
        re[k] = a / n * 2; im[k] = b / n * 2;
      }
      return this.ctx.createPeriodicWave(re, im);
    }
    pulseWave(duty) {
      if (!this.pulseWaves[duty]) {
        const n = 64, s = [];
        for (let i = 0; i < n; i++) s.push(i < n * duty ? 1 : -1);
        this.pulseWaves[duty] = this.waveFrom(s);
      }
      return this.pulseWaves[duty];
    }
    // one mixer channel: level (faded by time of day) -> optional low-pass -> pan -> bus + sends
    strip(o) {
      const ctx = this.ctx;
      const input = ctx.createGain(), level = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      level.gain.value = o.level == null ? 0 : o.level;
      input.gain.value = o.gain == null ? 1 : o.gain;
      let node = input;
      if (o.cut) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.cut; f.Q.value = 0.5; node.connect(f); node = f; }
      node.connect(level); level.connect(pan);
      if (pan.pan) pan.pan.value = o.pan || 0;
      pan.connect(this.bus);
      const rs = ctx.createGain(); rs.gain.value = o.rev || 0; pan.connect(rs); rs.connect(this.verb);
      const ds = ctx.createGain(); ds.gain.value = o.del || 0; pan.connect(ds); ds.connect(this.delay);
      return { input, level, nodes: [input, level, pan, rs, ds] };
    }

    // ---------------------------------------------------------------- transport
    setSong(id) {
      const song = this.songs.SONGS[id];
      if (!song) return;
      this.pendingSong = song;
      if (this.ctx && (!this.playing || !this.song)) this.applySong(this.ctx.currentTime);
    }
    applySong(t) {
      const song = this.pendingSong; this.pendingSong = null;
      if (!song) return;
      const old = this.channels || {};
      for (const ch of Object.values(old)) {
        ch.level.gain.setTargetAtTime(0, t, 0.05);
        setTimeout(() => ch.nodes.forEach((n) => n.disconnect()), 1500);
      }
      this.song = song;
      this.stepDur = 60 / song.bpm / 4;
      this.delay.delayTime.setValueAtTime(this.stepDur * 3, t);
      this.channels = {};
      for (const L of song.layers) this.channels[L.id] = this.strip(L);
      this.coinStrip.input.gain.value = song.coinGain || 1;
      this.k = 0;                               // step inside the song
      this.applyPart(t, true);
    }
    play() {
      this.unlock();
      if (this.playing) return;
      if (this.fading) { clearInterval(this.timer); this.fading = false; }
      if (!this.song) this.setSong(Object.keys(this.songs.SONGS)[0]);
      if (this.pendingSong) this.applySong(this.ctx.currentTime);
      this.playing = true;
      this.k = 0;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.gridT0 = this.nextTime; this.gridK0 = 0; this.abs = 0;
      this.applyPart(this.ctx.currentTime, true);
      this.timer = setInterval(() => this.pump(), 25);
      this.pump();
    }
    // fade: seconds for the music to die away (it keeps playing notes meanwhile)
    stop(fade = 0.25) {
      if (!this.playing) return;
      const t = this.ctx.currentTime;
      for (const ch of Object.values(this.channels)) { ch.level.gain.cancelScheduledValues(t); ch.level.gain.setTargetAtTime(0, t, fade / 4); }
      this.stopAt = t + fade;
      this.playing = false;
      clearInterval(this.timer);
      if (fade > 0.3) {                      // keep the sequencer going under the fade
        this.fading = true;
        this.timer = setInterval(() => { if (this.ctx.currentTime > this.stopAt) { clearInterval(this.timer); this.fading = false; } else this.pump(); }, 25);
      }
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

    // time of day: which layers play and how loud (see song.parts)
    setPart(p) { this.part = p; if (this.ctx && this.song) this.applyPart(this.ctx.currentTime); }
    applyPart(t, instant) {
      const song = this.song, part = song.parts[this.part] || {};
      for (const L of song.layers) {
        const ch = this.channels[L.id];
        let lv = part[L.id] || 0;
        if (L.id === 'streak') lv = this.streak >= 3 ? 1 : 0;
        if (!this.playing) lv = 0;
        ch.level.gain.cancelScheduledValues(t);
        if (instant) ch.level.gain.setValueAtTime(lv, t); else ch.level.gain.setTargetAtTime(lv, t, PART_FADE);
      }
      const warm = (song.warm && song.warm[this.part]) || 18000;
      this.tone.frequency.setTargetAtTime(warm, t, instant ? 0.01 : PART_FADE);
    }
    setStreak(n) {
      const was = this.streak >= 3;
      this.streak = n;
      if (!this.ctx || !this.song || !this.playing) return;
      const on = n >= 3, ch = this.channels.streak;
      if (ch && on !== was) ch.level.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.05 : 0.6);
    }

    pump() {
      const ctx = this.ctx, song = this.song;
      while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
        const total = song.bars * 16;
        // a new song waits for the next bar line
        if (this.pendingSong && this.k % 16 === 0) {
          this.applySong(this.nextTime);
          this.gridT0 = this.nextTime; this.gridK0 = this.abs;
        }
        this.playStep(this.k, this.nextTime);
        this.nextTime += this.stepDur;
        this.k = (this.k + 1) % total; this.abs++;
        if (this.k === 0) this.emit('loop');
      }
    }
    playStep(k, t) {
      const song = this.song, swing = (k % 2) ? song.swing * this.stepDur : 0;
      const info = this.songs.stepInfo(song, k);
      for (const L of song.layers) {
        const evs = L.at(info);
        if (!evs || !evs.length) continue;
        const ch = this.channels[L.id], voice = INST[L.inst];
        for (const e of evs) {
          const m = e.n == null ? null : e.n + (e.raw ? 0 : song.key);
          voice(this, ch.input, t + swing + (e.dt || 0) * this.stepDur, m, (e.len || 1) * this.stepDur, e.v == null ? 1 : e.v);
        }
      }
    }

    // where the song is right now (for UIs): bar, step and chord at the audible time
    position() {
      if (!this.playing) return null;
      const now = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
      const abs = Math.floor((now - this.gridT0) / this.stepDur) + this.gridK0;
      const total = this.song.bars * 16, k = ((abs % total) + total) % total;
      const info = this.songs.stepInfo(this.song, k);
      return { k, bar: info.bar, step: info.s, chord: info.chord.name };
    }

    // ---------------------------------------------------------------- coins
    // Tuned: the first tap plays a note of the current chord, each tap in a streak
    // climbs one step up the song's pentatonic scale. Quantized: it lands on the
    // next 16th (or 8th) of the beat instead of right away.
    coin(cur, o = {}) {
      this.unlock();
      const ctx = this.ctx, song = this.song || this.songs.SONGS[Object.keys(this.songs.SONGS)[0]];
      const now = ctx.currentTime + 0.01;
      let t = now, info;
      if (this.playing) {
        const div = this.quantize ? 16 / this.quantize : 0;
        let abs = (now - this.gridT0) / this.stepDur + this.gridK0;
        if (div) {
          abs = Math.ceil(abs / div - 1e-6) * div;
          t = this.gridT0 + (abs - this.gridK0) * this.stepDur;
          if (abs % 2) t += song.swing * this.stepDur;
        }
        const total = song.bars * 16;
        info = this.songs.stepInfo(song, ((Math.floor(abs) % total) + total) % total);
      } else info = this.songs.stepInfo(song, 0);
      const streak = Math.max(1, o.streak || 1);
      let m;
      if (this.tuned) m = this.songs.coinNote(song, info.chord, streak) + song.key;
      else m = { bronze: 79, silver: 84, gold: 88 }[cur] || 84;
      const kind = COIN[song.coin] || COIN.bell, dest = this.coinStrip.input;
      const v = 0.34 + Math.min(0.12, streak * 0.01);
      kind(this, dest, t, m, cur, v);
      if (o.perfect) {
        // sparkle: the chord's notes rising quickly an octave above
        const tones = info.chord.tones.map((x) => x + song.key);
        const top = m + 12;
        const up = [0, 1, 2].map((i) => { let n = tones[i % tones.length]; while (n < top - 12 + i * 4) n += 12; return n; });
        up.forEach((n, i) => COIN.bell(this, dest, t + 0.06 + i * this.stepDur * 0.5, n + 12, 'gold', 0.16));
      }
      return { t, delay: t - now, note: m, chord: info.chord.name };
    }

    on(fn) { this.listeners.push(fn); }
    emit(type) { for (const fn of this.listeners) try { fn(type); } catch (e) { /* ignore */ } }
  }

  root.IslandMusic = { Engine, INST, mtof };
})(typeof window !== 'undefined' ? window : globalThis);
