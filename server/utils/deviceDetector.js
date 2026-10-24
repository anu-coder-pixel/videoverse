/**
 * VideoVerse — Server-side Device & Location Detector (Zero Client Trust)
 *
 * Derives client context strictly from incoming HTTP headers (User-Agent and IP).
 * Never accepts client-supplied device, browser, or location objects.
 */

const { UAParser } = require('ua-parser-js');
const geoip = require('geoip-lite');

/**
 * Checks whether an IP address is a private, loopback, or local network address.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  // Normalize IPv6 mapped IPv4
  const cleanIp = ip.replace(/^::ffff:/, '').trim();

  if (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp === 'localhost' ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('192.168.') ||
    cleanIp.startsWith('172.16.') ||
    cleanIp.startsWith('172.17.') ||
    cleanIp.startsWith('172.18.') ||
    cleanIp.startsWith('172.19.') ||
    cleanIp.startsWith('172.20.') ||
    cleanIp.startsWith('172.21.') ||
    cleanIp.startsWith('172.22.') ||
    cleanIp.startsWith('172.23.') ||
    cleanIp.startsWith('172.24.') ||
    cleanIp.startsWith('172.25.') ||
    cleanIp.startsWith('172.26.') ||
    cleanIp.startsWith('172.27.') ||
    cleanIp.startsWith('172.28.') ||
    cleanIp.startsWith('172.29.') ||
    cleanIp.startsWith('172.30.') ||
    cleanIp.startsWith('172.31.') ||
    cleanIp.startsWith('fc00:') ||
    cleanIp.startsWith('fe80:')
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves approximate geographical location using local geoip-lite MaxMind database.
 * @param {string} ip
 * @returns {{ city: string, region: string, country: string, isApproximate: boolean, isLocal: boolean }}
 */
function resolveLocation(ip) {
  if (isPrivateOrLocalIp(ip)) {
    return {
      city: 'Local Area',
      region: 'Local Network',
      country: 'Development',
      isApproximate: false,
      isLocal: true,
      display: 'Local Network (Development)',
    };
  }

  const cleanIp = ip.replace(/^::ffff:/, '').trim();
  const geo = geoip.lookup(cleanIp);

  if (!geo) {
    return {
      city: 'Unknown City',
      region: 'Unknown Region',
      country: 'Unknown Country',
      isApproximate: true,
      isLocal: false,
      display: 'Approximate Location (Unknown)',
    };
  }

  const city = geo.city || 'Unknown City';
  const region = geo.region || '';
  const country = geo.country || 'Unknown';
  const displayParts = [city, region, country].filter(Boolean);

  return {
    city,
    region,
    country,
    isApproximate: true,
    isLocal: false,
    display: `${displayParts.join(', ')} (Approximate)`,
  };
}

/**
 * Extracts and parses client device context strictly on the server.
 *
 * @param {import('express').Request} req
 * @returns {object} Context metadata
 */
function parseClientContext(req) {
  const userAgentStr = req.headers['user-agent'] || '';
  const parser = new UAParser(userAgentStr);
  const uaResult = parser.getResult();

  // Browser info
  const browserName = uaResult.browser.name || 'Unknown Browser';
  const browserVersion = uaResult.browser.major || uaResult.browser.version || '';
  const browserDisplay = browserVersion ? `${browserName} ${browserVersion}` : browserName;

  // OS info
  const osName = uaResult.os.name || 'Unknown OS';
  const osVersion = uaResult.os.version || '';
  const osDisplay = osVersion ? `${osName} ${osVersion}` : osName;

  // Device info
  const deviceType = uaResult.device.type || 'desktop';
  const deviceVendor = uaResult.device.vendor || '';
  const deviceModel = uaResult.device.model || '';
  const rawDeviceDisplay = [deviceVendor, deviceModel].filter(Boolean).join(' ');
  const deviceName = rawDeviceDisplay || `${browserName} on ${osName}`;

  // Client IP (from req.ip with Express trust proxy set properly)
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const location = resolveLocation(ip);

  return {
    browser: browserName,
    browserVersion,
    browserDisplay,
    os: osName,
    osVersion,
    osDisplay,
    deviceType,
    deviceModel: rawDeviceDisplay || 'Desktop / Laptop',
    deviceName,
    ip: ip.replace(/^::ffff:/, ''),
    location,
    userAgent: userAgentStr,
  };
}

module.exports = {
  isPrivateOrLocalIp,
  resolveLocation,
  parseClientContext,
};
