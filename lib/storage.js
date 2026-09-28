const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Reject any resolved path that escapes the uploads root (prevents path traversal)
function assertSafeLocalPath(localPath) {
  const base = path.resolve(LOCAL_UPLOAD_DIR);
  const resolved = path.resolve(localPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Path traversal blocked');
  }
}

function ensureLocalDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── CLOUDFLARE R2 CONFIGURATION ───────────────────────────────────────────
const useS3 = Boolean(
  process.env.R2_ACCOUNT_ID && 
  process.env.R2_ACCESS_KEY_ID && 
  process.env.R2_SECRET_ACCESS_KEY && 
  process.env.R2_BUCKET_NAME
);

const s3 = useS3
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  : null;

async function putObject({ key, body, contentType }) {
  if (useS3) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType
    }));
    return { key };
  }

  // Fallback to local
  const localPath = path.join(LOCAL_UPLOAD_DIR, key);
  assertSafeLocalPath(localPath);
  ensureLocalDir(localPath);
  await fs.promises.writeFile(localPath, body);
  return { key };
}

async function getObjectStream(key) {
  if (useS3) {
    const result = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    }));
    return result.Body;
  }

  // Fallback to local
  const localPath = path.join(LOCAL_UPLOAD_DIR, key);
  assertSafeLocalPath(localPath);
  return fs.createReadStream(localPath);
}

async function getObjectBuffer(key) {
  if (useS3) {
    const stream = await getObjectStream(key);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  // Fallback to local
  const localPath = path.join(LOCAL_UPLOAD_DIR, key);
  assertSafeLocalPath(localPath);
  return fs.promises.readFile(localPath);
}

async function deleteObject(key) {
  if (useS3) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return;
  }
  const localPath = path.join(LOCAL_UPLOAD_DIR, key);
  await fs.promises.unlink(localPath).catch(() => {});
}

function generateStorageKey(prefix, filename) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamp = Date.now();
  return path.posix.join(prefix, `${stamp}-${safeName}`);
}

module.exports = {
  putObject,
  deleteObject,
  getObjectStream,
  getObjectBuffer,
  generateStorageKey,
  useS3,     
  useBunny: false // Deprecated marker for any legacy checks
};
