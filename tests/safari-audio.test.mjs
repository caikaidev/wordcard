import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('Safari: async cloud failure offers a manual user-tap speech fallback', async () => {
  const original = {
    Audio: globalThis.Audio, window: globalThis.window, navigator: globalThis.navigator,
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  }
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let player
  class FakeAudio {
    constructor() { this.listeners = new Map(); player = this }
    addEventListener(name, fn) { this.listeners.set(name, fn) }
    play() { return Promise.resolve() }
    pause() {}
    emit(name) { this.listeners.get(name)?.() }
  }
  let spoken = 0
  let lastUtterance
  let speechDeadline
  globalThis.Audio = FakeAudio
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { onLine: true } })
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  globalThis.window = { speechSynthesis: {
    getVoices() { return [] },
    cancel() {},
    speak(u) {
      spoken++
      lastUtterance = u
      // The first async start is intentionally blocked by iOS Safari.
    },
  } }
  globalThis.setTimeout = (cb, ms, ...args) => {
    if (ms === 4500) { speechDeadline = cb; return 12345 }
    return original.setTimeout(cb, ms, ...args)
  }
  globalThis.clearTimeout = (id) => {
    if (id !== 12345) original.clearTimeout(id)
  }
  try {
    const bundle = await build({ entryPoints: ['src/audio.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
    const audio = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
    const completed = audio.speak('hello', false)
    player.emit('error') // cloud failed after .play()
    assert.equal(spoken, 1)
    assert.equal(audio.getSpeechStatus().needsTap, false)
    assert.equal(typeof speechDeadline, 'function')
    speechDeadline() // Safari silently refuses to start automatic speech
    assert.equal(audio.getSpeechStatus().needsTap, true)
    audio.retrySystemSpeech() // user directly taps the fallback button
    assert.equal(spoken, 2)
    lastUtterance.onstart()
    assert.equal(audio.getSpeechStatus().needsTap, false)
    lastUtterance.onend()
    assert.equal(await completed, true)
    assert.equal(audio.getSpeechStatus().text, null)
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (name === 'navigator') continue
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else delete globalThis.navigator
  }
})
