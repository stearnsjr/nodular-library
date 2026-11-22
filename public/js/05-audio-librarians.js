// ============================================================
// 6B. COZY FOLEY AUDIO, PROCEDURAL LOFI MUSIC & LITTLE LIBRARIANS
// ============================================================
let ambientLifeEnabled = true;

const AUDIO_PREFS_KEY = 'storytellers_audio_prefs_v1';
let soundEnabled = false; // Muted by default until user enables!
let foleyVolume = 0.78;
let lofiPlaying = false;
let lofiVolume = 0.44;
let lofiMood = 'sunlit'; // 'sunlit' | 'candlelight' | 'ambient'
let lofiVinylEnabled = true;
let rainPlaying = false;
let rainVolume = 0.34;

try {
  const savedAudio = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) || 'null');
  if (savedAudio && typeof savedAudio === 'object') {
    if (typeof savedAudio.soundEnabled === 'boolean') soundEnabled = savedAudio.soundEnabled;
    if (typeof savedAudio.foleyVolume === 'number') foleyVolume = Math.max(0, Math.min(1, savedAudio.foleyVolume));
    if (typeof savedAudio.lofiVolume === 'number') lofiVolume = Math.max(0, Math.min(1, savedAudio.lofiVolume));
    if (['sunlit', 'candlelight', 'ambient'].includes(savedAudio.lofiMood)) lofiMood = savedAudio.lofiMood;
    if (typeof savedAudio.lofiVinylEnabled === 'boolean') lofiVinylEnabled = savedAudio.lofiVinylEnabled;
    if (typeof savedAudio.rainVolume === 'number') rainVolume = Math.max(0, Math.min(1, savedAudio.rainVolume));
  }
} catch (err) {}

function saveAudioPrefs() {
  try {
    localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify({
      soundEnabled,
      foleyVolume,
      lofiVolume,
      lofiMood,
      lofiVinylEnabled,
      rainVolume
    }));
  } catch (err) {}
}

let cozyAudioCtx = null;
let foleyMasterGain = null;
let cozyNoiseBuffers = null;
let cozyReverbImpulse = null;

function ensureCozyAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    if (!cozyAudioCtx) {
      cozyAudioCtx = new AudioCtx();
      foleyMasterGain = cozyAudioCtx.createGain();
      foleyMasterGain.gain.setValueAtTime(foleyVolume, cozyAudioCtx.currentTime);
      foleyMasterGain.connect(cozyAudioCtx.destination);
    }
    if (cozyAudioCtx.state === 'suspended') {
      cozyAudioCtx.resume().catch(() => {});
    }
    if (!cozyNoiseBuffers) {
      const sr = cozyAudioCtx.sampleRate;
      const whiteLen = Math.floor(sr * 2.0);
      const whiteBuf = cozyAudioCtx.createBuffer(1, whiteLen, sr);
      const wd = whiteBuf.getChannelData(0);
      for (let i = 0; i < whiteLen; i++) wd[i] = Math.random() * 2 - 1;

      const pinkLen = Math.floor(sr * 3.0);
      const pinkBuf = cozyAudioCtx.createBuffer(1, pinkLen, sr);
      const pd = pinkBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < pinkLen; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        pd[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11));
        b6 = w * 0.115926;
      }

      const brownLen = Math.floor(sr * 3.0);
      const brownBuf = cozyAudioCtx.createBuffer(1, brownLen, sr);
      const bd = brownBuf.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < brownLen; i++) {
        const w = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * w) / 1.02;
        bd[i] = Math.max(-1, Math.min(1, lastOut * 3.2));
      }

      cozyNoiseBuffers = { white: whiteBuf, pink: pinkBuf, brown: brownBuf };
    }
    if (!cozyReverbImpulse) {
      const sr = cozyAudioCtx.sampleRate;
      const len = Math.floor(sr * 1.45);
      const imp = cozyAudioCtx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = imp.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const decay = Math.pow(1 - i / len, 2.6);
          const raw = (Math.random() * 2 - 1) * decay;
          lp = lp * 0.72 + raw * 0.28;
          d[i] = lp;
        }
      }
      cozyReverbImpulse = imp;
    }
    return cozyAudioCtx;
  } catch (err) {
    return null;
  }
}

function foleyJitter(val, spread = 0.06) {
  return val * (1 + (Math.random() * 2 - 1) * spread);
}

function playFilteredNoiseBurst(ctx, dest, buf, startTime, dur, opts = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const maxOffset = Math.max(0, buf.duration - dur - 0.05);
  const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType || 'bandpass';
  const fStart = opts.freqStart || 1600;
  const fEnd = opts.freqEnd || fStart;
  filter.frequency.setValueAtTime(Math.max(40, fStart), startTime);
  if (fEnd !== fStart) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), startTime + dur);
  }
  if (opts.Q != null) filter.Q.setValueAtTime(opts.Q, startTime);

  const gain = ctx.createGain();
  const peak = opts.gainPeak || 0.15;
  const atk = Math.min(dur * 0.45, opts.attack || 0.014);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + atk);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

  src.connect(filter).connect(gain).connect(dest);
  src.start(startTime, offset, dur + 0.02);
}

