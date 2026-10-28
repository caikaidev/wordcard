import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('home-screen and lock-screen PNGs have solid, opaque backgrounds', async () => {
  for (const [name, size] of [
    ['icon-192.png', 192], ['icon-512.png', 512],
    ['apple-touch-icon.png', 180], ['icon-maskable-512.png', 512],
    ['media-artwork.png', 512],
  ]) {
    const png = await readFile(new URL('../public/' + name, import.meta.url))
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name)
    assert.equal(png.readUInt32BE(16), size, name + ' width')
    assert.equal(png.readUInt32BE(20), size, name + ' height')
    assert.equal(png[25], 2, name + ' must be RGB, without transparent corners')
  }

  const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8')
  assert.match(svg, /<rect width="512" height="512" fill="#2B4C7E"\/>/)
})
