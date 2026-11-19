let audioCtx: AudioContext | null = null;

function playNote(
  freq: number,
  startOffset: number,
  dur: number,
  type: OscillatorType = 'sine',
  vol = 0.07,
) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime + startOffset;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.01);
}

export type SfxType =
  | 'hit'
  | 'crit'
  | 'drop'
  | 'upgrade'
  | 'roulette'
  | 'jackpot'
  | 'legend'
  | 'mythic'
  | 'chest';

export function playSfx(type: SfxType, soundOn: boolean): void {
  if (!soundOn) return;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    if (type === 'hit') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.06);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.065);
    } else if (type === 'crit') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.11);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'drop') {
      playNote(587, 0, 0.10, 'sine', 0.06);
      playNote(880, 0.06, 0.14, 'sine', 0.06);
    } else if (type === 'upgrade') {
      playNote(440, 0, 0.08, 'sine', 0.07);
      playNote(660, 0.05, 0.08, 'sine', 0.07);
      playNote(990, 0.10, 0.14, 'sine', 0.07);
    } else if (type === 'roulette') {
      playNote(740, 0, 0.035, 'square', 0.03);
    } else if (type === 'jackpot') {
      playNote(523, 0, 0.10, 'triangle', 0.08);
      playNote(659, 0.06, 0.10, 'triangle', 0.08);
      playNote(784, 0.12, 0.12, 'triangle', 0.08);
      playNote(1046, 0.18, 0.25, 'sine', 0.09);
    } else if (type === 'legend') {
      playNote(523, 0, 0.12, 'triangle', 0.08);
      playNote(659, 0.08, 0.12, 'triangle', 0.08);
      playNote(784, 0.16, 0.12, 'triangle', 0.08);
      playNote(1046, 0.24, 0.35, 'sine', 0.09);
    } else if (type === 'mythic') {
      playNote(523, 0, 0.12, 'sine', 0.09);
      playNote(659, 0.07, 0.12, 'sine', 0.09);
      playNote(784, 0.14, 0.12, 'sine', 0.09);
      playNote(1046, 0.21, 0.14, 'triangle', 0.09);
      playNote(1318, 0.28, 0.16, 'triangle', 0.09);
      playNote(1568, 0.35, 0.45, 'sine', 0.10);
    } else if (type === 'chest') {
      playNote(392, 0, 0.08, 'triangle', 0.06);
      playNote(523, 0.05, 0.12, 'triangle', 0.07);
    }
  } catch {
    // ignore WebAudio restrictions
  }
}