function playCozySound(kind = 'page', opts = {}) {
  if (!soundEnabled && !opts.preview) return;
  const ctx = ensureCozyAudio();
  if (!ctx || !foleyMasterGain) return;
  try {
    const now = ctx.currentTime;
    const dest = opts.preview ? ctx.destination : foleyMasterGain;
    const scale = opts.preview ? Math.max(0.35, foleyVolume) : 1.0;

    if (kind === 'page' || kind === 'page-turn' || kind === 'paper') {
      // Tactile two-stage parchment page turn: thumb lift crinkle + curved paper swish
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now, 0.032, {
        filterType: 'highpass', freqStart: foleyJitter(3100, 0.08), Q: 0.7, gainPeak: 0.05 * scale, attack: 0.006
      });
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now + 0.012, foleyJitter(0.145, 0.08), {
        filterType: 'bandpass', freqStart: foleyJitter(1350, 0.07), freqEnd: foleyJitter(2650, 0.08), Q: 1.35, gainPeak: 0.24 * scale, attack: 0.032
      });
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now + 0.115, 0.055, {
        filterType: 'bandpass', freqStart: foleyJitter(1900, 0.06), freqEnd: foleyJitter(1050, 0.06), Q: 1.1, gainPeak: 0.09 * scale, attack: 0.012
      });
    } else if (kind === 'page-flip') {
      // Brisk chapter-tab cardstock flick
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.085, {
        filterType: 'bandpass', freqStart: foleyJitter(2100, 0.07), freqEnd: foleyJitter(3400, 0.07), Q: 1.6, gainPeak: 0.2 * scale, attack: 0.012
      });
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now + 0.048, 0.026, {
        filterType: 'bandpass', freqStart: foleyJitter(2800, 0.08), Q: 2.2, gainPeak: 0.08 * scale, attack: 0.004
      });
    } else if (kind === 'book-open') {
      // Hardcover leather/cloth lift + lush fanning flutter of pages settling open
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(108, 0.06), now);
      osc.frequency.exponentialRampToValueAtTime(foleyJitter(162, 0.06), now + 0.07);
      og.gain.setValueAtTime(0.0001, now);
      og.gain.linearRampToValueAtTime(0.12 * scale, now + 0.014);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
      osc.connect(og).connect(dest);
      osc.start(now);
      osc.stop(now + 0.105);

      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now + 0.035, 0.19, {
        filterType: 'bandpass', freqStart: foleyJitter(1050, 0.07), freqEnd: foleyJitter(2500, 0.07), Q: 1.1, gainPeak: 0.25 * scale, attack: 0.045
      });
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now + 0.095, 0.11, {
        filterType: 'bandpass', freqStart: foleyJitter(3200, 0.08), freqEnd: foleyJitter(1800, 0.08), Q: 1.4, gainPeak: 0.08 * scale, attack: 0.02
      });
    } else if (kind === 'book-close') {
      // Folding pages whoosh followed by a satisfying muted hardcover clap
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.095, {
        filterType: 'bandpass', freqStart: foleyJitter(1850, 0.07), freqEnd: foleyJitter(680, 0.07), Q: 1.15, gainPeak: 0.18 * scale, attack: 0.018
      });
      const tClap = now + 0.058;
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(172, 0.06), tClap);
      osc.frequency.exponentialRampToValueAtTime(foleyJitter(54, 0.06), tClap + 0.11);
      og.gain.setValueAtTime(0.28 * scale, tClap);
      og.gain.exponentialRampToValueAtTime(0.0001, tClap + 0.125);
      osc.connect(og).connect(dest);
      osc.start(tClap);
      osc.stop(tClap + 0.135);

      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.brown, tClap, 0.09, {
        filterType: 'lowpass', freqStart: foleyJitter(540, 0.08), freqEnd: 180, Q: 0.8, gainPeak: 0.24 * scale, attack: 0.004
      });
    } else if (kind === 'scroll-open') {
      // Unrolling parchment scroll with wooden dowel roll
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.25, {
        filterType: 'bandpass', freqStart: foleyJitter(820, 0.06), freqEnd: foleyJitter(2150, 0.07), Q: 1.3, gainPeak: 0.23 * scale, attack: 0.045
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(foleyJitter(280, 0.06), now + 0.19);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.24);
      og.gain.setValueAtTime(0.09 * scale, now + 0.19);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.connect(og).connect(dest);
      osc.start(now + 0.19);
      osc.stop(now + 0.26);
    } else if (kind === 'scroll-close') {
      // Rolling parchment scroll shut + gentle wooden dowel tap
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.2, {
        filterType: 'bandpass', freqStart: foleyJitter(2050, 0.07), freqEnd: foleyJitter(880, 0.07), Q: 1.25, gainPeak: 0.2 * scale, attack: 0.03
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(310, 0.06), now + 0.16);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.21);
      og.gain.setValueAtTime(0.11 * scale, now + 0.16);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(og).connect(dest);
      osc.start(now + 0.16);
      osc.stop(now + 0.23);
    } else if (kind === 'thump' || kind === 'shelve') {
      // Sliding a volume onto an oak bookshelf with warm wooden knock
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.052, {
        filterType: 'bandpass', freqStart: foleyJitter(540, 0.08), freqEnd: 820, Q: 1.0, gainPeak: 0.09 * scale, attack: 0.01
      });
      const tHit = now + 0.025;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(156, 0.07), tHit);
      osc.frequency.exponentialRampToValueAtTime(foleyJitter(56, 0.07), tHit + 0.12);
      gain.gain.setValueAtTime(0.24 * scale, tHit);
      gain.gain.exponentialRampToValueAtTime(0.0001, tHit + 0.13);
      osc.connect(gain).connect(dest);
      osc.start(tHit);
      osc.stop(tHit + 0.14);

      const wood = ctx.createOscillator();
      const wg = ctx.createGain();
      wood.type = 'sine';
      wood.frequency.setValueAtTime(foleyJitter(325, 0.08), tHit);
      wood.frequency.exponentialRampToValueAtTime(190, tHit + 0.045);
      wg.gain.setValueAtTime(0.08 * scale, tHit);
      wg.gain.exponentialRampToValueAtTime(0.0001, tHit + 0.05);
      wood.connect(wg).connect(dest);
      wood.start(tHit);
      wood.stop(tHit + 0.055);
    } else if (kind === 'book-slide') {
      // Soft cloth-on-oak book slide + gentle desk tap
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.125, {
        filterType: 'bandpass', freqStart: foleyJitter(620, 0.08), freqEnd: foleyJitter(1120, 0.08), Q: 1.15, gainPeak: 0.15 * scale, attack: 0.025
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(142, 0.06), now + 0.085);
      osc.frequency.exponentialRampToValueAtTime(68, now + 0.145);
      og.gain.setValueAtTime(0.11 * scale, now + 0.085);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.155);
      osc.connect(og).connect(dest);
      osc.start(now + 0.085);
      osc.stop(now + 0.165);
    } else if (kind === 'drawer-open') {
      // Wooden card catalog drawer sliding open
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.16, {
        filterType: 'bandpass', freqStart: foleyJitter(360, 0.06), freqEnd: foleyJitter(640, 0.06), Q: 1.4, gainPeak: 0.14 * scale, attack: 0.03
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(foleyJitter(1180, 0.05), now + 0.02);
      og.gain.setValueAtTime(0.032 * scale, now + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
      osc.connect(og).connect(dest);
      osc.start(now + 0.02);
      osc.stop(now + 0.07);
    } else if (kind === 'drawer-close') {
      // Wooden card catalog drawer gliding shut with muted stop
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.12, {
        filterType: 'bandpass', freqStart: foleyJitter(590, 0.06), freqEnd: foleyJitter(310, 0.06), Q: 1.35, gainPeak: 0.12 * scale, attack: 0.02
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(124, 0.06), now + 0.09);
      osc.frequency.exponentialRampToValueAtTime(54, now + 0.16);
      og.gain.setValueAtTime(0.15 * scale, now + 0.09);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      osc.connect(og).connect(dest);
      osc.start(now + 0.09);
      osc.stop(now + 0.175);
    } else if (kind === 'stamp') {
      // Vintage inked rubber stamp thud
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(foleyJitter(205, 0.06), now);
      osc.frequency.exponentialRampToValueAtTime(72, now + 0.072);
      og.gain.setValueAtTime(0.24 * scale, now);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.082);
      osc.connect(og).connect(dest);
      osc.start(now);
      osc.stop(now + 0.09);

      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, now, 0.042, {
        filterType: 'bandpass', freqStart: foleyJitter(1500, 0.08), freqEnd: 850, Q: 1.5, gainPeak: 0.15 * scale, attack: 0.004
      });
    } else if (kind === 'ribbon') {
      // Airy silk bookmark ribbon swish
      playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now, 0.17, {
        filterType: 'bandpass', freqStart: foleyJitter(3100, 0.07), freqEnd: foleyJitter(5100, 0.07), Q: 2.2, gainPeak: 0.09 * scale, attack: 0.04
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(foleyJitter(1318, 0.04), now + 0.05);
      og.gain.setValueAtTime(0.025 * scale, now + 0.05);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(og).connect(dest);
      osc.start(now + 0.05);
      osc.stop(now + 0.23);
    } else if (kind === 'crumple') {
      // Parchment crumple tossed into wicker recycling basket
      [0, 0.048, 0.105].forEach((delay, idx) => {
        playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now + delay, 0.052, {
          filterType: 'bandpass', freqStart: foleyJitter(2200 + idx * 550, 0.12), freqEnd: foleyJitter(1600, 0.12), Q: 1.8, gainPeak: (0.13 - idx * 0.02) * scale, attack: 0.007
        });
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(foleyJitter(145, 0.08), now + 0.13);
      osc.frequency.exponentialRampToValueAtTime(74, now + 0.21);
      og.gain.setValueAtTime(0.12 * scale, now + 0.13);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(og).connect(dest);
      osc.start(now + 0.13);
      osc.stop(now + 0.23);
    } else if (kind === 'dice') {
      // Staggered wooden/resin D&D dice clatter on an oak table
      const bounces = [0, 0.055, 0.102, 0.142];
      bounces.forEach((delay, idx) => {
        const amp = Math.pow(0.72, idx) * scale;
        playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now + delay, 0.024, {
          filterType: 'bandpass', freqStart: foleyJitter(1750 + idx * 240, 0.12), Q: 2.8, gainPeak: 0.18 * amp, attack: 0.002
        });
        const osc = ctx.createOscillator();
        const og = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(foleyJitter(540 + idx * 95, 0.12), now + delay);
        osc.frequency.exponentialRampToValueAtTime(220, now + delay + 0.028);
        og.gain.setValueAtTime(0.12 * amp, now + delay);
        og.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.032);
        osc.connect(og).connect(dest);
        osc.start(now + delay);
        osc.stop(now + delay + 0.036);
      });
    } else if (kind === 'lamp') {
      // Brass reading lamp pull-chain click
      [0, 0.026].forEach((delay, idx) => {
        playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, now + delay, 0.018, {
          filterType: 'bandpass', freqStart: idx === 0 ? 2500 : 3300, Q: 3.2, gainPeak: 0.14 * scale, attack: 0.002
        });
      });
      const osc = ctx.createOscillator();
      const og = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(920, now + 0.024);
      og.gain.setValueAtTime(0.038 * scale, now + 0.024);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      osc.connect(og).connect(dest);
      osc.start(now + 0.024);
      osc.stop(now + 0.095);
    } else if (kind === 'chime') {
      // Gentle two-note brass desk bell chime with soft harmonic shimmer
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const gain2 = ctx.createGain();
      osc.type = 'sine';
      osc2.type = 'sine';
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.setValueAtTime(988, now + 0.068);
      osc2.frequency.setValueAtTime(1480, now);
      osc2.frequency.setValueAtTime(1976, now + 0.068);
      gain.gain.setValueAtTime(0.085 * scale, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      gain2.gain.setValueAtTime(0.022 * scale, now);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      osc.connect(gain).connect(dest);
      osc2.connect(gain2).connect(dest);
      osc.start(now); osc2.start(now);
      osc.stop(now + 0.35); osc2.stop(now + 0.25);
    } else if (kind === 'purr') {
      // Cozy low cat purr rumble for Mochi
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(foleyJitter(70, 0.04), now);
      lfo.frequency.setValueAtTime(24.5, now);
      lfoGain.gain.setValueAtTime(0.048 * scale, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.095 * scale, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.64);
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(gain).connect(dest);
      lfo.start(now); osc.start(now);
      lfo.stop(now + 0.66); osc.stop(now + 0.66);
    }
  } catch (err) {}
}

