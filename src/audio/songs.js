// audio/songs.js — the day theme as note data, arranged three ways.
//
// All three arrangements share one island theme (the same chords and tune), so
// comparing them is purely about sound and groove. Notes are written in C major
// and shifted by song.key when played (all three sit in D major).
//
// Grid: 16 steps per bar (sixteenth notes). A song is 16 bars:
//   A  bars 1-8   the hook, stated twice (second ending turns to Dm)
//   B  bars 9-16  climbs higher, then a turnaround back to the hook
// Each layer is a function of the step -> notes, and song.parts says how loud each
// layer is in the morning, at midday and in the afternoon.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- the theme
  const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // one chord per half bar (8 steps)
  const CHORDS = [
    'C', 'C', 'F', 'F', 'Am', 'Am', 'G', 'G',
    'C', 'C', 'F', 'F', 'Dm', 'Dm', 'G', 'G',
    'F', 'F', 'G', 'G', 'Em', 'Em', 'Am', 'Am',
    'F', 'F', 'G', 'G', 'C', 'Am', 'Dm', 'G',
  ].map((name) => {
    const pc = NAMES[name[0]], minor = name.endsWith('m');
    return { name, pc, tones: [pc, pc + (minor ? 3 : 4), pc + 7] };
  });

  // the tune: [bar (1-16), step (0-15), midi note, length in steps]
  const E5 = 76, D5 = 74, C5 = 72, B4 = 71, A4 = 69, G4 = 67;
  const G5 = 79, A5 = 81, F5 = 77, B5 = 83, C6 = 84, D6 = 86;
  const HOOK1 = [[0, E5, 2], [3, G5, 2], [6, E5, 2], [8, D5, 2], [10, C5, 4], [14, D5, 2]];
  const HOOK2 = [[0, A5, 3], [3, G5, 3], [6, F5, 2], [8, E5, 4], [12, C5, 2], [14, D5, 2]];
  const bars = {
    1: HOOK1, 2: HOOK2,
    3: [[0, E5, 2], [2, E5, 2], [4, G5, 2], [6, A5, 4], [10, G5, 2], [12, E5, 4]],
    4: [[0, D5, 6], [6, B4, 2], [8, D5, 2], [10, G5, 6]],
    5: HOOK1, 6: HOOK2,
    7: [[0, F5, 2], [2, E5, 2], [4, D5, 2], [6, A4, 2], [8, D5, 3], [11, F5, 3], [14, A5, 2]],
    8: [[0, G5, 6], [6, A5, 2], [8, G5, 2], [10, F5, 2], [12, D5, 4]],
    9: [[0, A5, 3], [3, C6, 3], [6, A5, 2], [8, F5, 4], [12, G5, 2], [14, A5, 2]],
    10: [[0, B5, 3], [3, D6, 3], [6, B5, 2], [8, G5, 6], [14, A5, 2]],
    11: [[0, G5, 3], [3, B5, 3], [6, G5, 2], [8, E5, 4], [12, G5, 2], [14, E5, 2]],
    12: [[0, A5, 8], [12, E5, 2], [14, G5, 2]],
    13: [[0, A5, 2], [2, A5, 2], [4, C6, 2], [6, A5, 2], [8, G5, 2], [10, F5, 2], [12, E5, 4]],
    14: [[0, D5, 2], [2, E5, 2], [4, G5, 4], [8, B5, 2], [10, D6, 6]],
    15: [[0, C6, 6], [6, B5, 2], [8, A5, 4], [12, G5, 2], [14, E5, 2]],
    16: [[0, F5, 2], [2, E5, 2], [4, D5, 4], [8, G4, 2], [10, B4, 2], [12, D5, 4]],
  };
  const MELODY = new Map();                      // song step -> [{ n, len }]
  for (const [bar, notes] of Object.entries(bars)) {
    for (const [s, n, len] of notes) MELODY.set((bar - 1) * 16 + s, { n, len });
  }

  // chord tones placed inside [lo, lo + 12)
  const voice = (chord, lo) => chord.tones.map((pc) => { let n = pc; while (n < lo) n += 12; while (n >= lo + 12) n -= 12; return n; }).sort((a, b) => a - b);
  const bassRoot = (chord) => { let n = 36 + chord.pc; if (n > 43) n -= 12; return n; };

  function stepInfo(song, k) {
    const bar = Math.floor(k / 16), s = k % 16;
    return { k, bar, s, chord: CHORDS[Math.floor(k / 8)], half: Math.floor(k / 8) };
  }

  // Coin notes: first tap = a note of the current chord near C5; each tap in a
  // streak climbs one step of the major pentatonic (C D E G A), up to two octaves.
  const PENTA = [];
  for (let n = 67; n <= 100; n++) if ([0, 2, 4, 7, 9].includes(n % 12)) PENTA.push(n);
  function coinNote(song, chord, streak) {
    const start = voice(chord, 72)[0];
    let i = PENTA.findIndex((n) => n >= start);
    i = Math.min(PENTA.length - 1, i + (streak - 1));
    return PENTA[i];
  }

  // ---------------------------------------------------------------- layer helpers
  const ev = (n, len, v, extra) => Object.assign({ n, len, v }, extra);
  const at = (steps, fn) => (info) => (steps.includes(info.s) ? fn(info) : null);
  // the tune, optionally shifted by octaves / quieter
  const melody = (shift = 0, v = 1) => (info) => { const m = MELODY.get(info.k); return m ? [ev(m.n + shift, m.len, v)] : null; };
  const offbeatStabs = (lo, v) => at([2, 6, 10, 14], (i) => voice(i.chord, lo).map((n) => ev(n, 2, v * (i.s === 6 || i.s === 14 ? 1 : 0.8))));
  // rolling sixteenth arpeggio over two octaves (up then down)
  const roll = (lo, v) => (i) => {
    const t = voice(i.chord, lo), notes = [...t, ...t.map((n) => n + 12)];
    const seq = [0, 1, 2, 3, 4, 5, 4, 3];
    return [ev(notes[seq[i.s % 8]], 1, v * (i.s % 4 === 0 ? 1 : 0.7))];
  };
  const sparkle = (lo, v) => at([0, 3, 6, 11], (i) => { const t = voice(i.chord, lo); return [ev(t[[2, 1, 0, 1][[0, 3, 6, 11].indexOf(i.s)]] + (i.bar % 2 ? 12 : 0), 3, v)]; });
  const padChords = (lo, v) => (i) => (i.s % 8 === 0 ? voice(i.chord, lo).map((n) => ev(n, 8, v)) : null);
  // island bounce: root, root, fifth, root, octave, fifth
  const bounce = (v) => (i) => {
    const r = bassRoot(i.chord), pat = { 0: [r, 3], 3: [r, 2], 6: [r + 7, 2], 8: [r, 3], 11: [r + 12, 2], 14: [r + 7, 2] }[i.s];
    return pat ? [ev(pat[0], pat[1], v)] : null;
  };
  const bassLite = (v) => at([0, 8], (i) => [ev(bassRoot(i.chord), 6, v)]);
  // chiptune octave-jumping eighth-note bass
  const octaves = (v) => (i) => (i.s % 2 ? null : [ev(bassRoot(i.chord) + ((i.s / 2) % 2 ? 12 : 0), 2, v)]);
  // chiptune arpeggio: chord tones flickering twice per sixteenth
  const chipArp = (lo, v) => (i) => { const t = voice(i.chord, lo); return [ev(t[(i.s * 2) % 3], 0.5, v), ev(t[(i.s * 2 + 1) % 3], 0.5, v, { dt: 0.5 })]; };
  const hits = (map) => (i) => (map[i.s] != null ? [ev(null, 1, map[i.s])] : null);
  const everyStep = (fn) => (i) => [ev(null, 1, fn(i.s, i))];
  const congas = (v) => (i) => { const p = { 2: 62, 3: 57, 7: 57, 10: 62, 11: 57, 14: 64, 15: 62 }[i.s]; return p ? [ev(p, 1, v * (i.s === 14 ? 1 : 0.75), { raw: true })] : null; };

  // ---------------------------------------------------------------- the three arrangements
  const L = (id, inst, at, mix) => Object.assign({ id, inst, at }, mix);

  const SONGS = {
    // A: warm & cozy — marimba, steel drum, shaker and wood block
    sunlit: {
      id: 'sunlit', name: 'Sunlit Marimba', tag: 'MARIMBA + STEEL DRUM, 116 BPM', blurb: 'Steel drum tune over marimba, shaker and wood block. Warm and breezy.',
      bpm: 116, swing: 0.14, key: 2, bars: 16, coin: 'bell',
      layers: [
        L('lead', 'steelpan', melody(0, 0.5), { rev: 0.28, del: 0.16, pan: 0.05 }),
        L('leadSoft', 'marimba', melody(0, 0.5), { rev: 0.25, del: 0.14, pan: 0.05 }),
        L('stabs', 'marimba', offbeatStabs(60, 0.2), { rev: 0.18, pan: -0.25 }),
        L('roll', 'marimba', roll(67, 0.12), { rev: 0.2, pan: 0.3 }),
        L('sparkle', 'kalimba', sparkle(79, 0.14), { rev: 0.45, del: 0.3, pan: 0.35 }),
        L('pad', 'pad', padChords(55, 0.05), { rev: 0.5, pan: 0 }),
        L('bass', 'bass', bounce(0.55), {}),
        L('bassLite', 'bass', bassLite(0.5), {}),
        L('kick', 'kick', hits({ 0: 0.8, 4: 0.35, 8: 0.7, 12: 0.35 }), {}),
        L('rim', 'rim', hits({ 4: 0.3, 12: 0.34 }), { rev: 0.15, pan: 0.1 }),
        L('shaker16', 'shaker', everyStep((s) => (s % 4 === 2 ? 0.2 : s % 2 ? 0.08 : 0.13)), { pan: 0.35 }),
        L('shaker8', 'shaker', (i) => (i.s % 2 ? null : [ev(null, 1, i.s % 4 === 2 ? 0.2 : 0.11)]), { pan: 0.35 }),
        L('block', 'woodblock', (i) => ({ 3: [ev(86, 1, 0.22, { raw: true })], 10: [ev(81, 1, 0.2, { raw: true })], 14: i.bar % 2 ? [ev(86, 1, 0.15, { raw: true })] : null }[i.s] || null), { pan: -0.4, rev: 0.12 }),
        L('streak', 'conga', congas(0.4), { pan: -0.2, rev: 0.1 }),
      ],
      parts: {
        morning: { leadSoft: 0.9, stabs: 0.8, sparkle: 1, bassLite: 1, shaker8: 0.9, pad: 0.5 },
        midday: { lead: 1, stabs: 1, roll: 0.9, sparkle: 0.5, pad: 0.7, bass: 1, kick: 1, rim: 1, shaker16: 1, block: 1 },
        afternoon: { lead: 0.8, stabs: 0.8, sparkle: 0.7, pad: 1, bass: 0.9, kick: 0.6, shaker8: 0.9, block: 0.6 },
      },
      warm: { afternoon: 3400 },
    },

    // B: classic chiptune — pulse lead, stair-step triangle bass, noise drums, fast arps
    pocket: {
      id: 'pocket', name: 'Pocket Breeze', tag: 'CHIPTUNE, 126 BPM', blurb: 'Handheld-console chiptune: pulse-wave lead, fast arpeggios, noise drums.',
      bpm: 126, swing: 0, key: 2, bars: 16, coin: 'blip', coinGain: 0.8,
      layers: [
        L('lead', 'pulse', melody(0, 0.16), { cut: 5200, del: 0.14, pan: 0.05 }),
        L('echo', 'pulse12', (i) => { const m = MELODY.get(i.k - 3); return m ? [ev(m.n, Math.min(2, m.len), 0.06)] : null; }, { cut: 4200, pan: -0.35 }),
        L('leadSoft', 'pulse12', melody(0, 0.12), { cut: 4200, del: 0.2, pan: 0.05 }),
        L('arp', 'pulse50', chipArp(72, 0.045), { cut: 4500, pan: 0.3 }),
        L('bass', 'tribass', octaves(0.42), {}),
        L('bassLite', 'tribass', bassLite(0.38), {}),
        L('kick', 'chipkick', hits({ 0: 0.6, 8: 0.55, 11: 0.3 }), {}),
        L('snare', 'chipsnare', hits({ 4: 0.3, 12: 0.32 }), { pan: 0.05 }),
        L('hat8', 'chiphat', hits({ 2: 0.16, 6: 0.16, 10: 0.16, 14: 0.16 }), { pan: 0.2 }),
        L('hat16', 'chiphat', everyStep((s) => (s % 4 === 2 ? 0.17 : s % 2 ? 0.07 : 0.1)), { pan: 0.2 }),
        L('streak', 'chiptom', (i) => { const p = { 6: 52, 7: 50, 14: 55, 15: 52 }[i.s]; return p ? [ev(p, 1, 0.3, { raw: true })] : null; }, { pan: -0.1 }),
      ],
      parts: {
        morning: { leadSoft: 1, arp: 0.6, bassLite: 1, hat8: 0.8 },
        midday: { lead: 1, echo: 1, arp: 1, bass: 1, kick: 1, snare: 1, hat16: 1 },
        afternoon: { lead: 0.85, echo: 0.8, arp: 0.5, bass: 0.9, kick: 0.6, hat8: 1 },
      },
      warm: { afternoon: 3200 },
    },

    // Mix: steel drum + marimba on top, chiptune bass and drums underneath
    tidal: {
      id: 'tidal', name: 'Tidal Pixels', tag: 'STEEL DRUM + CHIPTUNE, 120 BPM', blurb: 'The mix: steel drum and marimba over a chiptune bass and drum kit.',
      bpm: 120, swing: 0.1, key: 2, bars: 16, coin: 'bell',
      layers: [
        L('lead', 'steelpan', melody(0, 0.48), { rev: 0.26, del: 0.16, pan: 0.05 }),
        L('double', 'pulse12', melody(-12, 0.05), { cut: 3200, pan: -0.2 }),
        L('leadSoft', 'marimba', melody(0, 0.5), { rev: 0.25, del: 0.14, pan: 0.05 }),
        L('stabs', 'marimba', offbeatStabs(60, 0.18), { rev: 0.18, pan: -0.25 }),
        L('arp', 'pulse50', chipArp(72, 0.03), { cut: 3800, pan: 0.3 }),
        L('sparkle', 'kalimba', sparkle(79, 0.13), { rev: 0.45, del: 0.3, pan: 0.35 }),
        L('bass', 'tribass', bounce(0.4), {}),
        L('bassLite', 'tribass', bassLite(0.34), {}),
        L('kick', 'kick', hits({ 0: 0.8, 4: 0.4, 8: 0.7, 12: 0.4 }), {}),
        L('snare', 'chipsnare', hits({ 4: 0.18, 12: 0.2 }), { rev: 0.1 }),
        L('hat', 'chiphat', hits({ 2: 0.14, 6: 0.14, 10: 0.14, 14: 0.14 }), { pan: 0.25 }),
        L('shaker16', 'shaker', everyStep((s) => (s % 4 === 2 ? 0.14 : s % 2 ? 0.06 : 0.09)), { pan: -0.3 }),
        L('shaker8', 'shaker', (i) => (i.s % 2 ? null : [ev(null, 1, i.s % 4 === 2 ? 0.18 : 0.1)]), { pan: -0.3 }),
        L('streak', 'conga', congas(0.38), { pan: -0.2, rev: 0.1 }),
      ],
      parts: {
        morning: { leadSoft: 0.9, stabs: 0.8, sparkle: 1, bassLite: 1, shaker8: 0.9 },
        midday: { lead: 1, double: 1, stabs: 1, arp: 1, sparkle: 0.4, bass: 1, kick: 1, snare: 1, hat: 1, shaker16: 1 },
        afternoon: { lead: 0.8, stabs: 0.8, sparkle: 0.7, arp: 0.5, bass: 0.9, kick: 0.6, hat: 0.8, shaker8: 0.8 },
      },
      warm: { afternoon: 3400 },
    },
  };

  const api = { SONGS, CHORDS, MELODY, stepInfo, coinNote, voice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IslandSongs = api;
})(typeof window !== 'undefined' ? window : globalThis);
