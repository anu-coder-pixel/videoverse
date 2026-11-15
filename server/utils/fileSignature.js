/**
 * VideoVerse — File Signature & Magic Bytes Validator
 *
 * Inspects binary buffers to verify that uploaded files match their claimed
 * MIME types, preventing malicious payloads masquerading as video files.
 */

const SUPPORTED_VIDEO_TYPES = {
  'video/mp4': {
    extensions: ['.mp4', '.m4v'],
    validator: validateMp4Signature,
  },
  'video/webm': {
    extensions: ['.webm'],
    validator: validateWebmSignature,
  },
};

/**
 * Validates MP4 ISO Base Media File Format
 * Bytes 4-7 must be 'ftyp' (0x66, 0x74, 0x79, 0x70).
 */
function validateMp4Signature(buffer) {
  if (!buffer || buffer.length < 12) return false;

  // Bytes 4-7 must be 'ftyp'
  const ftyp = buffer.subarray(4, 8).toString('ascii');
  if (ftyp !== 'ftyp') return false;

  // Major brand at bytes 8-12
  const brand = buffer.subarray(8, 12).toString('ascii').trim().toLowerCase();
  const knownBrands = [
    'isom', 'iso2', 'mp41', 'mp42', 'm4v', 'msnv', 'avc1',
    'qt', 'dash', 'f4v', '3gp', 'cmfc', 'mp71'
  ];

  return knownBrands.some(b => brand.startsWith(b));
}

/**
 * Validates WebM / Matroska EBML Header
 * Offset 0 must begin with 0x1A 0x45 0xDF 0xA3 (EBML ID).
 */
function validateWebmSignature(buffer) {
  if (!buffer || buffer.length < 4) return false;

  const isEbml = (
    buffer[0] === 0x1A &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xDF &&
    buffer[3] === 0xA3
  );

  if (!isEbml) return false;

  // If buffer is long enough, check for 'webm' or 'matroska' DocType string
  if (buffer.length >= 16) {
    const textSnippet = buffer.subarray(4, Math.min(buffer.length, 64)).toString('latin1');
    return textSnippet.includes('webm') || textSnippet.includes('matroska');
  }

  return true;
}

/**
 * Validates a chunk or file buffer against claimed MIME type.
 *
 * @param {Buffer} buffer - Initial chunk buffer (at least 64 bytes recommended)
 * @param {string} mimeType - Claimed MIME type ('video/mp4' or 'video/webm')
 * @returns {{ valid: boolean, detectedType: string|null, error: string|null }}
 */
function validateVideoSignature(buffer, mimeType) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 8) {
    return {
      valid: false,
      detectedType: null,
      error: 'Buffer is too small to determine file signature.',
    };
  }

  const normalizedMime = (mimeType || '').toLowerCase().trim();
  const config = SUPPORTED_VIDEO_TYPES[normalizedMime];

  if (!config) {
    return {
      valid: false,
      detectedType: null,
      error: `Unsupported MIME type "${mimeType}". Only MP4 (video/mp4) and WebM (video/webm) are accepted.`,
    };
  }

  const isValid = config.validator(buffer);

  if (!isValid) {
    // Try to detect what it actually might be
    let detected = null;
    if (validateMp4Signature(buffer)) detected = 'video/mp4';
    else if (validateWebmSignature(buffer)) detected = 'video/webm';

    return {
      valid: false,
      detectedType: detected,
      error: `File signature mismatch: file content does not match the expected ${normalizedMime} format.`,
    };
  }

  return {
    valid: true,
    detectedType: normalizedMime,
    error: null,
  };
}

module.exports = {
  validateVideoSignature,
  validateMp4Signature,
  validateWebmSignature,
  SUPPORTED_VIDEO_TYPES,
};

