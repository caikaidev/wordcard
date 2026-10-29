import { test } from 'node:test'
import assert from 'node:assert/strict'
import { practiceGenerateBlock } from '../shared/practice-compose.ts'

test('empty link or text tells the user what to paste', () => {
  assert.equal(practiceGenerateBlock({ source: 'url', url: '   ', text: '', imageCount: 0 }), '请先粘贴链接或正文')
  assert.equal(practiceGenerateBlock({ source: 'text', url: '', text: '', imageCount: 0 }), '请先粘贴链接或正文')
})

test('invalid link, short text, and missing screenshots each have their own reason', () => {
  assert.match(practiceGenerateBlock({ source: 'url', url: 'example.com', text: '', imageCount: 0 }), /https/)
  const short = practiceGenerateBlock({ source: 'text', url: '', text: 'too short', imageCount: 0 })
  assert.match(short, /80/)
  assert.equal(practiceGenerateBlock({ source: 'image', url: '', text: '', imageCount: 0 }), '请先添加截图')
})

test('ready input can generate', () => {
  assert.equal(practiceGenerateBlock({ source: 'url', url: 'https://example.com/a', text: '', imageCount: 0 }), null)
  assert.equal(practiceGenerateBlock({ source: 'text', url: '', text: 'x'.repeat(81), imageCount: 0 }), null)
  assert.equal(practiceGenerateBlock({ source: 'image', url: '', text: '', imageCount: 2 }), null)
})
