// 生成 Web Push（每日提醒）用的 VAPID 密钥对：node scripts/vapid-keys.mjs
// 把输出的两行分别填进 GitHub Secrets 的 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY，重新部署即可。
// 密钥生成一次就别再换：换了之后，已经开启提醒的设备要关掉再重新打开一次。
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const pub = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url')
const { d } = await crypto.subtle.exportKey('jwk', privateKey)
console.log(`VAPID_PUBLIC_KEY=${pub}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