// ============================================================
// 6C. PROCEDURAL COZY LOFI STUDY MUSIC & WINDOW RAIN ENGINE
// ============================================================
const LOFI_MOODS = {
  sunlit: {
    name: 'Sunlit Study',
    bpm: 74,
    drums: true,
    filterHz: 2850,
    chords: [
      { bass: 41, notes: [53, 57, 60, 64, 67] }, // Fmaj9
      { bass: 40, notes: [52, 55, 59, 62, 67] }, // Em7(11)
      { bass: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
      { bass: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
      { bass: 41, notes: [53, 57, 60, 64, 67] }, // Fmaj9
      { bass: 43, notes: [55, 59, 62, 65, 69] }, // G13
      { bass: 45, notes: [57, 60, 64, 67, 71] }, // Am9
      { bass: 38, notes: [50, 53, 57, 60, 64] }  // Dm9
    ],
    scale: [60, 62, 64, 67, 69, 72, 74, 76, 79]
  },
  candlelight: {
    name: 'Candlelight Jazz',
    bpm: 65,
    drums: true,
    filterHz: 2150,
    chords: [
      { bass: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
      { bass: 43, notes: [55, 59, 62, 65, 69] }, // G13
      { bass: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
      { bass: 45, notes: [55, 58, 61, 64, 69] }, // A7b9
      { bass: 46, notes: [53, 57, 58, 62, 65] }, // Bbmaj7
      { bass: 45, notes: [55, 57, 62, 64, 67] }, // A7sus4
      { bass: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
      { bass: 40, notes: [52, 55, 58, 62, 64] }  // Em7b5
    ],
    scale: [57, 60, 62, 64, 65, 67, 69, 72, 74]
  },
  ambient: {
    name: 'Ambient Keys',
    bpm: 60,
    drums: false,
    filterHz: 2550,
    chords: [
      { bass: 43, notes: [55, 59, 62, 66, 69] }, // Gmaj9
      { bass: 40, notes: [52, 55, 59, 62, 66] }, // Em9
      { bass: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
      { bass: 38, notes: [50, 54, 57, 62, 64] }  // D6/9
    ],
    scale: [62, 64, 66, 67, 69, 71, 74, 76, 78]
  }
};

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

let lofiBus = null;
let lofiSchedulerId = null;
let lofiNextStepTime = 0;
let lofiStepIndex = 0;
let lofiBarIndex = 0;
let lofiVinylSource = null;
let lofiVinylGain = null;

function ensureLofiBus() {
  const ctx = ensureCozyAudio();
  if (!ctx) return null;
  if (lofiBus) return lofiBus;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);

  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.frequency.setValueAtTime(LOFI_MOODS[lofiMood].filterHz, ctx.currentTime);
  toneFilter.Q.setValueAtTime(0.55, ctx.currentTime);

  const dryGain = ctx.createGain();
  dryGain.gain.setValueAtTime(0.8, ctx.currentTime);

  const wetGain = ctx.createGain();
  wetGain.gain.setValueAtTime(0.32, ctx.currentTime);

  const convolver = ctx.createConvolver();
  convolver.buffer = cozyReverbImpulse;

  toneFilter.connect(dryGain).connect(master);
  toneFilter.connect(convolver).connect(wetGain).connect(master);
  master.connect(ctx.destination);

  lofiBus = { master, toneFilter, dryGain, wetGain };
  return lofiBus;
}

function syncLofiVinylNode() {
  const ctx = cozyAudioCtx;
  if (!ctx || !lofiBus) return;
  const shouldRun = lofiPlaying && lofiVinylEnabled;
  if (shouldRun && !lofiVinylSource) {
    const src = ctx.createBufferSource();
    src.buffer = cozyNoiseBuffers.pink;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1600, ctx.currentTime);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4800, ctx.currentTime);
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0.0001, ctx.currentTime);
    vg.gain.setTargetAtTime(0.026, ctx.currentTime, 0.25);
    src.connect(hp).connect(lp).connect(vg).connect(lofiBus.master);
    src.start(ctx.currentTime);
    lofiVinylSource = src;
    lofiVinylGain = vg;
  } else if (!shouldRun && lofiVinylSource) {
    const oldSrc = lofiVinylSource;
    const oldGain = lofiVinylGain;
    lofiVinylSource = null;
    lofiVinylGain = null;
    try {
      oldGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      setTimeout(() => { try { oldSrc.stop(); oldSrc.disconnect(); } catch (e) {} }, 350);
    } catch (e) {}
  }
}

function scheduleRhodesNote(ctx, dest, midi, time, dur, vel = 0.12, isBell = false) {
  const freq = midiToHz(midi) * (1 + (Math.random() - 0.5) * 0.0022);
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const env = ctx.createGain();
  const tineEnv = ctx.createGain();

  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, time);
  osc2.type = isBell ? 'sine' : 'triangle';
  osc2.frequency.setValueAtTime(freq * (isBell ? 3 : 2), time);

  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(vel, time + 0.018);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, vel * 0.35), time + dur * 0.45);
  env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  tineEnv.gain.setValueAtTime(0.0001, time);
  tineEnv.gain.linearRampToValueAtTime(vel * (isBell ? 0.32 : 0.16), time + 0.008);
  tineEnv.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(0.28, dur * 0.35));

  osc1.connect(env).connect(dest);
  osc2.connect(tineEnv).connect(dest);
  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + dur + 0.05);
  osc2.stop(time + dur + 0.05);
}

function scheduleLofiBass(ctx, dest, midi, time, dur, vel = 0.22) {
  const osc = ctx.createOscillator();
  const lp = ctx.createBiquadFilter();
  const env = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(midiToHz(midi), time);
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(240, time);
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(vel, time + 0.025);
  env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.connect(lp).connect(env).connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.04);
}

