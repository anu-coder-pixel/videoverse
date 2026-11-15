# VideoVerse — Production Environment Checklist

This checklist details every environment variable required to operate VideoVerse in production, its sensitivity level, and configuration instructions.

---

## 1. Backend Environment Variables (`server/.env`)

| Variable | Required? | Sensitive? | Purpose | Default / Example | Validation Rules |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | **Required** | No | Execution environment. Enables production security defaults (strict SameSite, HTTPS cookies, disables console OTPs). | `production` | Must be `production` in live environments. |
| `PORT` | **Required** | No | Port on which the HTTP server and Socket.IO listen. Usually injected by hosting provider (Render, Railway). | `5000` | Integer between 1024 and 65535. |
| `MONGODB_URI` | **Required** | **Yes** | Connection string for MongoDB Atlas or managed replica set. | `mongodb+srv://<user>:<pwd>@cluster0.xxx.mongodb.net/videoverse?retryWrites=true&w=majority` | Must start with `mongodb://` or `mongodb+srv://`. Network whitelist must permit server IP. |
| `JWT_SECRET` | **Required** | **Yes** | HMAC-SHA256 signing secret for session tokens. | High-entropy string (e.g. `openssl rand -hex 32`) | **Enforced:** Must be at least 32 characters long. Fail-fast on startup if shorter. |
| `JWT_EXPIRES_IN` | Optional | No | Lifetime of issued authentication JWTs. | `7d` | Valid ms duration string (e.g. `7d`, `24h`). Defaults to `7d`. |
| `CLIENT_URL` | **Required in Prod** | No | Allowed frontend origin for CORS and credentials. Supports multiple comma-separated URLs. | `https://videoverse.vercel.app` | Valid HTTP/HTTPS URL without trailing slash. Validated on startup. |
| `TRUST_PROXY` | Recommended | No | Configures Express reverse proxy hop trust when deployed behind Cloudflare, Nginx, or cloud load balancers. | `true` | Set to `true` or `1` on Render/Railway. |
| `DOWNLOAD_SIGNING_SECRET` | Optional | **Yes** | Dedicated secret for HMAC-SHA256 signed download tokens. Falls back to `JWT_SECRET` if unset. | High-entropy random string | Recommended 32+ characters. |
| `SMTP_HOST` | **Required for Live OTP** | No | Outbound SMTP server hostname. | `smtp.sendgrid.net` / `email-smtp.us-east-1.amazonaws.com` | Valid hostname. |
| `SMTP_PORT` | **Required for Live OTP** | No | Outbound SMTP server port. | `587` (TLS) or `465` (SSL) | Integer. |
| `SMTP_SECURE` | Optional | No | Whether to use SSL (`true` for port 465) or STARTTLS (`false` for port 587). | `false` | Boolean string (`true` or `false`). |
| `SMTP_USER` | **Required for Live OTP** | **Yes** | SMTP authentication username / API key ID. | `apikey` or IAM user name | Non-empty string. |
| `SMTP_PASS` | **Required for Live OTP** | **Yes** | SMTP authentication password / API key secret. | SMTP API secret | Non-empty string. |
| `SMTP_FROM` | Optional | No | Display name and sender address on verification emails. | `"VideoVerse Security" <security@videoverse.com>` | Valid RFC 5322 email string. |
| `RAZORPAY_KEY_ID` | **Required for Live Payments** | No | Live Razorpay Key ID generated in Razorpay Dashboard. | `rzp_live_...` | Starts with `rzp_live_` in production. |
| `RAZORPAY_KEY_SECRET` | **Required for Live Payments** | **Yes** | Live Razorpay Key Secret. Never expose to client. | Secret key string | Non-empty string. |
| `RAZORPAY_WEBHOOK_SECRET` | **Required for Webhooks** | **Yes** | Secret configured in Razorpay Dashboard for webhook signature verification. | Webhook signing secret | Non-empty string. |
| `STUN_SERVER_URL` | Optional | No | Public STUN server for WebRTC NAT discovery. | `stun:stun.l.google.com:19302` | Valid STUN URI. Defaults to Google STUN. |
| `TURN_SERVER_URL` | Recommended | No | Ephemeral TURN relay server URI (single or comma-separated). | `turn:turn.videoverse.com:3478?transport=udp` | Valid TURN URI. Do not embed credentials in URL. |
| `TURN_SHARED_SECRET` | Recommended | **Yes** | Static auth shared secret for dynamic HMAC-SHA1 credential generation (RFC 5766). | TURN server secret | Never prefix with `VITE_`. |
| `TURN_CREDENTIAL_TTL_SECONDS` | Optional | No | Lifetime in seconds for generated TURN credentials. | `900` (15 minutes) | Positive integer between 60 and 86400. |

---

## 2. Frontend Environment Variables (`client/.env`)

> **IMPORTANT:** In Vite, variables prefixed with `VITE_` are bundled directly into public JavaScript files sent to client browsers. Never put private secrets in `client/.env`.

| Variable | Required? | Sensitive? | Purpose | Value in Production |
| :--- | :--- | :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Optional | **NO** | Direct backend API base URL if not using proxy rewrites (e.g. `https://api.videoverse.com`). | Leave empty if using `client/vercel.json` rewrites. Set to backend URL if hosting elsewhere. |
| `VITE_SOCKET_URL` | Optional | **NO** | Direct backend WebSocket base URL for video calling signaling. | Defaults to `VITE_API_BASE_URL` or window location origin. |
| `VITE_RAZORPAY_KEY_ID` | **Required for Payments** | **NO** | Public Razorpay Key ID for opening the client-side checkout modal. | Must match `RAZORPAY_KEY_ID` in `server/.env` (`rzp_live_...`). |
| `VITE_STUN_SERVER_URL` | Optional | **NO** | Override public STUN server for WebRTC NAT traversal. | Defaults to `stun:stun.l.google.com:19302`. |
| `VITE_TURN_SERVER_URL` | Optional | **NO** | Public TURN relay server address (host:port only). | Must NEVER contain embedded username or passwords. |

---

## 3. Secret Generation & Setup Commands

### Generate High-Entropy JWT Secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Test MongoDB Atlas Connectivity
```bash
node -e "const mongoose = require('mongoose'); mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ Connected')).catch(e => console.error('❌ Failed:', e.message))"
```

### Validate Complete Server Environment Before Boot
```bash
node -e "require('./server/config/validateEnv').assertEnv(); console.log('✅ Environment configuration is 100% valid.')"
```
