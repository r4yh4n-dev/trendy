# Trendy Choice — সম্পূর্ণ সেটআপ গাইড

এই ফোল্ডারে যা আছে:

| ফাইল | কী কাজ |
|---|---|
| `index.html` | পুরো ওয়েবসাইট (নতুন ভার্সন) — API থেকে প্রোডাক্ট লোড করে |
| `worker/worker.js` | Cloudflare Worker — API key লুকিয়ে রেখে প্রোডাক্ট আনে ও অর্ডার নেয় |
| `worker/wrangler.toml` | Worker-এর সেটিংস (কোনো key নেই) |
| `manifest.webmanifest` | অ্যাপের নাম/আইকন (PWA) |
| `apple-touch-icon.png`, `favicon-48.png`, `icons/` | সাইটের আইকন |

> ⚠️ **গুরুত্বপূর্ণ:** এই ফাইলে কোনো API key নেই — এবং কখনো রাখবেন না।
> key শুধু Cloudflare-এর **Secret**-এ থাকবে।

---

## 🔴 প্রথমে জেনে নিন: এখন কী সমস্যা

আপনার Worker (`https://trendy-choice-api.r4yh4nxyz.workers.dev/`) এখন **সাইটের HTML** ফেরত দিচ্ছে, API নয়। তাই:

- `/api/products` → **404**
- `/products` → **404**

কারণ আগের ধাপে ভুল করে সাইটের কোড Worker-এ বসে গিয়েছিল। **নিচের ধাপ ১ করলেই এটা ঠিক হয়ে যাবে।**

---

## ধাপ ১ — Worker-এ নতুন কোড বসিয়ে Deploy

1. ব্রাউজারে যান: **dash.cloudflare.com** → লগইন করুন
2. বাঁ দিকের মেনু থেকে **Workers & Pages** ক্লিক করুন
3. তালিকা থেকে **trendy-choice-api** ক্লিক করুন
4. উপরে ডানে **Edit code** বাটন ক্লিক করুন (কাগজ-কলমের আইকন)
5. কোড লেখার বড় বক্সে একবার ক্লিক করুন
6. কীবোর্ডে **Ctrl + A** (সব সিলেক্ট) → **Delete**
7. `worker/worker.js` ফাইলটা Notepad দিয়ে খুলুন → **Ctrl + A** → **Ctrl + C**
8. Cloudflare-এর কোড বক্সে **Ctrl + V** দিয়ে পেস্ট করুন
9. উপরে ডানে নীল **Deploy** বাটন ক্লিক করুন
10. ছোট উইন্ডো আসবে → আবার **Deploy** চাপুন
11. সবুজ **"Deployed"** লেখা দেখবেন ✅

**যাচাই:** উপরে **Preview** ট্যাব ক্লিক করুন → URL বক্সে লিখুন `https://trendy-choice-api.r4yh4nxyz.workers.dev/` → ডানের নীল **Refresh** (গোল তীর) বাটন চাপুন।

এবার **JSON** দেখবেন (HTML নয়):
```json
{ "ok": true, "name": "Trendy Choice API", "version": "4.0.0", ... }
```
✅ JSON দেখলেই বুঝবেন ঠিক হয়েছে।

---

## ধাপ ২ — API key দুটো Secret হিসেবে বসানো

> key কখনো কোডে বা `wrangler.toml`-এ লিখবেন না — শুধু এখানে।

1. **Workers & Pages** → **trendy-choice-api** ক্লিক করুন
2. **Settings** ট্যাব ক্লিক করুন
3. বাঁ দিকের তালিকা থেকে **Variables and Secrets** ক্লিক করুন
4. **Add** বাটন ক্লিক করুন
5. **Type** ড্রপডাউনে **Secret** বেছে নিন
6. **Name** লিখুন: `API_KEY_1` (হুবহু, বড় হাতের)
7. **Value** ঘরে প্রথম সোর্সের API key পেস্ট করুন
8. **Save** / **Deploy** ক্লিক করুন
9. আবার **Add** → **Secret** → Name: `API_KEY_2` → দ্বিতীয় সোর্সের key → **Save**

**যাচাই:** `https://trendy-choice-api.r4yh4nxyz.workers.dev/` খুলুন → `"keyConfigured": true` দেখবেন দুই সোর্সের জন্যই।

> 🔒 key কখনো স্ক্রিনশটে বা চ্যাটে শেয়ার করবেন না।

---

## ধাপ ৩ — KV namespace বানিয়ে bind করা (অর্ডার সেভ করার জন্য)