function scheduleLofiDrum(ctx, dest, kind, time) {
  if (kind === 'kick') {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(112, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    g.gain.setValueAtTime(0.26, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
    osc.connect(g).connect(dest);
    osc.start(time);
    osc.stop(time + 0.2);
  } else if (kind === 'snare') {
    playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.pink, time, 0.11, {
      filterType: 'bandpass', freqStart: 1350, freqEnd: 850, Q: 0.9, gainPeak: 0.11, attack: 0.005
    });
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, time);
    osc.frequency.exponentialRampToValueAtTime(115, time + 0.055);
    g.gain.setValueAtTime(0.075, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.065);
    osc.connect(g).connect(dest);
    osc.start(time);
    osc.stop(time + 0.07);
  } else if (kind === 'hat') {
    playFilteredNoiseBurst(ctx, dest, cozyNoiseBuffers.white, time, 0.036, {
      filterType: 'highpass', freqStart: 5200, Q: 0.7, gainPeak: 0.032, attack: 0.003
    });
  }
}

function scheduleLofiStep(stepInBar, barIdx, time) {
  const ctx = cozyAudioCtx;
  if (!ctx || !lofiBus) return;
  const mood = LOFI_MOODS[lofiMood] || LOFI_MOODS.sunlit;
  const stepDur = (60 / mood.bpm) / 2; // eighth-note grid (8 steps per bar)
  const swingOffset = (stepInBar % 2 === 1) ? stepDur * 0.14 : 0;
  const t = time + swingOffset;

  const chord = mood.chords[barIdx % mood.chords.length];

  // Lush strummed Rhodes chord on beat 1 (and gentle re-voicing on beat 3.5 occasionally)
  if (stepInBar === 0) {
    const barDur = stepDur * 7.8;
    chord.notes.forEach((m, idx) => {
      const strumDelay = idx * (mood.drums ? 0.032 : 0.075) + Math.random() * 0.008;
      scheduleRhodesNote(ctx, lofiBus.toneFilter, m, t + strumDelay, barDur, 0.062 - idx * 0.004, !mood.drums && idx >= 3);
    });
    scheduleLofiBass(ctx, lofiBus.toneFilter, chord.bass, t, stepDur * 4.2, mood.drums ? 0.2 : 0.15);
  } else if (stepInBar === 4) {
    const bassNote = (barIdx % 2 === 0) ? chord.bass + 7 : chord.bass;
    scheduleLofiBass(ctx, lofiBus.toneFilter, bassNote, t, stepDur * 3.6, mood.drums ? 0.14 : 0.11);
    if (!mood.drums) {
      // Gentle upper arpeggio sparkle in Ambient Keys mode
      const topNote = chord.notes[chord.notes.length - 1] + 12;
      scheduleRhodesNote(ctx, lofiBus.toneFilter, topNote, t + 0.04, stepDur * 3.8, 0.042, true);
    }
  } else if (stepInBar === 6 && Math.random() < 0.45) {
    // Soft offbeat chord ghost
    const pick = chord.notes.slice(1, 4);
    pick.forEach((m, idx) => {
      scheduleRhodesNote(ctx, lofiBus.toneFilter, m, t + idx * 0.025, stepDur * 2.1, 0.036, false);
    });
  }

  // Sparse, dreamy pentatonic / jazz melody notes
  const melChance = mood.drums ? 0.28 : 0.36;
  if (stepInBar !== 0 && Math.random() < melChance) {
    const note = mood.scale[Math.floor(Math.random() * mood.scale.length)];
    const dur = stepDur * (1.8 + Math.random() * 2.2);
    scheduleRhodesNote(ctx, lofiBus.toneFilter, note, t + 0.01, dur, 0.048 + Math.random() * 0.02, !mood.drums);
  }

  // Soft dusty boom-bap drums
  if (mood.drums) {
    if (stepInBar === 0 || (stepInBar === 5 && Math.random() < 0.72) || (stepInBar === 3 && Math.random() < 0.28)) {
      scheduleLofiDrum(ctx, lofiBus.toneFilter, 'kick', t);
    }
    if (stepInBar === 2 || stepInBar === 6) {
      scheduleLofiDrum(ctx, lofiBus.toneFilter, 'snare', t + 0.008);
    }
    if (stepInBar % 2 === 0 || Math.random() < 0.65) {
      scheduleLofiDrum(ctx, lofiBus.toneFilter, 'hat', t);
    }
  }

  // Subtle random vinyl dust pop
  if (lofiVinylEnabled && Math.random() < 0.22) {
    const popTime = t + Math.random() * stepDur * 0.85;
    playFilteredNoiseBurst(ctx, lofiBus.master, cozyNoiseBuffers.white, popTime, 0.007, {
      filterType: 'bandpass', freqStart: 2400 + Math.random() * 2200, Q: 3.5, gainPeak: 0.028, attack: 0.001
    });
  }
}

function lofiSchedulerTick() {
  if (!lofiPlaying || !cozyAudioCtx) return;
  const mood = LOFI_MOODS[lofiMood] || LOFI_MOODS.sunlit;
  const stepDur = (60 / mood.bpm) / 2;
  while (lofiNextStepTime < cozyAudioCtx.currentTime + 0.35) {
    scheduleLofiStep(lofiStepIndex, lofiBarIndex, lofiNextStepTime);
    lofiNextStepTime += stepDur;
    lofiStepIndex++;
    if (lofiStepIndex >= 8) {
      lofiStepIndex = 0;
      lofiBarIndex++;
    }
  }
}

function startLofiMusic() {
  const bus = ensureLofiBus();
  if (!bus || !cozyAudioCtx) return;
  lofiPlaying = true;
  const now = cozyAudioCtx.currentTime;
  bus.toneFilter.frequency.setTargetAtTime(LOFI_MOODS[lofiMood].filterHz, now, 0.2);
  bus.master.gain.setTargetAtTime(Math.max(0.0001, lofiVolume * 0.85), now, 0.28);
  syncLofiVinylNode();
  if (!lofiSchedulerId) {
    lofiStepIndex = 0;
    lofiNextStepTime = now + 0.08;
    lofiSchedulerTick();
    lofiSchedulerId = setInterval(lofiSchedulerTick, 120);
  }
}

function stopLofiMusic() {
  lofiPlaying = false;
  if (lofiSchedulerId) {
    clearInterval(lofiSchedulerId);
    lofiSchedulerId = null;
  }
  syncLofiVinylNode();
  if (lofiBus && cozyAudioCtx) {
    lofiBus.master.gain.setTargetAtTime(0.0001, cozyAudioCtx.currentTime, 0.16);
  }
}

function setLofiMood(moodKey) {
  if (!LOFI_MOODS[moodKey]) return;
  lofiMood = moodKey;
  saveAudioPrefs();
  if (lofiBus && cozyAudioCtx) {
    lofiBus.toneFilter.frequency.setTargetAtTime(LOFI_MOODS[lofiMood].filterHz, cozyAudioCtx.currentTime, 0.25);
  }
}

function setLofiVolume(v) {
  lofiVolume = Math.max(0, Math.min(1, Number(v) || 0));
  saveAudioPrefs();
  if (lofiPlaying && lofiBus && cozyAudioCtx) {
    lofiBus.master.gain.setTargetAtTime(Math.max(0.0001, lofiVolume * 0.85), cozyAudioCtx.currentTime, 0.08);
  }
}

function setFoleyVolume(v) {
  foleyVolume = Math.max(0, Math.min(1, Number(v) || 0));
  saveAudioPrefs();
  if (foleyMasterGain && cozyAudioCtx) {
    foleyMasterGain.gain.setTargetAtTime(foleyVolume, cozyAudioCtx.currentTime, 0.05);
  }
}

function setLofiVinylEnabled(enabled) {
  lofiVinylEnabled = Boolean(enabled);
  saveAudioPrefs();
  syncLofiVinylNode();
}

// Cozy Rain on Library Windows ambience
let rainNodes = null;

