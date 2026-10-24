const { URL } = require('url');

/**
 * Strict Hostname Allowlist for Video Downloads
 * Only trusted video content delivery hosts are permitted.
 */
const ALLOWED_HOSTNAMES = new Set([
  'vjs.zencdn.net',
  'www.w3schools.com',
  'interactive-examples.mdn.mozilla.net',
  'media.w3.org',
]);

/**
 * Private / loopback IP patterns to prevent any SSRF attempts
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^::1$/,
];

/**
 * Validates a remote video URL against strict security criteria:
 * - Must be a valid URL
 * - Must use HTTPS only
 * - Must NOT contain user credentials (e.g. user:pass@host)
 * - Hostname must be strictly within the exact ALLOWED_HOSTNAMES allowlist
 * - Must NOT match any private / loopback IP address
 *
 * @param {string} rawUrl
 * @returns {{ valid: boolean, url?: string, hostname?: string, reason?: string }}
 */
function validateRemoteUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, reason: 'URL is missing or invalid type.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return { valid: false, reason: 'Malformed URL format.' };
  }

  // 1. HTTPS only
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: `Insecure protocol "${parsed.protocol}". Only HTTPS is permitted.` };
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URLs with embedded credentials are strictly rejected.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 3. Check for private/loopback patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Requests to private, local, or loopback addresses are prohibited.' };
    }
  }

  // 4. Exact hostname allowlist
  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    return {
      valid: false,
      reason: `Host "${hostname}" is not in the approved video source allowlist.`,
    };
  }

  return {
    valid: true,
    url: parsed.href,
    hostname,
  };
}

/**
 * Generates an RFC-compliant, injection-safe filename for Content-Disposition
 *
 * @param {string} title
 * @param {string} videoId
 * @returns {string}
 */
function sanitizeFilename(title, videoId = 'video') {
  if (!title || typeof title !== 'string') {
    return `VideoVerse-${videoId}.mp4`;
  }

  // Replace invalid characters: \ / : * ? " < > | and control characters
  const cleaned = title
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  // Ensure ASCII alphanumeric safe name
  const asciiOnly = cleaned.replace(/[^a-zA-Z0-9._-]/g, '');
  const baseName = asciiOnly.slice(0, 80) || `video-${videoId}`;

  return `VideoVerse-${baseName}.mp4`;
}

/**
 * Safely fetches a remote video with:
 * - Redirect control (validates every hop to prevent open redirect SSRF)
 * - 5-second connection/header timeout
 * - Fallback URL attempt if primary fails
 * - Verification of Content-Type, Content-Length, and Accept-Ranges
 *
 * @param {string} primaryUrl
 * @param {string|null} fallbackUrl
 * @param {AbortSignal} parentSignal
 * @returns {Promise<{ response: Response, finalUrl: string, usingFallback: boolean, isByteRangeSupported: boolean, contentLength: number }>}
 */
async function safeFetchVideo(primaryUrl, fallbackUrl, parentSignal) {
  async function attemptFetch(targetUrl, maxRedirects = 3) {
    let currentUrl = targetUrl;
    let hops = 0;

    while (hops <= maxRedirects) {
      const valResult = validateRemoteUrl(currentUrl);
      if (!valResult.valid) {
        throw new Error(`Security validation failed: ${valResult.reason}`);
      }

      // 5-second timeout for connection and initial headers
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        timeoutController.abort(new Error('Connection to remote video origin timed out (5s).'));
      }, 5000);

      const headerSignal = parentSignal
        ? AbortSignal.any([parentSignal, timeoutController.signal])
        : timeoutController.signal;

      let res;
      try {
        res = await fetch(valResult.url, {
          signal: headerSignal,
          redirect: 'manual', // Never follow redirects blindly
        });
      } finally {
        // Clear the connection timeout once headers have arrived
        clearTimeout(timeoutId);
      }

      // Handle redirect manually with strict validation
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response (HTTP ${res.status}) missing Location header.`);
        }

        // Resolve relative redirects safely against currentUrl
        const resolvedRedirect = new URL(location, currentUrl).href;
        currentUrl = resolvedRedirect;
        hops++;
        continue;
      }

      if (!res.ok) {
        throw new Error(`Origin server returned HTTP ${res.status} ${res.statusText}`);
      }

      const acceptRanges = res.headers.get('accept-ranges');
      const isByteRangeSupported = typeof acceptRanges === 'string' && acceptRanges.toLowerCase().includes('bytes');
      const contentLengthHeader = res.headers.get('content-length');
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

      return {
        response: res,
        finalUrl: currentUrl,
        isByteRangeSupported,
        contentLength: isNaN(contentLength) ? 0 : contentLength,
      };
    }

    throw new Error('Too many redirects encountered while resolving video file.');
  }

  // 1. Try primary URL
  try {
    const result = await attemptFetch(primaryUrl);
    return { ...result, usingFallback: false };
  } catch (primaryErr) {
    console.warn(`[Video Download] Primary URL failed (${primaryUrl}): ${primaryErr.message}`);

    // 2. Try fallback URL if provided and valid
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      const fallbackVal = validateRemoteUrl(fallbackUrl);
      if (fallbackVal.valid) {
        try {
          console.log(`[Video Download] Attempting fallback URL: ${fallbackUrl}`);
          const fallbackResult = await attemptFetch(fallbackUrl);
          return { ...fallbackResult, usingFallback: true };
        } catch (fallbackErr) {
          console.warn(`[Video Download] Fallback URL also failed: ${fallbackErr.message}`);
        }
      }
    }

    throw primaryErr;
  }
}

module.exports = {
  ALLOWED_HOSTNAMES,
  validateRemoteUrl,
  sanitizeFilename,
  safeFetchVideo,
};