KV না থাকলেও অর্ডার কাজ করবে (শুধু লগ হবে, রেসপন্স সফল আসবে)। কিন্তু অর্ডার **সেভ** করতে চাইলে এটা করুন:

### ৩ক — KV namespace বানান
1. বাঁ দিকের মেনুতে **Storage & Databases** ক্লিক করুন
2. **KV** ট্যাব ক্লিক করুন
3. **Create a namespace** বাটন ক্লিক করুন
4. নাম লিখুন: **ORDERS** → **Add**

### ৩খ — Worker-এ bind করুন
1. ফিরে যান **Workers & Pages** → **trendy-choice-api**
2. **Settings** ট্যাব ক্লিক করুন
3. বাঁ দিকের তালিকা থেকে **Variables and Secrets** (বা **Bindings**) ক্লিক করুন
4. **Add** বাটন → **KV Namespace** বেছে নিন
5. **Variable name** লিখুন: `ORDERS` (হুবহু এই নাম, বড় হাতের)
6. **KV namespace** ড্রপডাউনে **ORDERS** বেছে নিন
7. **Deploy** / **Save** ক্লিক করুন

**যাচাই:** `https://trendy-choice-api.r4yh4nxyz.workers.dev/` খুলুন → `"kv": true` দেখবেন ✅

---

## ধাপ ৪ — GitHub-এ ফাইল আপলোড করে GitHub Pages চালু

1. ব্রাউজারে যান: **github.com** → লগইন করুন
2. আপনার রিপো **r4yh4n-dev/trendy-choice** খুলুন
3. **Add file** বাটন → **Upload files** ক্লিক করুন
4. এই ফাইলগুলো ড্র্যাগ করে ছাড়ুন (বা **choose your files** দিয়ে বেছে নিন):
   - `index.html` (পুরোনো ফাইলের জায়গায় — একই নাম, তাই নিজেই বদলে যাবে)
   - `manifest.webmanifest`
   - `apple-touch-icon.png`
   - `favicon-48.png`
   - `icons/` ফোল্ডারের দুইটা PNG
5. নিচে **Commit changes** ক্লিক করুন

### GitHub Pages চালু করা
1. রিপোর উপরে **Settings** ট্যাব ক্লিক করুন
2. বাঁ দিকের তালিকা থেকে **Pages** ক্লিক করুন
3. **Source** ড্রপডাউনে **Deploy from a branch** বেছে নিন
4. **Branch** ড্রপডাউনে **main** (বা **master**) আর পাশের বক্সে **/ (root)** বেছে নিন
5. **Save** ক্লিক করুন
6. ১–২ মিনিট অপেক্ষা করুন → উপরে সবুজ লেখা দেখবেন:
   **"Your site is live at https://r4yh4n-dev.github.io/trendy-choice/"**

---

## ধাপ ৫ — CORS-এ নিজের ডোমেইন বসানো

Worker শুধু অনুমোদিত ডোমেইন থেকেই API খোলে। আপনার সাইটের ঠিকানা ইতিমধ্যেই বসানো আছে:

```
https://r4yh4n-dev.github.io
```

**নিজের ডোমেইন থাকলে** (যেমন `trendychoice.com`):

1. **Workers & Pages** → **trendy-choice-api** → **Settings**
2. **Variables and Secrets** ক্লিক করুন
3. `ALLOWED_ORIGIN` ভেরিয়েবলটা খুঁজুন → **Edit** ক্লিক করুন
4. মান লিখুন (একাধিক হলে কমা দিয়ে):
   ```
   https://r4yh4n-dev.github.io,https://trendychoice.com
   ```
5. **Save** / **Deploy** ক্লিক করুন

> ⚠️ `*` (wildcard) দেবেন না — তাহলে যে কেউ আপনার API ব্যবহার করতে পারবে।

---

## ধাপ ৬ — সব যাচাই করার লিংক

ব্রাউজারে একটা একটা করে খুলুন:

| লিংক | কী দেখা উচিত |
|---|---|
| `https://trendy-choice-api.r4yh4nxyz.workers.dev/` | JSON — `version: 4.0.0`, `keyConfigured: true`, `kv: true` |
| `https://trendy-choice-api.r4yh4nxyz.workers.dev/api/products` | প্রোডাক্টের লম্বা JSON — `"count": ৫১` (বা যত আছে) |
| `https://trendy-choice-api.r4yh4nxyz.workers.dev/api/categories` | ক্যাটাগরির তালিকা |
| `https://trendy-choice-api.r4yh4nxyz.workers.dev/health` | `{"ok":true,...}` |
| `https://r4yh4n-dev.github.io/trendy-choice/` | আপনার সাইট — প্রোডাক্ট দেখা যাবে |