function startLibraryRain() {
  const ctx = ensureCozyAudio();
  if (!ctx) return;
  rainPlaying = true;
  if (rainNodes) {
    rainNodes.master.gain.setTargetAtTime(Math.max(0.0001, rainVolume * 0.45), ctx.currentTime, 0.35);
    return;
  }
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.setTargetAtTime(Math.max(0.0001, rainVolume * 0.45), now, 0.4);
  master.connect(ctx.destination);

  // Warm steady window patter
  const lowSrc = ctx.createBufferSource();
  lowSrc.buffer = cozyNoiseBuffers.brown;
  lowSrc.loop = true;
  const lowFilter = ctx.createBiquadFilter();
  lowFilter.type = 'bandpass';
  lowFilter.frequency.setValueAtTime(420, now);
  lowFilter.Q.setValueAtTime(0.65, now);
  const lowGain = ctx.createGain();
  lowGain.gain.setValueAtTime(0.55, now);
  lowSrc.connect(lowFilter).connect(lowGain).connect(master);

  // Soft misty drizzle with gentle slow breathing LFO
  const hiSrc = ctx.createBufferSource();
  hiSrc.buffer = cozyNoiseBuffers.pink;
  hiSrc.loop = true;
  const hiFilter = ctx.createBiquadFilter();
  hiFilter.type = 'bandpass';
  hiFilter.frequency.setValueAtTime(1750, now);
  hiFilter.Q.setValueAtTime(0.75, now);
  const hiGain = ctx.createGain();
  hiGain.gain.setValueAtTime(0.28, now);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.setValueAtTime(0.13, now);
  lfoGain.gain.setValueAtTime(340, now);
  lfo.connect(lfoGain).connect(hiFilter.frequency);

  hiSrc.connect(hiFilter).connect(hiGain).connect(master);

  lowSrc.start(now);
  hiSrc.start(now);
  lfo.start(now);
  rainNodes = { master, lowSrc, hiSrc, lfo };
}

function stopLibraryRain() {
  rainPlaying = false;
  if (!rainNodes || !cozyAudioCtx) return;
  const old = rainNodes;
  rainNodes = null;
  try {
    old.master.gain.setTargetAtTime(0.0001, cozyAudioCtx.currentTime, 0.2);
    setTimeout(() => {
      try { old.lowSrc.stop(); old.hiSrc.stop(); old.lfo.stop(); old.master.disconnect(); } catch (e) {}
    }, 650);
  } catch (e) {}
}

function setRainVolume(v) {
  rainVolume = Math.max(0, Math.min(1, Number(v) || 0));
  saveAudioPrefs();
  if (rainPlaying && rainNodes && cozyAudioCtx) {
    rainNodes.master.gain.setTargetAtTime(Math.max(0.0001, rainVolume * 0.45), cozyAudioCtx.currentTime, 0.08);
  }
}

function muteAllLibraryAudio() {
  soundEnabled = false;
  saveAudioPrefs();
  if (lofiPlaying) stopLofiMusic();
  if (rainPlaying) stopLibraryRain();
}


const LIBRARIAN_PERSONAS = [
  { name: 'Archivist Maren', coat: '#567d5c', coatDeep: '#335238', hair: '#6e3f25', hat: 'bun' },
  { name: 'Junior Page Pip', coat: '#d4953b', coatDeep: '#8c5b19', hair: '#4a2e1b', hat: 'cap' },
  { name: 'Head Librarian Orin', coat: '#6e476b', coatDeep: '#442642', hair: '#f3ead8', hat: 'mustache' }
];
let activeLibrarians = [];
let librarianRafId = null;
let librarianSpawnCounter = 0;

function isBookCarriedByLibrarian(bookId) {
  if (!bookId || activeLibrarians.length === 0) return false;
  return activeLibrarians.some(a => a.kind === 'book' && (a.direction === 'out' || a.direction === 'transfer') && a.bookId === bookId && !a.arrived);
}

function captureTabletopItemScreenPoint(source = 'pile', itemId = null) {
  if (itemId) {
    const sel = source === 'study'
      ? `#corner-study-stack [data-study-stack-book="${itemId}"]`
      : `#corner-pile-stack [data-pile-book-id="${itemId}"], #corner-pile-stack [data-pile-page-id="${itemId}"]`;
    const itemEl = document.querySelector(sel);
    if (itemEl) {
      const r = itemEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: r.left + r.width * 0.42, y: r.top + r.height * 0.5 };
      }
    }
  }
  const zoneEl = source === 'study'
    ? (document.getElementById('corner-study-zone') || document.getElementById('corner-tabletop-wrap'))
    : (document.getElementById('corner-pile-zone') || document.getElementById('corner-tabletop-wrap'));
  if (zoneEl) {
    const r = zoneEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + r.width * 0.46, y: r.top + Math.min(24, r.height * 0.25) };
    }
  }
  return { x: window.innerWidth - 210, y: window.innerHeight - 95 };
}

function resolveLibrarianTargetWorldPoint(bookId, hallId) {
  if (bookId && layoutCache.books && layoutCache.books[bookId]) {
    const bEntry = layoutCache.books[bookId];
    return {
      x: bEntry.x,
      y: bEntry.y + 18,
      spineTopX: bEntry.spineTopX,
      spineTopY: bEntry.spineTopY
    };
  }
  if (hallId && layoutCache.halls) {
    const hg = layoutCache.halls.find(h => h.hall.id === hallId);
    if (hg) {
      if (hg.bays && hg.bays.length > 0) {
        const lastBay = hg.bays[hg.bays.length - 1];
        return { x: lastBay.x, y: lastBay.y + 18, spineTopX: lastBay.x, spineTopY: lastBay.y - 24 };
      }
      return { x: hg.bannerPt.x, y: hg.bannerPt.y + 16, spineTopX: hg.bannerPt.x, spineTopY: hg.bannerPt.y - 12 };
    }
  }
  return { x: 0, y: 40, spineTopX: 0, spineTopY: 0 };
}

function buildPolylineMetrics(pts, endX, endY, spineTopX, spineTopY) {
  const clean = [];
  pts.forEach(pt => {
    const prev = clean[clean.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 2.2) clean.push(pt);
  });
  const cumLen = [0];
  let totalDist = 0;
  for (let i = 1; i < clean.length; i++) {
    totalDist += Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y);
    cumLen.push(totalDist);
  }
  return { pts: clean, cumLen, totalDist: Math.max(45, totalDist), endX, endY, spineTopX, spineTopY };
}

// Build an exact hallway-following polyline from the Center Rotunda Desk (0,-4) down each corridor & sub-hall carpet to the shelf!
function buildLibrarianHallwayRoute(bookId, hallId, laneOffset = 0) {
  const bEntry = (bookId && layoutCache.books) ? layoutCache.books[bookId] : null;
  const resolvedHallId = bEntry ? bEntry.hall.id : hallId;
  const target = resolveLibrarianTargetWorldPoint(bookId, resolvedHallId);

  const chain = [];
  let curId = resolvedHallId;
  const guard = new Set();
  while (curId && !guard.has(curId)) {
    guard.add(curId);
    const hg = layoutCache.hallMap?.[curId];
    if (!hg) break;
    chain.unshift(hg);
    curId = hg.parentId;
  }

  const pts = [{ x: 0, y: -4 }];
  if (chain.length > 0) {
    const firstHg = chain[0];
    const ent = firstHg.spineAt(0);
    pts.push({ x: ent.x * 0.45 + firstHg.perpX * laneOffset * 0.5, y: ent.y * 0.45 + firstHg.perpY * laneOffset * 0.5 });

    chain.forEach((hg, idx) => {
      const isLast = idx === chain.length - 1;
      let tEnd = 0.96;
      if (isLast) {
        if (bEntry && !bEntry.collapsedProxy && typeof bEntry.bayGeom?.tBay === 'number') {
          tEnd = bEntry.bayGeom.tBay;
        } else if (hg.bays && hg.bays.length > 0 && typeof hg.bays[hg.bays.length - 1].tBay === 'number') {
          tEnd = hg.bays[hg.bays.length - 1].tBay;
        } else {
          tEnd = 0.7;
        }
      }
      const steps = isLast ? 10 : 12;
      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * tEnd;
        const p = hg.spineAt(t);
        const taper = (isLast && s === steps) ? 0.25 : 1;
        pts.push({ x: p.x + hg.perpX * laneOffset * taper, y: p.y + hg.perpY * laneOffset * taper });
      }
    });
  }
  pts.push({ x: target.x, y: target.y });
  return buildPolylineMetrics(pts, target.x, target.y, target.spineTopX, target.spineTopY);
}

