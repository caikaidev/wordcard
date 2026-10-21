/*
 * 闯关音效：用 Web Audio 现场合成，不下载音频文件，几乎零延迟。
 * 开关记在本机（localStorage），默认打开；静音模式下 iPhone 本来也不出声。
 */

const KEY = 'sfx-off'
let ctx: AudioContext | null = null

export const sfxOn = () => {
  try {
    return localStorage.getItem(KEY) !== '1'
  } catch {
    return true
  }
}
export const setSfx = (on: boolean) => {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '1')
  } catch {
    /* 隐私模式存不了就算了 */
  }
}

function audio() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  // iOS 上 AudioContext 要在用户点击后恢复
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** 一个短音：频率、开始时间（秒）、时长、音色、音量 */
function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.18) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + at
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(a.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export const sfx = {
  /** 答对：上扬的两声「叮咚」 */
  correct() {
    if (!sfxOn()) return
    tone(880, 0, 0.16, 'sine', 0.16)
    tone(1318.5, 0.09, 0.28, 'sine', 0.16)
  },
  /** 答错：低沉的一声 */
  wrong() {
    if (!sfxOn()) return
    tone(196, 0, 0.22, 'triangle', 0.2)
    tone(147, 0.1, 0.26, 'triangle', 0.16)
  },
  /** 点选：很轻的一下 */
  tap() {
    if (!sfxOn()) return
    tone(660, 0, 0.05, 'sine', 0.05)
  },
  /** 过关：一串上行琶音 */
  finish() {
    if (!sfxOn()) return
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.32, 'sine', 0.14))
  },
}
