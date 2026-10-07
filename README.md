# ระบบรับสมัครคัดเลือกบุคลากร (SAO Recruitment System)

ระบบรับสมัครงานออนไลน์ สำหรับสำนักงานการตรวจเงินแผ่นดิน (สตง.)
พัฒนาและ Deploy บน Cloudflare Edge Platform ทั้งหมด

> **Production URLs**
> - Frontend: <https://sao-recruitment-frontend.pages.dev>
> - Backend API: <https://sao-recruitment-backend.hrmsao.workers.dev>

---

## 📑 สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [โครงสร้างโปรเจกต์](#2-โครงสร้างโปรเจกต์)
3. [ติดตั้งเครื่องใหม่ตั้งแต่ 0](#3-ติดตั้งเครื่องใหม่ตั้งแต่-0)
4. [การรัน Local Development](#4-การรัน-local-development)
5. [Environment Variables](#5-environment-variables)
6. [Cloudflare Configuration](#6-cloudflare-configuration)
7. [Frontend Deployment (แนะนำ)](#7-frontend-deployment-แนะนำ)
8. [Manual Deployment](#8-manual-deployment)
9. [Troubleshooting](#10-troubleshooting)
10. [.gitignore ที่แนะนำ](#11-gitignore-ที่แนะนำ)
11. [Deployment Checklist](#12-deployment-checklist)
12. [Daily Workflow](#13-daily-workflow)
13. [Recovery Guide](#14-recovery-guide)

---

## 1. ภาพรวมระบบ

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14 (App Router) + React 18 + TypeScript | UI สำหรับผู้สมัครและผู้ดูแลระบบ |
| **Styling** | Tailwind CSS | UI Framework |
| **Forms** | React Hook Form | Form state management |
| **Backend** | Hono + TypeScript | REST API |
| **Runtime** | Cloudflare Workers (Node.js compat) | Serverless runtime |
| **Database** | Cloudflare D1 (SQLite) | Primary database |
| **ORM** | Drizzle ORM | Type-safe DB access |
| **Storage** | Cloudflare R2 | ไฟล์แนบ (PDF, รูปภาพ) |
| **Auth** | JWT (HS256) | Admin authentication |
| **Frontend Host** | Cloudflare Pages | Static hosting + CDN |
| **Backend Host** | Cloudflare Workers | Serverless API |
| **CI/CD** | Cloudflare Auto Deploy (Git Integration) | Auto deploy จาก GitHub |

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Cloudflare Edge                      │
│                                                  │
│  ┌──────────────────┐       ┌──────────────────┐   │
│  │  Pages (Frontend) │  ←──→ │ Workers (Backend) │   │
│  │  Static HTML/JS   │       │  Hono + REST API  │   │
│  └──────────────────┘       └────────┬─────────┘   │
│                                       │                │
│                          ┌────────────┴────────┐    │
│                          │                      │    │
│                  ┌───────▼──────┐      ┌────────▼──┐│
│                  │  D1 Database │      │ R2 Bucket ││
│                  │   (SQLite)   │      │  (Files)   ││
│                  └──────────────┘      └────────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 2. โครงสร้างโปรเจกต์

```
recruitment/
├── frontend/                          # Next.js Application
│   ├── src/
│   │   ├── (public)/                  # Public routes group
│   │   │   ├── page.tsx               # หน้าแรก - รายการรอบรับสมัคร
│   │   │   ├── layout.tsx             # Layout สำหรับ public
│   │   │   └── apply/
│   │   │       ├── page.tsx           # ฟอร์มสมัคร (ใช้ query param ?id=)
│   │   │       └── success/page.tsx   # หน้าสำเร็จ
│   │   ├── (admin)/                   # Admin routes group
│   │   │   ├── layout.tsx             # Layout สำหรับ admin
│   │   │   └── admin/
│   │   │       ├── login/page.tsx
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── rounds/page.tsx
│   │   │       ├── fields/page.tsx
│   │   │       ├── templates/page.tsx
│   │   │       ├── applications/page.tsx
│   │   │       └── audit-logs/page.tsx
│   │   ├── components/
│   │   │   ├── ui/                    # shadcn-style UI components
│   │   │   └── FileUpload.tsx
│   │   ├── app/
│   │   │   └── layout.tsx             # Root layout
│   │   └── lib/
│   ├── public/                        # Static assets
│   ├── next.config.js                 # Next.js configuration
│   ├── wrangler.jsonc                 # Cloudflare Pages config
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                            # Hono API on Cloudflare Workers
│   ├── src/
│   │   ├── index.ts                    # Main entry point
│   │   ├── types.ts                    # TypeScript bindings
│   │   ├── routes/
│   │   │   ├── public.routes.ts        # Public APIs (no auth)
│   │   │   ├── admin.routes.ts         # Admin APIs (JWT required)
│   │   │   └── upload.routes.ts        # File upload APIs
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.ts
│   │   │   └── audit.middleware.ts
│   │   ├── db/
│   │   │   ├── schema.ts               # Drizzle schema
│   │   │   └── relations.ts
│   │   └── schemas/
│   │       └── validators.ts           # Zod validators
│   ├── drizzle/                        # Generated migrations
│   ├── wrangler.toml                   # Workers configuration
│   ├── drizzle.config.ts               # Drizzle Kit config
│   ├── package.json
│   └── tsconfig.json
│
├── docs/                              # Documentation
│   ├── Database Schema.sql             # Full SQL schema
│   └── Entity Relationship Diagram.md
│
└── .gitignore
```

---

## 3. ติดตั้งเครื่องใหม่ตั้งแต่ 0

### 3.1 Prerequisites

ติดตั้งเครื่องมือเหล่านี้ก่อน:

| Tool | Version | Install |
|------|---------|------|
| **Node.js** | 18.17+ (แนะนำ 20.x) | `brew install node` |
| **npm** | มาพร้อม Node.js | - |
| **Git** | latest | `brew install git` |
| **Wrangler** | 3.x | `npm install -g wrangler` |

ตรวจสอบการติดตั้ง:

```bash
node --version    # ควร >= v18.17
npm --version
wrangler --version
```

### 3.2 Clone Repository

```bash
cd ~
git clone https://github.com/<your-org>/recruitment.git
cd recruitment
```

### 3.3 ติดตั้ง Frontend

```bash
cd frontend
npm install
```

ผลลัพธ์ที่ควรเห็น:

```
added 500+ packages in 30s
```

### 3.4 ติดตั้ง Backend

```bash
cd ../backend
npm install
```

### 3.5 ตั้งค่า Cloudflare Authentication

```bash
wrangler login
```

เบราว์เซอร์จะเปิดขึ้นให้ login และอนุญาต Wrangler

### 3.6 ตั้งค่า Environment Variables

**Backend** — สร้างไฟล์ `backend/.dev.vars`:

```bash
cd backend
cp .dev.vars.example .dev.vars
# แก้ไขค่าใน .dev.vars ด้วยค่าจริง
```

⚠️ **ห้าม commit `.dev.vars` เข้า Git** (อยู่ใน `.gitignore` แล้ว)

---

## 4. การรัน Local Development

### 4.1 Frontend (Terminal 1)

```bash
cd frontend
npm run dev
```

เปิดได้ที่: <http://localhost:3000>

### 4.2 Backend (Terminal 2)

```bash
cd backend
npm run dev
# หรือ
wrangler dev
```

API จะรันที่: <http://localhost:8787>

### 4.3 ตั้งค่า Frontend ให้ชี้ไปยัง Local Backend

สร้างไฟล์ `frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8787/api/v1
```

### 4.4 รัน Database Migrations (Local D1)

```bash
cd backend
wrangler d1 execute sao-db --local --file=./drizzle/0000_initial.sql
```

---

## 5. Environment Variables

### 5.1 Frontend (`frontend/.env.local`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | ✅ | Backend API URL | `http://localhost:8787/api/v1` |

> ⚠️ ต้องขึ้นต้นด้วย `NEXT_PUBLIC_` เพื่อให้ client-side เข้าถึงได้

### 5.2 Backend (`backend/.dev.vars`)

```bash
# JWT Secret (ใช้ random string ยาวอย่างน้อย 32 chars)
JWT_SECRET=change_me_to_a_random_secret_string_at_least_32_chars

# R2 Storage Credentials
R2_ACCOUNT_ID=your_r2_account_id_here
R2_ACCESS_KEY_ID=your_r2_access_key_id_here
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key_here
R2_BUCKET_NAME=sao-storage
```

### 5.3 Backend Production (`backend/wrangler.toml` [vars])

```toml
[vars]
JWT_SECRET = "REPLACE_WITH_SUPER_SECRET_KEY"
```

> ⚠️ JWT_SECRET ใน Production ควรตั้งผ่าน **Cloudflare Dashboard > Workers > Settings > Variables** ไม่ควร hardcode

---

## 6. Cloudflare Configuration

### 6.1 Pages Project

| Setting | Value |
|---------|-------|
| **Project Name** | `sao-recruitment-frontend` |
| **Production URL** | <https://sao-recruitment-frontend.pages.dev> |
| **Build Command** | `npm run build` |
| **Build Output Directory** | `out` |
| **Root Directory** | `frontend` |
| **Compatibility Date** | `2024-01-01` |
| **Environment Variable** | `NEXT_PUBLIC_API_URL` = `https://sao-recruitment-backend.hrmsao.workers.dev/api/v1` |

ไฟล์ config: `frontend/wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sao-recruitment-frontend",
  "compatibility_date": "2024-01-01",
  "pages_build_output_dir": "out",
  "observability": {
    "enabled": true
  }
}
```

### 6.2 Workers Project

| Setting | Value |
|---------|-------|
| **Worker Name** | `sao-recruitment-backend` |
| **Production URL** | <https://sao-recruitment-backend.hrmsao.workers.dev> |
| **Main Entry** | `src/index.ts` |
| **Compatibility Date** | `2026-10-07` |
| **Compatibility Flags** | `nodejs_compat` |

ไฟล์ config: `backend/wrangler.toml`

```toml
name = "sao-recruitment-backend"
main = "src/index.ts"
compatibility_date = "2026-10-07"
compatibility_flags = ["nodejs_compat"]
```

### 6.3 D1 Database

| Setting | Value |
|---------|-------|
| **Database Name** | `sao-db` |
| **Database ID** | `c8c9e923-0b64-4203-880b-ea5af58d316f` |
| **Binding Name** | `DB` |

Migration commands:

```bash
# Local
wrangler d1 execute sao-db --local --file=./drizzle/0000_initial.sql

# Production
wrangler d1 execute sao-db --remote --file=./drizzle/0000_initial.sql
```

### 6.4 R2 Bucket

| Setting | Value |
|---------|-------|
| **Bucket Name** | `sao-storage` |
| **Binding Name** | `R2_BUCKET` |

API Token ที่ต้องตั้ง (ใน `.dev.vars` หรือ Cloudflare Dashboard):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

### 6.5 Git Integration (Auto Deploy)

Cloudflare Pages เชื่อมกับ GitHub repository:

1. ไปที่ <https://dash.cloudflare.com/?to=/:account/pages>
2. เลือก `sao-recruitment-frontend`
3. Settings → Builds → ตรวจสอบว่าเชื่อมกับ GitHub repo `recruitment`
4. Production branch: `main`
5. Root directory: `frontend`
6. Build command: `npm run build`
7. Build output: `out`

---

## 7. Frontend Deployment (แนะนำ)

### ใช้ Cloudflare Auto Deploy จาก GitHub

เมื่อตั้งค่า Git Integration เรียบร้อยแล้ว **ทุกครั้งที่ push ไปยัง `main` branch** Cloudflare จะ:

1. ตรวจจับ commit ใหม่
2. Trigger build อัตโนมัติ
3. Deploy ไปยัง Production URL
4. แสดงผลที่ <https://sao-recruitment-frontend.pages.dev>

### Production Deployment Flow

```
┌────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   GitHub   │────▶│  Cloudflare Build  │────▶│  Cloudflare Deploy │
│  (main)    │     │   (Auto-trigger)   │     │   (Auto-deploy)    │
└────────────┘     └────────────────────┘     └────────────────────┘
                                                        │
                                                        ▼
                                              ┌────────────────────┐
                                              │ sao-recruitment-    │
                                              │  frontend.pages.dev │
                                              └────────────────────┘
```

### คำสั่งปกติ

```bash
cd recruitment

# 1. แก้ไขโค้ด
# 2. ตรวจสอบ
cd frontend && npm run build     # ทดสอบ build ก่อน push

# 3. Commit & Push
git add .
git commit -m "feat: add new feature"
git push origin main

# 4. รอ Cloudflare build/deploy (ประมาณ 1-2 นาที)
# 5. ตรวจสอบที่ https://sao-recruitment-frontend.pages.dev
```

---

## 8. Manual Deployment

ใช้ในกรณีที่ต้องการ deploy โดยไม่ผ่าน GitHub (เช่น test ด่วน หรือ CI/CD pipeline)

### 8.1 Frontend

```bash
cd frontend
npm run deploy
```

คำสั่งนี้จะ:

1. รัน `next build` (สร้าง static export)
2. รัน `wrangler pages deploy out`
3. Deploy ไปยัง `sao-recruitment-frontend` Pages project

⚠️ **ต้อง Login Wrangler ก่อน:** `wrangler login`

### 8.2 Backend

```bash
cd backend
npx wrangler deploy
```

คำสั่งนี้จะ:

1. Build TypeScript
2. Deploy ไปยัง `sao-recruitment-backend` Worker
3. Apply environment variables จาก `wrangler.toml`

---

## 10. Troubleshooting

### 🚨 ปัญหาที่เคยเจอจริง

#### ปัญหา 1: `pages_build_output_dir` ตั้งเป็น `.next` แล้วเว็บ 404/ขาว

**อาการ:**

- Deploy สำเร็จ แต่เปิดเว็บแล้วเป็นหน้าขาว
- `curl -I https://sao-recruitment-frontend.pages.dev` ได้ HTTP 403

**สาเหตุ:**

- Cloudflare Pages มองหา `index.html` แต่โฟลเดอร์ `.next` ไม่มี
- `.next/` มีแต่ Next.js server bundle (compiled JS) ไม่ใช่ static HTML

**วิธีแก้:**

ใน `frontend/wrangler.jsonc`:

```jsonc
{
  "pages_build_output_dir": "out"  // ❌ อย่าใช้ ".next"
}
```

และใน `frontend/next.config.js`:

```js
const nextConfig = {
  output: 'export',     // ต้องเปิด static export
  trailingSlash: true,
  // ...
};
```

#### ปัญหา 2: Frontend ขึ้นหน้าขาว (White Screen)

**อาการ:** หน้าเว็บแสดงผล แต่ไม่มี UI

**ตรวจสอบเบื้องต้น:**

1. เปิด Browser DevTools → Console ดู errors
2. ตรวจสอบ Network tab ว่า assets โหลดสำเร็จหรือไม่

**สาเหตุที่เจอบ่อย:**

| สาเหตุ | วิธีแก้ |
|--------|---------|
| API URL ผิด | ตั้ง `NEXT_PUBLIC_API_URL` ใน Cloudflare Pages env |
| API ตอบ CORS error | ตรวจ `cors()` middleware ใน `backend/src/index.ts` |
| 404 บน dynamic route | ตรวจว่าใช้ `output: 'export'` กับ query params แทน |

#### ปัญหา 3: Cloudflare Deploy ผ่าน แต่เปิดเว็บแล้ว 404

**สาเหตุ:**

- ไฟล์ `index.html` ไม่อยู่ใน root ของ build output
- หรือ build ไม่ได้ generate static HTML

**ตรวจสอบ:**

```bash
cd frontend
npm run build
ls -la out/    # ต้องเห็น index.html
```

#### ปัญหา 4: `out` directory ถูก commit เข้า Git

**อาการ:**

- `git status` แสดงไฟล์ใน `out/` เป็น staged
- Repository ใหญ่ขึ้นเรื่อยๆ

**วิธีแก้:**

```bash
# ลบออกจาก Git index (เก็บไฟล์ไว้ในเครื่อง)
git rm -r --cached frontend/out/

# commit
git add .gitignore
git commit -m "chore: ignore frontend/out"
git push origin main
```

ตรวจสอบว่า `.gitignore` มี:

```gitignore
frontend/out/
frontend/.next/
```

#### ปัญหา 5: `.dev.vars` ถูก commit เข้า Git

**อาการ:** JWT_SECRET หรือ R2 credentials รั่วไหล

**วิธีแก้:**

```bash
# ลบออกจาก Git history
git rm --cached backend/.dev.vars
git commit -m "chore: remove .dev.vars from tracking"
git push origin main

# ⚠️ ต้อง rotate secrets ทั้งหมดทันที
```

ตรวจสอบ `.gitignore`:

```gitignore
backend/.dev.vars
```

#### ปัญหา 6: Next.js 14.2.35 + `output: 'export'` + Dynamic Routes → Build Error

**อาการ:**

```
Error: Page "/apply/[roundId]" is missing "generateStaticParams()"
so it cannot be used with "output: export" config.
```

**สาเหตุ:**

- Next.js 14.2.35 มี bug กับ dynamic routes ใน static export
- ต้องใส่ `generateStaticParams()` ในทุก dynamic route
- แต่ถ้า page เป็น client component (`'use client'`) จะไม่ทำงาน

**วิธีแก้:** เปลี่ยนจาก dynamic route เป็น query parameter

```diff
- Link: /apply/${round.id}
+ Link: /apply?id=${round.id}
```

จากนั้นใช้ `useSearchParams()` แทน `useParams()` ใน component

#### ปัญหา 7: Wrangler Login ไม่ได้ / Permission denied

**วิธีแก้:**

```bash
wrangler logout
wrangler login
```

ตรวจสอบว่า browser เปิดขึ้นและ authorize Wrangler สำเร็จ

---

## 11. .gitignore ที่แนะนำ

ไฟล์ `.gitignore` ที่ root:

```gitignore
# Dependencies
node_modules/
**/node_modules/

# Cloudflare
.wrangler/

# Environment files
.env
.env.local
backend/.dev.vars

# Frontend build outputs
frontend/out/
frontend/.next/

# Backend build outputs
dist/
build/

# macOS
.DS_Store

# Logs
*.log
npm-debug.log*
yarn-debug.log*

# IDE
.vscode/
.idea/
*.swp
```

> ⚠️ **ห้าม commit ไฟล์เหล่านี้เด็ดขาด**
> - `backend/.dev.vars` — มี JWT_SECRET และ R2 credentials
> - `frontend/.env.local` — มี API URLs
> - `frontend/out/` — build output (ใหญ่)
> - `frontend/.next/` — Next.js cache

---

## 12. Deployment Checklist

### ก่อน Push Production

ตรวจสอบทุกข้อก่อน `git push origin main`:

- [ ] **Build ผ่าน**
  ```bash
  cd frontend && npm run build
  # ต้องเห็น ✓ Generating static pages (N/N)
  ```

- [ ] **ไม่มี `.dev.vars` ใน Git**
  ```bash
  git status | grep -i "dev.vars"
  # ต้องไม่มี output
  ```

- [ ] **ไม่มี `out/` หรือ `.next/` ใน Git**
  ```bash
  git status | grep -E "(out|\.next)/"
  # ต้องไม่มี output
  ```

- [ ] **Cloudflare Environment Variables ครบ**
  - Pages: `NEXT_PUBLIC_API_URL`
  - Workers: `JWT_SECRET`, `R2_*`

- [ ] **Cloudflare Deploy Success**
  - ดูที่ <https://dash.cloudflare.com/?to=/:account/pages>
  - ดูที่ <https://dash.cloudflare.com/?to=/:account/workers>

- [ ] **ทดสอบหลัง Deploy**
  - เปิด <https://sao-recruitment-frontend.pages.dev>
  - ตรวจ API ที่ <https://sao-recruitment-backend.hrmsao.workers.dev/health>
  - ทดสอบ login admin
  - ทดสอบ submit application

### Quick Check Command

รวม checklist ในสคริปต์เดียว:

```bash
cd recruitment

# 1. Test build
cd frontend && npm run build && cd ..

# 3. Check no secrets in git
git status | grep -E "(\.dev\.vars|\.env\.local)" && echo "❌ SECRETS DETECTED" || echo "✅ No secrets"

# 4. Check no build artifacts
git status | grep -E "(out|\.next)/" && echo "❌ BUILD ARTIFACTS" || echo "✅ No build artifacts"

# 5. If all green
git add .
git commit -m "feat: ..."
git push origin main
```

---

## 13. Daily Workflow

### การแก้โค้ดปกติ

```bash
# 1. ดึงโค้ดล่าสุด
git pull origin main

# 2. สร้าง branch ใหม่ (ถ้าทำงานเป็นทีม)
git checkout -b feature/my-new-feature

# 3. แก้ไขโค้ด
# ... (แก้ไขใน VSCode, Cursor, หรือ editor อื่นๆ)

# 4. ทดสอบ local
cd frontend
npm run build      # ตรวจ build ไม่ error
npm run dev        # ทดสอบ UI

cd ../backend
wrangler dev       # ทดสอบ API

# 5. Commit
cd ..
git add .
git commit -m "feat: add new feature"

# 6. Push (ถ้าใช้ branch)
git push origin feature/my-new-feature

# 7. Merge ผ่าน Pull Request (ถ้าทำงานเป็นทีม)
# หรือ Push ตรงเข้า main (ถ้าทำงานคนเดียว)
git checkout main
git merge feature/my-new-feature
git push origin main

# 8. รอ Cloudflare Auto Deploy (1-2 นาที)
# ดู status ได้ที่ https://dash.cloudflare.com/?to=/:account/pages
```

### Conventional Commits

ใช้ prefix ตามมาตรฐาน:

| Prefix | Use Case |
|--------|----------|
| `feat:` | เพิ่ม feature ใหม่ |
| `fix:` | แก้ bug |
| `chore:` | งานทั่วไป (update deps, refactor) |
| `docs:` | แก้เอกสาร |
| `style:` | แก้ formatting |
| `refactor:` | refactor โค้ด (ไม่ใช่ feat หรือ fix) |
| `test:` | เพิ่ม tests |

ตัวอย่าง:

```bash
git commit -m "feat: add application form validation"
git commit -m "fix: resolve 404 on admin dashboard"
git commit -m "chore: update dependencies"
```

---

## 14. Recovery Guide

### ถ้าเครื่องพังหรือเปลี่ยนเครื่องใหม่

ตั้งแต่ Clone Repo จน Deploy ขึ้น Production ได้ใหม่ทั้งหมด:

### Step 1: ติดตั้งเครื่องมือ

```bash
# macOS
brew install node git

# ตรวจสอบ
node --version    # ควร >= v18.17
git --version
```

### Step 2: Clone Repository

```bash
cd ~
git clone https://github.com/<your-org>/recruitment.git
cd recruitment
```

### Step 3: ติดตั้ง Wrangler + Login

```bash
npm install -g wrangler
wrangler login
```

Browser จะเปิด → Login → Authorize

### Step 4: ติดตั้ง Frontend

```bash
cd frontend
npm install

# ตั้ง env (ถ้ามี .env.local จาก backup)
# ถ้าไม่มี ให้สร้างใหม่:
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:8787/api/v1
EOF

# ทดสอบ build
npm run build
```

### Step 5: ติดตั้ง Backend

```bash
cd ../backend
npm install

# ตั้ง env (จาก backup หรือ Cloudflare Dashboard)
cat > .dev.vars << EOF
JWT_SECRET=<copy-from-cloudflare-dashboard>
R2_ACCOUNT_ID=<copy-from-cloudflare-dashboard>
R2_ACCESS_KEY_ID=<copy-from-cloudflare-dashboard>
R2_SECRET_ACCESS_KEY=<copy-from-cloudflare-dashboard>
R2_BUCKET_NAME=sao-storage
EOF

# ทดสอบ dev
wrangler dev
```

### Step 6: ตรวจสอบ Cloudflare Resources

ตรวจสอบว่า resources ยังครบใน Cloudflare:

```bash
# ตรวจ D1
wrangler d1 list

# ตรวจ R2
wrangler r2 bucket list

# ตรวจ Workers
wrangler deployments list

# ตรวจ Pages
wrangler pages deployment list --project-name=sao-recruitment-frontend
```

### Step 7: ทดสอบ Deploy

```bash
# Test manual deploy (ไม่ผ่าน Git)
cd frontend
npm run deploy

# ตรวจที่ https://sao-recruitment-frontend.pages.dev
```

### Step 8: ตรวจสอบ Git Integration

ถ้าใช้ Auto Deploy:

1. ไปที่ <https://dash.cloudflare.com/?to=/:account/pages>
2. เลือก `sao-recruitment-frontend`
3. Settings → Builds → Git connection
4. ตรวจว่ายังเชื่อมกับ GitHub repo

### Step 9: ทดสอบ Production

```bash
# Test backend
curl https://sao-recruitment-backend.hrmsao.workers.dev/health
# ตอบ: {"status":"ok","timestamp":...}

# Test frontend
curl -I https://sao-recruitment-frontend.pages.dev
# ตอบ: HTTP/2 200 OK
```

### Step 10: Backup Recommendations

สำรองข้อมูลเหล่านี้ไว้ใน password manager:

- Cloudflare account credentials
- GitHub account + Personal Access Token
- JWT_SECRET (Production)
- R2 API tokens

**สำรองไฟล์เหล่านี้ไว้ใน secure location:**

- `frontend/.env.local`
- `backend/.dev.vars`
- D1 database dump (`wrangler d1 export sao-db`)

---

## 📞 Contact & Support

| Resource | URL |
|----------|-----|
| **Production Frontend** | <https://sao-recruitment-frontend.pages.dev> |
| **Production API** | <https://sao-recruitment-backend.hrmsao.workers.dev> |
| **Cloudflare Dashboard** | <https://dash.cloudflare.com> |
| **Wrangler Docs** | <https://developers.cloudflare.com/workers/wrangler/> |
| **Next.js Docs** | <https://nextjs.org/docs> |
| **Hono Docs** | <https://hono.dev> |
| **Drizzle ORM Docs** | <https://orm.drizzle.team> |

---

## 📝 License

Internal use only — สำนักงานการตรวจเงินแผ่นดิน (สตง.)

---

**Last Updated:** October 7, 2026
**Maintained by:** Development Team