// Build full route supporting: 'out' (Rotunda->Shelf), 'in' (Shelf->Rotunda), 'transfer' (Old Hall->Rotunda->New Hall), 'stroll' (Rotunda->Hall->Rotunda)
function buildLibrarianRouteForAgent(a) {
  if (a.direction === 'in') {
    const outRoute = buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
    const revPts = [...outRoute.pts].reverse();
    return buildPolylineMetrics(revPts, 0, -4, 0, -24);
  }
  if (a.direction === 'transfer') {
    const fromOut = buildLibrarianHallwayRoute(null, a.fromHallId, a.laneOffset);
    const toOut = buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
    const combined = [...[...fromOut.pts].reverse(), ...toOut.pts.slice(1)];
    return buildPolylineMetrics(combined, toOut.endX, toOut.endY, toOut.spineTopX, toOut.spineTopY);
  }
  if (a.direction === 'stroll') {
    const outRoute = buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
    const pausePt = outRoute.pts[outRoute.pts.length - 1];
    const combined = [...outRoute.pts, pausePt, pausePt, ...[...outRoute.pts].reverse().slice(1)];
    return buildPolylineMetrics(combined, 0, -4, 0, -24);
  }
  return buildLibrarianHallwayRoute(a.bookId, a.hallId, a.laneOffset);
}

function samplePolylineAt(route, frac) {
  const { pts, cumLen, totalDist } = route;
  if (pts.length === 0) return { x: 0, y: 0, tx: 1, ty: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, tx: 1, ty: 0 };
  const targetLen = Math.max(0, Math.min(1, frac)) * totalDist;
  let segIdx = 0;
  while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetLen) {
    segIdx++;
  }
  const segStart = cumLen[segIdx];
  const segEnd = cumLen[segIdx + 1];
  const segLen = Math.max(0.0001, segEnd - segStart);
  const localT = Math.max(0, Math.min(1, (targetLen - segStart) / segLen));
  const p0 = pts[segIdx];
  const p1 = pts[segIdx + 1];
  return {
    x: p0.x + (p1.x - p0.x) * localT,
    y: p0.y + (p1.y - p0.y) * localT,
    tx: p1.x - p0.x,
    ty: p1.y - p0.y
  };
}

function easeLibrarianWalk(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const s = t * t * (3 - 2 * t);
  return 0.36 * t + 0.64 * s;
}

function dispatchLibrarian(opts = {}) {
  const seq = librarianSpawnCounter++;
  const persona = LIBRARIAN_PERSONAS[seq % LIBRARIAN_PERSONAS.length];
  const laneOffset = ((seq % 3) - 1) * 7.5;
  const direction = opts.direction || 'out'; // 'out' | 'in' | 'transfer' | 'stroll'

  computeLayout();
  const stub = { direction, bookId: opts.bookId || null, hallId: opts.hallId || null, fromHallId: opts.fromHallId || null, laneOffset };
  const route = buildLibrarianRouteForAgent(stub);
  const dist = route.totalDist;

  // Walk duration stays right around ~2.0 seconds (1880ms - 2140ms) for deliveries/fetches/transfers,
  // so librarians automatically hustle faster down longer hallways; ambient strolls are a relaxed ~5.6s round-trip!
  const walkDuration = direction === 'stroll'
    ? Math.round(5200 + Math.min(1, dist / 2200) * 1400)
    : Math.round(1880 + Math.min(1, dist / 1800) * 260);
  const flourishDuration = direction === 'stroll' ? 220 : 390;

  activeLibrarians.push({
    id: uid('lib'),
    seq,
    persona,
    direction,
    kind: opts.kind || (direction === 'stroll' ? 'none' : 'book'), // 'book' | 'paper' | 'none'
    source: opts.source || 'pile',
    bookId: opts.bookId || null,
    hallId: opts.hallId || null,
    fromHallId: opts.fromHallId || null,
    title: opts.title || 'Book',
    colorId: opts.colorId || state.palette?.[0]?.id || 'terracotta',
    laneOffset,
    dist,
    endX: route.endX,
    endY: route.endY,
    spineTopX: route.spineTopX,
    spineTopY: route.spineTopY,
    startTime: performance.now() + (opts.delayMs || 0),
    walkDuration,
    flourishDuration,
    arrived: false
  });

  renderMap();
  if (!librarianRafId) {
    librarianRafId = requestAnimationFrame(stepLibrariansAnimation);
  }
}

// Ambient Strolling Librarian scheduler (when ambientLifeEnabled is ON)
let ambientStrollTimer = null;
function scheduleNextAmbientStroll() {
  clearTimeout(ambientStrollTimer);
  if (!ambientLifeEnabled) return;
  ambientStrollTimer = setTimeout(() => {
    if (ambientLifeEnabled && !openBookState.bookId && activeLibrarians.length === 0) {
      const visibleHalls = (layoutCache.halls || []).filter(hg => !hg.collapsed);
      if (visibleHalls.length > 0) {
        const pick = visibleHalls[Math.floor(Math.random() * visibleHalls.length)];
        dispatchLibrarian({
          direction: 'stroll',
          kind: 'none',
          hallId: pick.hall.id,
          title: 'Checking shelves…',
          colorId: pick.hall.color
        });
      }
    }
    scheduleNextAmbientStroll();
  }, 12500 + Math.random() * 6000);
}

