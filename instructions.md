# Inkwell — Deployment Guide

## Overview
- **Frontend** → Vercel (static HTML/JS/CSS)
- **Backend** → Render.com (Node.js)
- **Database** → MongoDB Atlas
- **AI** → Anthropic API (claude-sonnet-4-20250514)
- **Payments** → Stripe

---

## Step 1: MongoDB Atlas Setup

1. Go to [mongodb.com/atlas](https://mongodb.com/atlas) → Create free cluster
2. Add database user: Database Access → Add New User
3. Whitelist all IPs: Network Access → Add IP → `0.0.0.0/0`
4. Get connection string:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/inkwell
   ```

---

## Step 2: Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. API Keys → Create Key
3. Save as `ANTHROPIC_API_KEY=sk-ant-...`

---

## Step 3: Stripe Setup

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Create two Products:
   - **Inkwell Pro Monthly** → $9/month
   - **Inkwell Pro Annual** → $65/year (~$5.40/mo)
3. Note the Price IDs (`price_...`)
4. Get Secret Key from Developers → API Keys
5. Set up Webhook:
   - Endpoint: `https://your-backend.render.com/api/payments/webhook`
   - Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Step 4: Deploy Backend on Render

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect GitHub repo, select `backend/` directory
4. Settings:
   ```
   Runtime: Node
   Build: npm install
   Start: node server.js
   ```
5. Add Environment Variables:
   ```
   MONGODB_URI=mongodb+srv://...
   JWT_SECRET=your-super-secret-32-char-min
   ANTHROPIC_API_KEY=sk-ant-...
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_MONTHLY_PRICE_ID=price_...
   STRIPE_ANNUAL_PRICE_ID=price_...
   FRONTEND_URL=https://your-app.vercel.app
   NODE_ENV=production
   ```
6. Deploy → note your URL: `https://inkwell-api.onrender.com`

---

## Step 5: Deploy Frontend on Vercel

1. Update `frontend/api.js` BASE_URL:
   ```js
   const BASE_URL = 'https://inkwell-api.onrender.com/api';
   ```
2. Go to [vercel.com](https://vercel.com) → New Project
3. Import GitHub repo → select `frontend/` as root directory
4. Framework: **Other** (static)
5. No build command needed
6. Deploy → get URL: `https://inkwell-app.vercel.app`

### vercel.json
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

---

## Step 6: Custom Domain

1. Vercel → Project Settings → Domains → Add domain
2. Add DNS record at your registrar:
   ```
   CNAME www → cname.vercel-dns.com
   A    @   → 76.76.21.21
   ```
3. SSL is automatic via Let's Encrypt

---

## Step 7: Deploy AI Model (Optional)

If running custom HTR model:

```bash
# Install deps
pip install torch torchvision fastapi uvicorn pillow

# Train
cd ai-model
python model.py --data-dir dataset/iam --epochs 100

# Serve
uvicorn model:api_app --host 0.0.0.0 --port 8000
```

Deploy on **Modal.com** (GPU inference):
```python
# modal_deploy.py
import modal
stub = modal.Stub("inkwell-htr")

@stub.function(gpu="T4", image=modal.Image.debian_slim().pip_install("torch", "fastapi"))
@modal.web_endpoint(method="POST")
def recognize(item: dict):
    # load model and run inference
    pass
```

Or use **Replicate.com** to host as an API.

---

## Monitoring

- **Render** → Built-in logs and metrics
- **MongoDB Atlas** → Performance Advisor, slow queries
- **Stripe** → Dashboard for revenue, churn
- **Sentry** (recommended): `npm install @sentry/node`

---

## Scaling Strategy

### Phase 1 (0-1K users): Current Setup
- Render free/starter ($7/mo)
- MongoDB Atlas free M0
- Anthropic API pay-per-use

### Phase 2 (1K-10K users):
- Render Standard ($25/mo) with auto-scaling
- MongoDB Atlas M10 ($57/mo)
- Add Redis for session caching
- CDN for canvas thumbnails (Cloudflare R2)

### Phase 3 (10K+ users):
- Migrate to AWS/GCP
  - Frontend: CloudFront + S3
  - Backend: ECS Fargate (auto-scaling containers)
  - Database: MongoDB Atlas M30 with read replicas
  - Queue: SQS for async AI processing
  - Custom HTR model on GPU instances (g4dn.xlarge)
- Add worker queue for heavy AI jobs
- Implement per-region deployment

### AI Model Scaling:
1. Start: Anthropic API (no ops overhead)
2. Growth: Fine-tuned model on Replicate/Modal
3. Scale: Self-hosted on GPU cluster with batching
