# ✦ Inkwell — AI Handwriting Notebook

> Write by hand. Think with AI. Access everywhere.

Inkwell is a production-ready SaaS application that lets users write notes by hand on any device, then convert them to text, translate, and summarize using AI — all with cloud sync and a subscription model.

---

## 🧠 Features

| Feature | Free | Pro |
|---------|------|-----|
| Handwriting canvas | ✓ | ✓ |
| Pen, highlighter, eraser | ✓ | ✓ |
| Undo / Redo | ✓ | ✓ |
| Zoom & pan | ✓ | ✓ |
| Notebooks | 3 max | Unlimited |
| AI text recognition | 10 uses | Unlimited |
| AI translation | 10 uses | Unlimited |
| AI summarization | 10 uses | Unlimited |
| PNG export | ✓ | ✓ |
| PDF export | ✗ | ✓ |
| TXT export | ✓ | ✓ |
| Cloud sync | ✓ | ✓ |
| Priority AI processing | ✗ | ✓ |

---

## 💰 Pricing

- **Free**: 10 AI credits, 3 notebooks — forever free
- **Pro Monthly**: $9/month — unlimited everything
- **Pro Annual**: $65/year ($5.40/mo) — save 40%
- **7-day free trial** on all Pro plans

---

## 🗂 Project Structure

```
inkwell/
├── frontend/
│   ├── index.html        # Main HTML shell
│   ├── style.css         # Full UI stylesheet
│   ├── app.js            # App orchestrator
│   ├── canvas.js         # Drawing engine (Bezier, zoom, pan)
│   ├── strokes.js        # Undo/redo + stroke persistence
│   ├── notebook.js       # Notebook & page management
│   ├── tools.js          # Toolbar bindings
│   ├── export.js         # PNG/PDF/TXT export
│   ├── translate.js      # AI translation
│   ├── summarize.js      # AI summarization
│   ├── auth.js           # Authentication
│   └── api.js            # Backend API client
│
├── backend/
│   ├── server.js         # Express server
│   ├── models/           # MongoDB schemas
│   ├── routes/           # API route handlers
│   ├── middleware/        # Auth, rate limiting
│   ├── package.json
│   └── .env.example
│
├── ai-model/
│   └── model.py          # CNN+BiLSTM HTR model + FastAPI server
│
├── database/
│   └── schema.md         # Full DB schema docs
│
├── deployment/
│   ├── instructions.md   # Step-by-step deployment
│   └── vercel.json       # Vercel config
│
└── docs/
    └── architecture.md   # System design
```

---

## 🚀 Quick Start

### Option A: Open Frontend Directly (Demo Mode)

```bash
# Just open in browser — no server needed!
open frontend/index.html
```

Click **"Continue as Demo"** to try without an account. All data saved in LocalStorage.

### Option B: Full Stack

**Prerequisites:** Node.js 18+, MongoDB, Anthropic API key

```bash
# 1. Clone and setup backend
cd backend
cp .env.example .env
# Fill in .env values

npm install
npm run dev
# → Server on http://localhost:3001

# 2. Open frontend
open frontend/index.html
# Or serve with: npx serve frontend/
```

---

## 🔌 API Reference

### Authentication
```
POST /api/auth/signup   { name, email, password }
POST /api/auth/login    { email, password }
GET  /api/auth/me       → current user
POST /api/auth/logout
```

### Notebooks
```
GET    /api/notebooks           → list all
POST   /api/notebooks           { name }
PUT    /api/notebooks/:id       { name }
DELETE /api/notebooks/:id
GET    /api/notebooks/:id/pages → list pages
POST   /api/notebooks/:id/pages → new page
```

### Pages
```
GET  /api/pages/:id             → page with strokes
PUT  /api/pages/:id             { name, recognizedText }
PUT  /api/pages/:id/strokes     { strokes: [...] }
DELETE /api/pages/:id
```

### AI
```
POST /api/ai/recognize   { imageData: "base64..." }     → { text }
POST /api/ai/translate   { text, targetLang }           → { translation }
POST /api/ai/summarize   { text, mode }                 → { summary }
```

### Payments
```
POST /api/payments/checkout  { plan, period }  → { url }
POST /api/payments/webhook   (Stripe events)
GET  /api/payments/subscription
```

---

## 🧠 AI System

The handwriting recognition system works in two modes:

**Current (Production):**
- Canvas renders as PNG
- Sent to Claude Vision API
- ~95% accuracy, ~2-4s latency

**Future (Custom Model):**
- CNN + BiLSTM + CTC
- Trained on IAM dataset
- ~8% CER target
- Self-hosted on GPU (Modal.com)

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, Canvas API |
| Backend | Node.js, Express |
| Database | MongoDB + Mongoose |
| AI | Anthropic Claude (Vision) |
| Auth | JWT + bcrypt |
| Payments | Stripe |
| Frontend hosting | Vercel |
| Backend hosting | Render.com |
| DB hosting | MongoDB Atlas |
| Custom AI model | Python, PyTorch, FastAPI |

---

## 📈 Scaling Roadmap

- **Phase 1** (0–1K users): Vercel + Render + Atlas free tier
- **Phase 2** (1K–10K users): Redis caching, R2 for thumbnails, Atlas M10
- **Phase 3** (10K+ users): AWS ECS, CloudFront, custom GPU inference

---

## 📄 License

MIT — build on it, sell it, ship it.

---

Made with ✦ by the Inkwell team