function renderLibrariansOverlaySVG(now = performance.now()) {
  if (!librarianLayerEl) return;
  if (activeLibrarians.length === 0) {
    librarianLayerEl.innerHTML = '';
    return;
  }
  const ink = isCandlelight ? '#140b06' : '#3c2516';
  let out = '';

  activeLibrarians.forEach(a => {
    const elapsed = now - a.startTime;
    if (elapsed < 0) return;

    const route = buildLibrarianRouteForAgent(a);
    a.endX = route.endX;
    a.endY = route.endY;
    a.spineTopX = route.spineTopX;
    a.spineTopY = route.spineTopY;
    const dist = route.totalDist;

    const walkRaw = Math.min(1, Math.max(0, elapsed / a.walkDuration));
    const e = easeLibrarianWalk(walkRaw);
    const pos = samplePolylineAt(route, e);
    const wx = pos.x;
    const wy = pos.y;
    const facing = pos.tx >= -1.2 ? 1 : -1;

    const speedPxPerSec = dist / (a.walkDuration / 1000);
    const isStroll = a.direction === 'stroll';
    const isHustling = !isStroll && speedPxPerSec > 320;
    const bsw = getSwatch(a.colorId);
    const p = a.persona;

    const flourishRaw = elapsed > a.walkDuration
      ? Math.min(1, (elapsed - a.walkDuration) / a.flourishDuration)
      : 0;
    const fadeOut = flourishRaw > 0.45 ? Math.max(0, 1 - (flourishRaw - 0.45) / 0.55) : 1;

    const totalStrides = isStroll
      ? Math.max(18, Math.min(34, 14 + dist * 0.015))
      : Math.max(11, Math.min(28, 8 + dist * 0.017));
    const walkPhase = walkRaw * totalStrides * Math.PI;
    const bobY = !a.arrived ? -Math.abs(Math.sin(walkPhase)) * (isStroll ? 3.5 : 5.2) : -Math.sin(flourishRaw * Math.PI) * 6;
    const leanDeg = !a.arrived ? (isStroll ? 2.5 : Math.min(14.5, 3 + dist / 115)) : -5;
    const foot1X = !a.arrived ? Math.sin(walkPhase) * (isStroll ? 4.8 : 6.5) : -3;
    const foot2X = !a.arrived ? -Math.sin(walkPhase) * (isStroll ? 4.8 : 6.5) : 3.5;

    // Subtle dotted footstep trail right down the carpet hallway & destination beacon while walking
    let trailHtml = '';
    if (!a.arrived && !isStroll && route.pts.length >= 2) {
      const pulseR = 14 + Math.sin(walkRaw * Math.PI * 6) * 3;
      const pathD = route.pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
      trailHtml = `
        <path d="${pathD}"
              fill="none" stroke="${bsw.fill}" stroke-width="2.2" stroke-dasharray="3 7" stroke-linecap="round" stroke-linejoin="round" opacity="0.46" />
        <circle cx="${a.endX.toFixed(1)}" cy="${(a.endY - 14).toFixed(1)}" r="${pulseR.toFixed(1)}"
                fill="none" stroke="#f5c663" stroke-width="2" stroke-dasharray="4 3" opacity="0.72" />
      `;
    }

    // Hustle wind streaks & tiny dust puffs when speeding down a long hallway
    let hustleLinesHtml = '';
    if (!a.arrived && isHustling) {
      const streakLen = Math.min(24, 9 + (speedPxPerSec - 280) * 0.025);
      const dustR1 = 2.6 + Math.abs(Math.sin(walkPhase)) * 1.8;
      const dustR2 = 2.0 + Math.abs(Math.cos(walkPhase)) * 1.5;
      hustleLinesHtml = `
        <line x1="${(-13 - streakLen).toFixed(1)}" y1="-12" x2="-13" y2="-12" stroke="#fff8e8" stroke-width="1.8" stroke-linecap="round" opacity="0.65" />
        <line x1="${(-15 - streakLen * 0.8).toFixed(1)}" y1="-4" x2="-15" y2="-4" stroke="${bsw.fill}" stroke-width="1.6" stroke-linecap="round" opacity="0.55" />
        <circle cx="-13" cy="11" r="${dustR1.toFixed(1)}" fill="#efe0c6" stroke="${ink}" stroke-width="1" opacity="0.7" />
        <circle cx="-20" cy="9" r="${dustR2.toFixed(1)}" fill="#efe0c6" stroke="${ink}" stroke-width="0.9" opacity="0.5" />
      `;
    }

    let headExtraHtml = '';
    if (p.hat === 'bun') {
      headExtraHtml = `
        <path d="M -8 -19 Q 0 -26 8 -18 Q 5 -22 -7 -17 Z" fill="${p.hair}" stroke="${ink}" stroke-width="1.5" />
        <circle cx="-6.5" cy="-23.5" r="4.8" fill="${p.hair}" stroke="${ink}" stroke-width="1.6" />
        <line x1="-11" y1="-26.5" x2="-1.5" y2="-20.5" stroke="#f5c663" stroke-width="2" stroke-linecap="round" />
      `;
    } else if (p.hat === 'cap') {
      headExtraHtml = `
        <path d="M -9 -19 Q -1 -27 9 -19 L 12 -18 Q 2 -16 -9 -19 Z" fill="${p.coatDeep}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M -5 -23 Q -11 -29 -13 -24 Q -8 -23 -5 -21" fill="#fff8e8" stroke="${ink}" stroke-width="1.2" />
      `;
    } else {
      headExtraHtml = `
        <path d="M -8 -18 Q -4 -26 6 -21 Q 1 -22 -7 -16 Z" fill="${p.hair}" stroke="${ink}" stroke-width="1.4" />
        <path d="M 1 -11.5 Q 5 -13 8.5 -10.5 Q 5 -9.5 1.5 -10.5 Z" fill="${p.hair}" stroke="${ink}" stroke-width="1.1" />
      `;
    }

    // Carried Item in Arms (Miniature Book, Fluttering Paper, or Cozy Lantern when strolling!)
    let carriedItemHtml = '';
    if (isStroll) {
      carriedItemHtml = `
        <path d="M -1 -3 Q 5 0 10 -2" fill="none" stroke="${p.coat}" stroke-width="4" stroke-linecap="round" />
        <circle cx="10.5" cy="-2" r="2.4" fill="#fce2c4" stroke="${ink}" stroke-width="1.2" />
        <g transform="translate(12, 2)">
          <rect x="-3.5" y="-2" width="7" height="9" rx="2" fill="#ffe07a" stroke="${ink}" stroke-width="1.4" />
          <circle cx="0" cy="2.5" r="9" fill="url(#lanternGrad)" opacity="0.6" />
        </g>
      `;
    } else if (!a.arrived) {
      if (a.kind === 'book') {
        carriedItemHtml = `
          <g transform="translate(10.5, -5.5) rotate(-11)">
            <rect x="-7" y="-10" width="14" height="19" rx="2.5" fill="${bsw.fill}" stroke="${ink}" stroke-width="1.8" />
            <rect x="-5" y="-11.8" width="10.5" height="2.4" rx="1" fill="#fffaf0" stroke="${ink}" stroke-width="1.1" />
            <line x1="-4.5" y1="-8" x2="-4.5" y2="7" stroke="${bsw.deep}" stroke-width="2.2" stroke-linecap="round" />
            <line x1="-6" y1="-4.5" x2="6" y2="-4.5" stroke="${bsw.rugEdge}" stroke-width="1.4" />
            <line x1="-6" y1="3.5" x2="6" y2="3.5" stroke="${bsw.rugEdge}" stroke-width="1.4" />
            <circle cx="0.5" cy="-0.5" r="2.2" fill="#f5c663" stroke="${ink}" stroke-width="0.9" />
          </g>
          <path d="M -2 -3 Q 4 1 9 -1.5" fill="none" stroke="${p.coat}" stroke-width="4.2" stroke-linecap="round" />
          <path d="M -2 -3 Q 4 1 9 -1.5" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="9.8" cy="-1.5" r="2.6" fill="#fce2c4" stroke="${ink}" stroke-width="1.3" />
        `;
      } else {
        const flutter = Math.sin(walkPhase * 1.3) * 7;
        carriedItemHtml = `
          <g transform="translate(11, -5) rotate(${(-8 + flutter).toFixed(1)})">
            <rect x="-7.5" y="-9" width="15" height="18" rx="2" fill="#fffdf6" stroke="${ink}" stroke-width="1.7" />
            <line x1="-4.5" y1="-4.5" x2="4.5" y2="-4.5" stroke="#b69874" stroke-width="1.3" stroke-linecap="round" />
            <line x1="-4.5" y1="-1" x2="4.5" y2="-1" stroke="#b69874" stroke-width="1.3" stroke-linecap="round" />
            <line x1="-4.5" y1="2.5" x2="2" y2="2.5" stroke="#b69874" stroke-width="1.3" stroke-linecap="round" />
            <circle cx="3.2" cy="4.2" r="2.4" fill="${bsw.fill}" stroke="${ink}" stroke-width="0.9" />
          </g>
          <path d="M -2 -3 Q 4 0 9 -2" fill="none" stroke="${p.coat}" stroke-width="4" stroke-linecap="round" />
          <circle cx="9.5" cy="-2" r="2.5" fill="#fce2c4" stroke="${ink}" stroke-width="1.3" />
        `;
      }
    } else {
      carriedItemHtml = `
        <path d="M 1 -4 Q 7 -11 10 -17" fill="none" stroke="${p.coat}" stroke-width="4" stroke-linecap="round" />
        <circle cx="10.2" cy="-17.5" r="2.5" fill="#fce2c4" stroke="${ink}" stroke-width="1.3" />
      `;
    }

    const lbl = truncate(a.title, 16);
    const statusTxt = a.arrived
      ? (a.direction === 'in' ? '✦ Fetched!' : (a.kind === 'paper' ? '✦ Filed!' : '✦ Shelved!'))
      : lbl;
    const tagW = Math.max(66, statusTxt.length * 5.9 + 20);

    let sparkleHtml = '';
    if (a.arrived && !isStroll) {
      const spX = a.spineTopX || a.endX;
      const spY = (a.spineTopY || (a.endY - 40)) + 16;
      const ringR = 8 + flourishRaw * 24;
      const spOp = Math.max(0, 1 - flourishRaw * 0.9);
      sparkleHtml = `
        <g transform="translate(${spX.toFixed(1)}, ${spY.toFixed(1)})" opacity="${spOp.toFixed(2)}">
          <circle r="${ringR.toFixed(1)}" fill="none" stroke="#ffd85a" stroke-width="2.6" stroke-dasharray="4 3" />
          <path d="M 0 -14 L 3 -3 L 14 0 L 3 3 L 0 14 L -3 3 L -14 0 L -3 -3 Z" fill="#ffd85a" stroke="${ink}" stroke-width="1.2" transform="scale(${(0.7 + flourishRaw * 0.5).toFixed(2)})" />
        </g>
      `;
    }

    out += `
      ${trailHtml}
      ${sparkleHtml}
      <g transform="translate(${wx.toFixed(1)}, ${wy.toFixed(1)})" opacity="${fadeOut.toFixed(2)}">
        <ellipse cx="0" cy="14" rx="13" ry="4.8" fill="#1a0e06" opacity="0.3" />
        <g transform="translate(0, ${bobY.toFixed(1)}) scale(${facing}, 1) rotate(${leanDeg.toFixed(1)})">
          ${hustleLinesHtml}
          <ellipse cx="${foot1X.toFixed(1)}" cy="11.5" rx="4.2" ry="2.6" fill="#3a2212" stroke="${ink}" stroke-width="1.5" />
          <ellipse cx="${foot2X.toFixed(1)}" cy="11.5" rx="4.2" ry="2.6" fill="#4f301b" stroke="${ink}" stroke-width="1.5" />
          <path d="M -7.5 -7.5 Q 0 -10 7.5 -7.5 L 9.5 8.5 Q 0 11 -9.5 8.5 Z" fill="${p.coat}" stroke="${ink}" stroke-width="1.9" stroke-linejoin="round" />
          <path d="M -4.5 -5.5 L 5.5 -5.5 L 6.5 8 Q 0.5 9.5 -4.5 8 Z" fill="#fff6e3" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round" />
          <circle cx="-1" cy="-2" r="1.2" fill="#f5c663" />
          <circle cx="-1" cy="2.5" r="1.2" fill="#f5c663" />
          <circle cx="0" cy="-15.5" r="8" fill="#fce2c4" stroke="${ink}" stroke-width="1.9" />
          <circle cx="4.2" cy="-13.2" r="1.9" fill="#e58c76" opacity="0.75" />
          ${headExtraHtml}
          <circle cx="2.5" cy="-15.8" r="2.7" fill="rgba(255,255,255,0.45)" stroke="${ink}" stroke-width="1.4" />
          <circle cx="7.4" cy="-15.8" r="2.5" fill="rgba(255,255,255,0.45)" stroke="${ink}" stroke-width="1.4" />
          <line x1="5.1" y1="-16" x2="5.0" y2="-16" stroke="${ink}" stroke-width="1.4" />
          <circle cx="2.8" cy="-15.8" r="1" fill="${ink}" />
          <circle cx="7.5" cy="-15.8" r="0.95" fill="${ink}" />
          ${carriedItemHtml}
        </g>

        ${!isStroll ? `
          <g transform="translate(0, ${(bobY - 37).toFixed(1)})">
            <rect x="${(-tagW / 2).toFixed(1)}" y="-10" width="${tagW.toFixed(1)}" height="19" rx="9.5"
                  fill="${a.arrived ? '#ffd85a' : (isCandlelight ? '#2f2017' : '#fffaf0')}"
                  stroke="${a.arrived ? ink : bsw.fill}" stroke-width="1.8" filter="url(#bookShadow)" />
            <text x="0" y="3" text-anchor="middle" font-size="9.5" font-weight="800" font-family="Georgia, serif"
                  fill="${a.arrived ? '#352012' : (isCandlelight ? '#f8ebd4' : '#352114')}">${esc(statusTxt)}</text>
          </g>
        ` : ''}
      </g>
    `;
  });

  librarianLayerEl.innerHTML = out;
}

