/**
 * ChronoQuest — Cloudflare R2 Storage Client
 * Uses S3-compatible API to store generated images permanently.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── R2 Config ────────────────────────────────────────────────────────────────
const R2_ACCOUNT_ID  = 'aa63e05af724df04d81cce575ffdfa5b';
const R2_ACCESS_KEY  = '39d25fd1d8fd13179361168b6ea81939';
const R2_SECRET_KEY  = 'YEfXP13U7Ri3Yc-bzA4OMGdaCEheg6hfDkiu7Yps';
const R2_BUCKET      = 'scholarship';
const R2_ENDPOINT    = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Public URL base — using the R2 public endpoint pattern
const PUBLIC_BASE    = `https://pub-${R2_ACCOUNT_ID}.r2.dev`;

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId:     R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
  forcePathStyle: true,   // required for R2
});

/**
 * Upload a buffer (image bytes) to R2.
 * @param {Buffer} buffer  - Raw image data
 * @param {string} key     - Object key, e.g. "images/japan_gate_abc123.png"
 * @param {string} contentType - MIME type, default "image/png"
 * @returns {{ r2_url, public_url, key }}
 */
async function uploadBuffer(buffer, key, contentType = 'image/png') {
  const cmd = new PutObjectCommand({
    Bucket:      R2_BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
    Metadata: {
      'uploaded-by': 'chronoquest',
      'uploaded-at': new Date().toISOString(),
    },
  });

  await s3.send(cmd);

  const r2_url    = `${R2_ENDPOINT}/${R2_BUCKET}/${key}`;
  // Generate a 7-day pre-signed URL for reliable public access
  const signedUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 604800 });

  return { r2_url, public_url: signedUrl, key };
}

/**
 * Upload a base64-encoded image string to R2.
 */
async function uploadBase64(base64String, key, contentType = 'image/png') {
  // Strip data URI prefix if present
  const clean = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  return uploadBuffer(buffer, key, contentType);
}

/**
 * Check if an object already exists in R2.
 */
async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a deterministic R2 key for an image prompt.
 */
function imageKey(prompt, suffix = '') {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(prompt.trim().toLowerCase()).digest('hex').slice(0, 12);
  const slug = prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  return `images/chronoquest_${slug}_${hash}${suffix}.png`;
}

module.exports = { s3, uploadBuffer, uploadBase64, exists, imageKey, R2_BUCKET, R2_ENDPOINT };