**সাইটে প্রোডাক্ট না দেখালে:**
- Worker-এর `/api/products` আগে ব্রাউজারে খুলে দেখুন — প্রোডাক্ট আসছে কি না
- না এলে ধাপ ১ ও ২ আবার দেখুন (কোড পেস্ট হয়েছে? key বসেছে?)
- আসলে কিন্তু সাইটে না দেখালে — পেজটা **Ctrl + Shift + R** দিয়ে হার্ড রিফ্রেশ করুন

---

## 📋 Worker-এর সব endpoint

| Method | Path | কী করে |
|---|---|---|
| GET | `/` , `/health` | স্ট্যাটাস, version, key সেট আছে কি না |
| GET | `/api/products` (বা `/products`) | সব প্রোডাক্ট (merge করা) |
| GET | `/api/products?cat=gadget` | ক্যাটাগরি ফিল্টার |
| GET | `/api/products?q=hoodie` | নাম দিয়ে খোঁজা |
| GET | `/api/products?limit=10` | প্রথম ১০টা |
| GET | `/api/products?refresh=1` | cache এড়িয়ে নতুন করে আনা |
| GET | `/api/product/:id` | একটা প্রোডাক্ট |
| GET | `/api/categories` | ক্যাটাগরির তালিকা |
| POST | `/api/order` (বা `/orders`) | অর্ডার নেওয়া |
| POST | `/api/coupon` | কুপন যাচাই |
| OPTIONS | যেকোনো | CORS preflight |

**অর্ডার রেসপন্স:**
```json
{ "ok": true, "orderId": "TC-261110-2085", "stored": true, "finalPrice": 3270 }
```

---

## 🔐 নিরাপত্তা — যা মেনে চলা হয়েছে

- ✅ API key **শুধু** `env.API_KEY_1` / `env.API_KEY_2` থেকে পড়া হয়
- ✅ key কোথাও print / log / response-এ যায় না
- ✅ CORS শুধু অনুমোদিত ডোমেইনে (wildcard নেই)
- ✅ `wrangler.toml`-এ কোনো key নেই — শুধু secret-এর নাম
- ✅ অর্ডার লগে শুধু অর্ডার নম্বর, ফোন ও টাকা — key নয়

---

## ⚠️ যা এখনো যাচাই করা হয়নি (আপনাকে করতে হবে)

আসল সোর্স API key দুটো আমার কাছে ছিল না, তাই **businesskoro.com** ও **dropbazarbd.com**-এর সাথে সরাসরি সংযোগ টেস্ট করা যায়নি।

যা টেস্ট করা **হয়েছে** (লোকাল mock সোর্স দিয়ে):
- ✅ দুই সোর্সের merge (কম দাম জেতে, stock/rating max)
- ✅ এক সোর্স ফেল করলে অন্যটার ডেটা (`partial: true`)
- ✅ দুই সোর্স ফেল করলে 502 + বাংলা error
- ✅ key না থাকলে স্পষ্ট কারণ
- ✅ CORS (allow-list, preflight, ব্লক)
- ✅ অর্ডার নেওয়া, ভ্যালিডেশন, KV সেভ
- ✅ ৬০ সেকেন্ড cache
- ✅ কোনো key leak নেই

**আপনার করণীয়:** ধাপ ১–২ শেষ করে `/api/products` খুলে দেখুন আসল প্রোডাক্ট আসছে কি না। না এলে `wrangler.toml`-এর `SOURCE_1_URL` / `SOURCE_2_URL`-এ আপনার আসল সোর্স endpoint বসাতে হবে (Cloudflare-এর **Variables and Secrets**-এ `SOURCE_1_URL` ও `SOURCE_2_URL` নামে যোগ করলেই হবে)।

---

## 🆘 সমস্যা হলে

| সমস্যা | সমাধান |
|---|---|
| `/api/products` → 404 | ধাপ ১ করুন — Worker-এ এখনো পুরোনো কোড |
| `keyConfigured: false` | ধাপ ২ করুন — secret বসাননি |
| `kv: false` | ধাপ ৩ করুন (ঐচ্ছিক) |
| সাইটে প্রোডাক্ট নেই | Worker-এর `/api/products` আগে চেক করুন; তারপর Ctrl+Shift+R |
| "সার্ভারে সংযোগ করা যায়নি" | Worker ডিপ্লয় হয়েছে কি না দেখুন; অর্ডার লোকালি সেভ থাকবে, "আবার চেষ্টা করুন" চাপুন |
| `partial: true` | এক সোর্স ডাউন — বাকিটার ডেটা আসছে, ঠিক আছে |