function stepLibrariansAnimation(now) {
  let needsMapRefresh = false;
  const remaining = [];

  for (const a of activeLibrarians) {
    const elapsed = now - a.startTime;
    if (elapsed >= a.walkDuration && !a.arrived) {
      a.arrived = true;
      if (a.direction !== 'stroll') {
        playCozySound(a.kind === 'paper' ? 'page' : 'thump');
      }
      if (a.kind === 'book' && (a.direction === 'out' || a.direction === 'transfer')) needsMapRefresh = true;
    }
    if (elapsed < a.walkDuration + a.flourishDuration) {
      remaining.push(a);
    }
  }

  activeLibrarians = remaining;
  if (needsMapRefresh) {
    renderMap();
  } else {
    renderLibrariansOverlaySVG(now);
  }

  if (activeLibrarians.length > 0) {
    librarianRafId = requestAnimationFrame(stepLibrariansAnimation);
  } else {
    librarianRafId = null;
    if (librarianLayerEl) librarianLayerEl.innerHTML = '';
  }
}

function renderMap() {
  computeLayout();

  const ink = isCandlelight ? '#140b06' : '#3c2516';
  const woodPattern = isCandlelight ? 'woodGrainNight' : 'woodGrainDay';
  const wallColor = isCandlelight ? '#432b1c' : '#845637';
  const wallHighlight = isCandlelight ? '#69452e' : '#a8724b';
  const glow = getGlowState();

  const sortedForFloors = [...layoutCache.halls].sort((a, b) => b.depth - a.depth);
  let hallFloors = '';
  sortedForFloors.forEach(hg => { hallFloors += renderHallFloorSVG(hg, ink, woodPattern, wallColor, wallHighlight, glow); });

  let hallBanners = '', shelvesLayer = '';
  layoutCache.halls.forEach(hg => {
    hallBanners += renderHallBannerSVG(hg, ink, glow);
    hg.bays.forEach(bayGeom => { shelvesLayer += renderBookshelfBaySVG(bayGeom, ink, wallColor, wallHighlight, glow); });
  });

  const ribbonsLayer = renderCrossRefRibbonsSVG(ink, glow);
  const radialMenuLayer = typeof renderAddRadialMenuSVG === 'function' ? renderAddRadialMenuSVG(ink) : '';

  let sceneMarkup = `
    <g id="layer-halls">${hallFloors}</g>
    <g id="layer-rotunda">${renderRotundaSVG(ink, woodPattern, wallColor, wallHighlight)}</g>
    <g id="layer-banners">${hallBanners}</g>
    <g id="layer-shelves">${shelvesLayer}</g>
    <g id="layer-ribbons">${ribbonsLayer}</g>
    <g id="layer-radial-menu">${radialMenuLayer}</g>
  `;
  const isTouchLite = window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;
  if (isTouchLite) {
    sceneMarkup = sceneMarkup
      .replace(/\sfilter="url\(#(?:bookShadow|shelfShadow)\)"/g, '')
      .replace(/url\(#woodGrainDay\)/g, '#d6a367')
      .replace(/url\(#woodGrainNight\)/g, '#5a3b26');
  }
  sceneEl.innerHTML = sceneMarkup;
  renderLibrariansOverlaySVG();

  const rCount = state.ribbons.length;
  document.getElementById('ribbon-toggle-label').textContent = rCount ? `Ribbons (${rCount})` : 'Ribbons';
  updateSearchHopperUI();
  updateStampLensUI();
  renderMinimap();
  renderCornerTabletop();
}
