/**
 * Image processing pipeline using sharp.
 *
 * - For PDF-bound images (signatures, stamps): outputs optimised PNG at max 1200px wide.
 *   pdf-lib only understands PNG/JPEG; converting to WebP would break signed PDF generation.
 * - For display-only images (chat, HR photos): converts to WebP for smaller file sizes.
 * - Strips all EXIF/XMP metadata from every image (privacy + size).
 * - Resizes oversized originals to a sensible max dimension.
 * - Non-image files (PDF, docx, xlsx, audio…) pass through unchanged.
 */
const sharp = require('sharp');

const MAX_FULL_PX = 1200;

function isImageMime(mime) {
  return mime && mime.startsWith('image/');
}

/**
 * Process an uploaded image buffer.
 *
 * @param {Buffer}  buffer       - Raw upload buffer from multer memoryStorage
 * @param {string}  mime         - Original MIME type from the upload
 * @param {'pdf'|'web'} mode
 *   'pdf'  → keep as PNG (safe for pdf-lib embedding); use for signatures and stamps
 *   'web'  → convert to WebP (optimal for browser delivery); use for chat images, HR photos
 * @returns {{ buffer: Buffer, mime: string, ext: string } | null}
 *   null = not an image (caller should store the original unchanged)
 */
async function processImage(buffer, mime, mode = 'web') {
  if (!isImageMime(mime)) return null;

  try {
    const pipeline = sharp(buffer)
      .withMetadata({ exif: false, icc: false, xmp: false })  // strip EXIF/XMP
      .resize({ width: MAX_FULL_PX, height: MAX_FULL_PX, fit: 'inside', withoutEnlargement: true });

    if (mode === 'pdf') {
      const out = await pipeline.png({ compressionLevel: 8 }).toBuffer();
      return { buffer: out, mime: 'image/png', ext: 'png' };
    }

    const out = await pipeline.webp({ quality: 82 }).toBuffer();
    return { buffer: out, mime: 'image/webp', ext: 'webp' };
  } catch {
    return null;
  }
}

module.exports = { processImage, isImageMime };
