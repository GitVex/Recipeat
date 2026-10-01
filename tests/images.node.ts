import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imageUpload, MAX_THUMB_BYTES, sniffImage } from '../server/images/upload.ts'

const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1])
const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')
const html = Buffer.from('<html><script>alert(1)</script>')
const status = (code: number) => (error: { statusCode?: number }) => error.statusCode === code

test('an image is what its bytes say, not what it is called', () => {
  assert.equal(sniffImage(jpeg), 'image/jpeg')
  assert.equal(sniffImage(webp), 'image/webp')
  assert.equal(sniffImage(html), null)
  assert.equal(sniffImage(Buffer.from('RIFF')), null)
})

test('an upload is a picture and a thumb of one kind, each within its size', () => {
  assert.deepEqual(imageUpload([{ name: 'image', data: jpeg }, { name: 'thumb', data: jpeg }]), { mediaType: 'image/jpeg', data: jpeg, thumb: jpeg })
  assert.throws(() => imageUpload([{ name: 'image', data: jpeg }]), status(400))
  assert.throws(() => imageUpload([{ name: 'image', data: html }, { name: 'thumb', data: html }]), status(415))
  assert.throws(() => imageUpload([{ name: 'image', data: jpeg }, { name: 'thumb', data: webp }]), status(415))
  const big = Buffer.concat([jpeg, Buffer.alloc(MAX_THUMB_BYTES)])
  assert.throws(() => imageUpload([{ name: 'image', data: jpeg }, { name: 'thumb', data: big }]), status(413))
})
