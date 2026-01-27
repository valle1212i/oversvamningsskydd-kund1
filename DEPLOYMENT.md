# Deployment Guide - Google Cloud Run

## Environment Variables

Set these in Google Cloud Run Console:
**Cloud Run > Your Service > Edit & Deploy New Revision > Variables & Secrets**

### Required for server.js (main web server)

```bash
NODE_ENV=production
PORT=8080  # Automatically set by Cloud Run

# OpenAI API Key (required for Aurora chat feature)
OPENAI_API_KEY=sk-...

# IP Salt for hashing IP addresses (security)
# Generate: openssl rand -hex 32
IP_SALT=your-random-string-here

# Portal webhook configuration (for contact form submissions)
PORTAL_WEBHOOK_URL=https://source-database.onrender.com/api/messages
PORTAL_INBOUND_TOKEN=your-bearer-token-here

# Portal pageviews tracking (optional)
PORTAL_PAGEVIEWS_URL=https://source-database.onrender.com/api/pageviews/track
PORTAL_PAGEVIEWS_TOKEN=your-token-here
```

### Optional for payments/server.js

```bash
# MongoDB (optional - payments won't be saved if not set)
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/dbname
MONGO_DB=kundportal
MONGO_COLLECTION=payments

# Stripe configuration
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUCCESS_URL=https://vattentrygg.se/success
CANCEL_URL=https://vattentrygg.se/cancel
ALLOWED_PRICE_IDS=price_xxx,price_yyy
X_PAYMENTS_SECRET=your-secret-here
```

## Health Check Configuration

Update Cloud Run health check to use HTTP instead of TCP:

1. Go to **Cloud Run > Your Service > Edit & Deploy New Revision**
2. Under **Container**, scroll to **Health checks**
3. Change **Startup probe** from `tcp 8080` to:
   - **Type**: HTTP
   - **Path**: `/health`
   - **Initial delay**: 0s
   - **Timeout**: 10s
   - **Failure threshold**: 3

This will use the new `/health` endpoint we added to server.js.

## Troubleshooting

### "Error establishing a database connection"

This error typically means:
1. The server crashed during startup
2. Check Cloud Run logs for uncaught exceptions
3. Verify all required environment variables are set
4. Check that the `/health` endpoint is responding

### Server keeps restarting

1. Check Cloud Run logs for startup errors
2. Verify `NODE_ENV=production` is set
3. Ensure `OPENAI_API_KEY` is set if using Aurora chat
4. Check that all file paths exist (dist/, dist/data/, etc.)
