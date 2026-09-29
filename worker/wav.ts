/** Gemini TTS 返回裸 PCM（16bit 小端），浏览器不能直接播，这里补一个 WAV 头 */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const blockAlign = (channels * bitsPerSample) / 8
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const str = (off: number, s: string) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * blockAlign, true)
  v.setUint16(32, blockAlign, true)
  v.setUint16(34, bitsPerSample, true)
  str(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  const out = new Uint8Array(44 + pcm.byteLength)
  out.set(new Uint8Array(header), 0)
  out.set(pcm, 44)
  return out
}
