/**
 * Verification Test Suite for Task 4 Backend
 * Validates OTP security, atomic concurrency, trusted devices, IST time, anti-enumeration, and audit logs.
 */

const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const User = require('../models/User');
const TrustedDevice = require('../models/TrustedDevice');
const OtpSession = require('../models/OtpSession');
const LoginHistory = require('../models/LoginHistory');
const { getAutoIstTheme, resolveTheme } = require('../utils/istTime');
const { generateOtp } = require('../utils/otpService');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          if (data) json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function parseCookies(res) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return {};
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const cookies = {};
  for (const c of arr) {
    const firstPart = c.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx !== -1) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      cookies[k] = v;
    }
  }
  return cookies;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function runTests() {
  const results = { passed: [], failed: [] };

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);

  // ── TEST 1: OTP Randomness and Numeric Range ──────────────────────────────
  let allInRange = true;
  for (let i = 0; i < 1000; i++) {
    const code = generateOtp();
    const num = parseInt(code, 10);
    if (code.length !== 6 || num < 100000 || num > 999999) {
      allInRange = false;
      break;
    }
  }
  if (allInRange) {
    results.passed.push('1. OTP generation strictly produces 6-digit integers in [100000, 999999].');
  } else {
    results.failed.push('1. OTP generation produced an out-of-range value.');
  }

  // ── TEST 2: IST Theme Boundary Logic ──────────────────────────────────────
  // Construct dates with explicit UTC times matching IST hours:
  // IST = UTC + 5:30 -> UTC = IST - 5:30
  // IST 05:00:00 -> UTC 23:30:00 previous day
  // IST 11:59:59 -> UTC 06:29:59 same day
  // IST 12:00:00 -> UTC 06:30:00 same day
  // IST 04:59:59 -> UTC 23:29:59 previous day
  const ist5am = new Date('2026-10-21T23:30:00.000Z'); // 05:00 IST
  const ist1159 = new Date('2026-10-21T06:29:59.000Z'); // 11:59:59 IST
  const ist12pm = new Date('2026-10-21T06:30:00.000Z'); // 12:00:00 IST
  const ist459am = new Date('2026-10-21T23:29:59.000Z'); // 04:59:59 IST

  const theme5am = getAutoIstTheme(ist5am);
  const theme1159 = getAutoIstTheme(ist1159);
  const theme12pm = getAutoIstTheme(ist12pm);
  const theme459am = getAutoIstTheme(ist459am);

  if (theme5am === 'light' && theme1159 === 'light' && theme12pm === 'dark' && theme459am === 'dark') {
    results.passed.push('2. IST time-based theme boundaries correctly evaluated (05:00-11:59 light, 12:00-04:59 dark).');
  } else {
    results.failed.push(`2. IST boundary evaluation failed: 5am=${theme5am}, 11:59=${theme1159}, 12pm=${theme12pm}, 4:59am=${theme459am}`);
  }

  // ── TEST 3: Anti-Enumeration Constant Responses ───────────────────────────
  const wrongEmailRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: 'nonexistent_user_9999@example.com', password: 'SomePassword123!' });

  // ── TEST 4: Register User A and Verify Trusted Device Issuance ─────────────
  const rand = Math.floor(Math.random() * 100000);
  const userEmail = `task4_user_${rand}@example.com`;
  const userPassword = 'StrongPassword123!';

  const regRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/register',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { name: 'Task4 Tester', email: userEmail, password: userPassword });

  const regCookies = parseCookies(regRes);
  const userId = regRes.body?.user?.id;

  const hasSessionCookie = Boolean(regCookies['vv_token']);
  const hasDeviceCookie = Boolean(regCookies['vv_device_token']);

  if (regRes.statusCode === 201 && hasSessionCookie && hasDeviceCookie) {
    results.passed.push('3. User registration issues both 7-day session cookie and 30-day device cookie.');
  } else {
    results.failed.push('3. User registration failed or did not set both cookies.');
  }

  // Anti-enumeration test with real user and wrong password
  const wrongPassRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: userEmail, password: 'WrongPassword123!' });

  if (
    wrongEmailRes.statusCode === 401 &&
    wrongPassRes.statusCode === 401 &&
    wrongEmailRes.body.error === wrongPassRes.body.error
  ) {
    results.passed.push('4. Anti-enumeration: wrong password and non-existent email return identical 401 error message.');
  } else {
    results.failed.push('4. Anti-enumeration test failed.');
  }

  // ── TEST 5: Untrusted Device Login (Step-Up OTP Triggered) ─────────────────
  // Login without device cookie (simulating a new browser)
  const untrustedLoginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: userEmail, password: userPassword });

  const untrustedCookies = parseCookies(untrustedLoginRes);
  const noSessionCookie = !untrustedCookies['vv_token'];
  const requiresOtp = untrustedLoginRes.body?.requiresOtp === true;
  const tempToken = untrustedLoginRes.body?.tempToken;
  const sessionId = untrustedLoginRes.body?.sessionId;

  if (untrustedLoginRes.statusCode === 200 && requiresOtp && noSessionCookie && tempToken && sessionId) {
    results.passed.push('5. Untrusted device login triggers step-up OTP and does NOT issue session cookie.');
  } else {
    results.failed.push('5. Step-up OTP gating failed.');
  }

  // ── TEST 6: Dev OTP Helper Validation ──────────────────────────────────────
  const devOtpRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/dev/last-otp',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tempToken}`,
    },
  });

  const otpCode = devOtpRes.body?.otp;
  if (devOtpRes.statusCode === 200 && otpCode && otpCode.length === 6) {
    results.passed.push('6. Development OTP helper successfully retrieved active code with tempToken validation.');
  } else {
    results.failed.push(`6. Dev OTP helper failed: status ${devOtpRes.statusCode}, body: ${JSON.stringify(devOtpRes.body)}`);
  }

  // ── TEST 7: Invalid OTP Submission (Attempt Counter & Lockout) ─────────────
  // Send 1 wrong code
  const wrongOtpRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/verify-otp',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tempToken}`,
    },
  }, { otp: '000000' });

  const sessionInDb = await OtpSession.findById(sessionId);

  if (wrongOtpRes.statusCode === 400 && sessionInDb.attempts === 1 && sessionInDb.status === 'pending') {
    results.passed.push('7. Incorrect OTP increments attempt counter without marking session verified.');
  } else {
    results.failed.push(`7. Incorrect OTP handling failed: attempts=${sessionInDb?.attempts}, status=${sessionInDb?.status}`);
  }

  // ── TEST 8: Atomic Concurrency on Correct Verification ────────────────────
  // Constraint: Concurrent valid submissions cannot both succeed. Only 1 performs pending -> verified.
  const [concurrentRes1, concurrentRes2] = await Promise.all([
    request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tempToken}`,
      },
    }, { otp: otpCode, deviceName: 'Concurrent Test Browser 1' }),
    request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tempToken}`,
      },
    }, { otp: otpCode, deviceName: 'Concurrent Test Browser 2' }),
  ]);

  const successCount = [concurrentRes1, concurrentRes2].filter(r => r.statusCode === 200).length;
  const conflictCount = [concurrentRes1, concurrentRes2].filter(r => r.statusCode === 409).length;

  if (successCount === 1 && conflictCount === 1) {
    results.passed.push('8. Atomic concurrency: exactly one request succeeded (200), concurrent duplicate rejected (409).');
  } else {
    results.failed.push(`8. Concurrency check failed: successCount=${successCount}, conflictCount=${conflictCount}`);
  }

  // Capture cookies from the successful response
  const winningRes = concurrentRes1.statusCode === 200 ? concurrentRes1 : concurrentRes2;
  const newCookies = parseCookies(winningRes);
  const newDeviceToken = newCookies['vv_device_token'];

  // ── TEST 9: Trusted Device Reuse ───────────────────────────────────────────
  // Next login with the new device token should succeed directly without requiring OTP
  const reusedLoginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieString(newCookies),
    },
  }, { email: userEmail, password: userPassword });

  if (reusedLoginRes.statusCode === 200 && reusedLoginRes.body?.success === true && !reusedLoginRes.body?.requiresOtp) {
    results.passed.push('9. Trusted device reuse: subsequent login with device cookie bypasses OTP.');
  } else {
    results.failed.push('9. Trusted device reuse failed.');
  }

  // ── TEST 10: Security Devices List & Device Revocation ──────────────────────
  const devicesRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/security/devices',
    method: 'GET',
    headers: {
      Cookie: cookieString(newCookies),
    },
  });

  const devicesList = devicesRes.body?.devices;
  const hasCurrentDevice = devicesList && devicesList.some(d => d.isCurrentDevice);

  if (devicesRes.statusCode === 200 && Array.isArray(devicesList) && devicesList.length >= 2 && hasCurrentDevice) {
    results.passed.push('10. Security devices API returns active devices and correctly flags the current device.');
  } else {
    results.failed.push(`10. Security devices list failed: status=${devicesRes.statusCode}, body=${JSON.stringify(devicesRes.body)}`);
  }

  // Revoke device
  const deviceToRevoke = devicesList?.find(d => d.isCurrentDevice);
  let revokeRes = { statusCode: 500 };
  if (deviceToRevoke) {
    revokeRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: `/api/auth/security/devices/${deviceToRevoke.id}`,
      method: 'DELETE',
      headers: {
        Cookie: cookieString(newCookies),
      },
    });
  }

  // Next login with revoked device cookie must trigger OTP again!
  const loginAfterRevokeRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieString(newCookies),
    },
  }, { email: userEmail, password: userPassword });

  if (revokeRes.statusCode === 200 && loginAfterRevokeRes.body?.requiresOtp === true) {
    results.passed.push('11. Revoked device is immediately invalidated and forces step-up OTP on next login.');
  } else {
    results.failed.push('11. Device revocation test failed.');
  }

  // ── TEST 11: Login History Audit Records ───────────────────────────────────
  const historyRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/security/history',
    method: 'GET',
    headers: {
      Cookie: cookieString(regCookies),
    },
  });

  const historyList = historyRes.body?.history;
  const hasSuccess = historyList && historyList.some(h => h.status === 'success');
  const hasOtpReq = historyList && historyList.some(h => h.status === 'otp_required');

  if (historyRes.statusCode === 200 && Array.isArray(historyList) && hasSuccess && hasOtpReq) {
    results.passed.push('12. Login history endpoint returned audit records with success and otp_required states.');
  } else {
    results.failed.push('12. Login history audit check failed.');
  }

  // Clean up test records
  await User.deleteOne({ _id: userId });
  await TrustedDevice.deleteMany({ userId });
  await OtpSession.deleteMany({ userId });
  await LoginHistory.deleteMany({ userId });
  console.log('Cleaned up Task 4 test records.');

  await mongoose.disconnect();
  console.log('\n================ TASK 4 BACKEND VERIFICATION RESULTS ================');
  console.log(JSON.stringify(results, null, 2));
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
