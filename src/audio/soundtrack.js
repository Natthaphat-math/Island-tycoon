// audio/soundtrack.js — connects the music engine to the game.
// One instance for the page (it survives scene restarts), remembers the player's
// choices in localStorage, and follows the game: the day track plays by day
// (morning -> midday -> afternoon layers), fades out at dusk (dusk and night
// tracks come later), and coin taps are tuned to it and snapped to its beat.
(function (root) {
  'use strict';
  const KEY = 'itc-music';
  const TRACKS = ['sunlit', 'pocket', 'tidal'];
  const VOLUMES = [0.4, 0.7, 1];

  class Soundtrack {
    static get() { return root.__itcSoundtrack || (root.__itcSoundtrack = new Soundtrack()); }

    constructor() {
      this.ok = !!(root.AudioContext || root.webkitAudioContext) && !!root.IslandMusic;
      this.unlocked = false; this.phase = null; this.part = 'morning';
      this.load();
      if (!this.ok) return;
      this.eng = new IslandMusic.Engine(IslandSongs);
      this.eng.volume = this.vol;
      this.eng.quantize = this.snap ? 16 : 0;
      // the game only runs while visible, so the music pauses with it
      document.addEventListener('visibilitychange', () => {
        const c = this.eng.ctx;
        if (c) { if (document.hidden) c.suspend(); else c.resume(); }
      });
    }
    load() {
      let o = {};
      try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { o = {}; }
      this.track = TRACKS.includes(o.track) || o.track === 'off' ? o.track : 'sunlit';
      this.vol = VOLUMES.includes(o.vol) ? o.vol : 0.7;
      this.snap = o.snap !== false;
    }
    save() {
      try { localStorage.setItem(KEY, JSON.stringify({ track: this.track, vol: this.vol, snap: this.snap })); } catch (e) { /* private mode */ }
    }

    // browsers only allow sound after a tap / click / key press
    unlock() {
      if (!this.ok || this.unlocked) return;
      try { this.eng.unlock(); this.unlocked = true; this.sync(); } catch (e) { this.ok = false; }
    }
    // the game tells us what's going on; we start / stop / change layers to match
    follow(phase, part) {
      if (phase === this.phase && part === this.part) return;
      this.phase = phase; this.part = part;
      this.sync();
    }
    sync() {
      if (!this.ok || !this.unlocked) return;
      const eng = this.eng, want = this.phase === 'day' && this.track !== 'off';
      if (want) {
        const cur = eng.pendingSong || eng.song;
        if (!cur || cur.id !== this.track) eng.setSong(this.track);
        if (!eng.playing) { eng.part = this.part; eng.play(); }
        else if (eng.part !== this.part) eng.setPart(this.part);
      } else if (eng.playing) eng.stop(2.5);
    }

    coin(cur, streak, perfect) {
      if (!this.ok || !this.unlocked) return;
      this.eng.setStreak(streak);
      this.eng.coin(cur, { streak, perfect });
    }
    endStreak() { if (this.ok && this.unlocked) this.eng.setStreak(0); }

    // settings
    trackName() { return this.track === 'off' ? 'OFF' : IslandSongs.SONGS[this.track].name.toUpperCase(); }
    nextTrack() { const all = [...TRACKS, 'off']; this.track = all[(all.indexOf(this.track) + 1) % all.length]; this.save(); this.sync(); }
    volName() { return ['LOW', 'MEDIUM', 'HIGH'][VOLUMES.indexOf(this.vol)]; }
    nextVol() { this.vol = VOLUMES[(VOLUMES.indexOf(this.vol) + 1) % VOLUMES.length]; this.save(); if (this.ok) this.eng.setVolume(this.vol); }
    toggleSnap() { this.snap = !this.snap; this.save(); if (this.ok) this.eng.quantize = this.snap ? 16 : 0; }
  }

  root.Soundtrack = Soundtrack;
})(typeof window !== 'undefined' ? window : globalThis);
