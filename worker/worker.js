/* ═══════════════════════════════════════════════════════════════════════════
   Trendy Choice API — Cloudflare Worker  (v4.0.0)
   ───────────────────────────────────────────────────────────────────────────
   কী করে:
     • দুইটা সোর্স API থেকে API key দিয়ে প্রোডাক্ট আনে, এক ফরম্যাটে merge করে
     • GET  /api/products        (+ /products)   → সব প্রোডাক্ট (cat/q/limit/refresh)
     • GET  /api/categories      (+ /categories) → ক্যাটাগরি তালিকা
     • GET  /api/product/:id     (+ /product/:id)→ একটা প্রোডাক্ট
     • POST /api/order           (+ /orders)     → অর্ডার নেয় (KV-তে সেভ)
     • POST /api/coupon          (+ /coupon)     → কুপন যাচাই
     • OPTIONS preflight + সঠিক CORS
     • ৬০ সেকেন্ড in-isolate cache
     • এক সোর্স ফেল করলে অন্যটার ডেটা ফেরত দেয় (partial: true)

   নিরাপত্তা:
     • API key শুধু env.API_KEY_1 / env.API_KEY_2 থেকে পড়া হয়
     • key কোথাও print / log / response-এ যায় না
     • CORS শুধু allow-list করা origin-এ সীমিত (wildcard নেই)

   KV (ঐচ্ছিক):
     • binding নাম ORDERS থাকলে অর্ডার সেভ হয়
     • না থাকলে শুধু লগ করে সফল রেসপন্স দেয় (গ্রেসফুল)
   ═══════════════════════════════════════════════════════════════════════════ */

const VERSION = '4.0.0';

/* ── ডিফল্ট সোর্স (wrangler.toml-এর [vars] দিয়ে বদলানো যায়) ── */
const DEFAULT_SOURCE_1 = 'https://api.businesskoro.com/api/v1/storefront/products';
const DEFAULT_SOURCE_2 = 'https://dropbazarbd.com/api/products';

/* ── CORS allow-list ── */
const DEFAULT_ALLOWED = [
  'https://r4yh4n-dev.github.io',
  'https://r4yh4n-dev.github.io/trendy-choice'
];

const CACHE_TTL_MS = 60 * 1000;      // ৬০ সেকেন্ড
const UPSTREAM_TIMEOUT = 9000;       // ৯ সেকেন্ড

/* ═══════════════════════════════════════════════════════════════════════════
   CORS
   ═══════════════════════════════════════════════════════════════════════════ */
function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const list = DEFAULT_ALLOWED.concat(extra);
  if (String(env.ALLOW_LOCALHOST || '').toLowerCase() === 'true') {
    list.push('http://localhost:8080', 'http://127.0.0.1:8080', 'http://localhost:3000');
  }
  return list;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const ok = allowedOrigins(env).indexOf(origin) !== -1;
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (ok) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(data, status, request, env, extra) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    corsHeaders(request, env),
    extra || {}
  );
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
function pick(v, lang) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v[lang] || v.bn || v.en || '';
  return String(v);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCE FETCH + NORMALIZE
   ═══════════════════════════════════════════════════════════════════════════ */
async function fetchSource(source, env) {
  const key = source.keyEnv ? env[source.keyEnv] : '';
  if (source.keyEnv && !key) {
    return { ok: false, reason: 'missing secret ' + source.keyEnv, products: [] };
  }

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'TrendyChoice-Worker/' + VERSION
  };
  if (key) {
  headers['x-api-key'] = key;
}

  try {
    const res = await withTimeout(fetch(source.url, { headers }), UPSTREAM_TIMEOUT);
    if (!res.ok) return { ok: false, reason: 'upstream HTTP ' + res.status, products: [] };

    const body = await res.json();
    const raw = Array.isArray(body)
      ? body
      : (body.products || body.data || body.items || []);

    if (!Array.isArray(raw)) {
      return { ok: false, reason: 'unexpected response shape', products: [] };
    }
    return { ok: true, products: raw.map(p => normalize(p, source)), count: raw.length };
  } catch (e) {
    const msg = e && e.message === 'timeout' ? 'upstream timeout' : 'upstream unreachable';
    return { ok: false, reason: msg, products: [] };
  }
}

function normalize(p, source) {
  const nameBn = pick(p.name, 'bn') || pick(p.title, 'bn') || pick(p.name, 'en');
  const nameEn = pick(p.name, 'en') || pick(p.title, 'en') || nameBn;
  const descBn = pick(p.desc || p.description, 'bn');
  const descEn = pick(p.desc || p.description, 'en') || descBn;

  const gallery = []
    .concat(Array.isArray(p.gallery) ? p.gallery : [])
    .concat(Array.isArray(p.images) ? p.images : [])
    .concat(p.img ? [p.img] : [])
    .concat(p.image ? [p.image] : [])
    .filter(Boolean);
  const images = gallery.filter((v, i) => gallery.indexOf(v) === i);

  const stock = p.stock != null ? num(p.stock)
    : (p.stockQuantity != null ? num(p.stockQuantity) : 0);
  const inStock = p.inStock != null ? !!p.inStock : stock > 0;

  let variants = [];
  if (Array.isArray(p.variants)) {
    variants = p.variants.map((v, i) => ({
      id: v.id || 'v' + i,
      color: v.color || null,
      size: v.size || null,
      stockQuantity: v.stockQuantity != null ? num(v.stockQuantity) : num(v.stock),
      inStock: v.inStock != null ? !!v.inStock : true
    }));
  } else if (p.variants && typeof p.variants === 'object') {
    Object.keys(p.variants).forEach((k, i) => {
      const v = p.variants[k];
      variants.push({
        id: 'v' + i,
        color: (v && v.color) || null,
        size: (v && v.size) || k,
        stockQuantity: num(v && (v.stockQuantity != null ? v.stockQuantity : v.stock)),
        inStock: true
      });
    });
  }

  const id = String(
    p.id || p.spid || p.sku || slugify(nameEn) || Math.random().toString(36).slice(2)
  );
  const cat = p.cat || p.category || p.categoryId || 'gadget';

  return {
    id,
    spid: p.spid || p.sku || id,
    supplier: source.id,
    supplierName: source.name,
    sources: [source.id],
    name: nameEn,
    description: descEn,
    images,
    price: num(p.suggestedPrice != null ? p.suggestedPrice : p.price),
    oldPrice: num(p.oldPrice || p.comparePrice || 0),
    stock,
    inStock,
    variants,
    nameBn,
    nameEn,
    descBn,
    descEn,
    cat,
    catName: p.catName || { bn: cat, en: cat },
    img: images[0] || '',
    gallery: images,
    rating: num(p.rating),
    reviews: num(p.reviews),
    badges: Array.isArray(p.badges) ? p.badges : [],
    featured: !!p.featured,
    trending: !!p.trending,
    bestseller: !!p.bestseller,
    isNew: !!p.isNew
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE — একই প্রোডাক্ট দুই সোর্সে থাকলে এক করে দেয়
   ═══════════════════════════════════════════════════════════════════════════ */
function mergeProducts(lists) {
  const map = new Map();

  lists.forEach(list => {
    list.forEach(p => {
      const key = String(p.spid || p.id).toLowerCase();
      const prev = map.get(key);

      if (!prev) { map.set(key, p); return; }

      // কম দাম জেতে
      const cheaper = (p.price > 0 && (prev.price === 0 || p.price < prev.price)) ? p : prev;
      const other = cheaper === p ? prev : p;

      const merged = Object.assign({}, cheaper);
      merged.price = cheaper.price || other.price;
      merged.oldPrice = Math.max(prev.oldPrice || 0, p.oldPrice || 0);
      merged.stock = Math.max(prev.stock || 0, p.stock || 0);
      merged.inStock = prev.inStock || p.inStock;
      merged.rating = Math.max(prev.rating || 0, p.rating || 0);
      merged.reviews = Math.max(prev.reviews || 0, p.reviews || 0);
      merged.images = (prev.images || []).concat(p.images || [])
        .filter((v, i, a) => a.indexOf(v) === i);
      merged.gallery = merged.images;
      merged.img = merged.images[0] || '';
      merged.description = (p.description || '').length > (prev.description || '').length
        ? p.description : prev.description;
      merged.descEn = merged.description;
      merged.variants = (prev.variants || []).length >= (p.variants || []).length
        ? prev.variants : p.variants;
      merged.sources = (prev.sources || []).concat(p.sources || [])
        .filter((v, i, a) => a.indexOf(v) === i);
      merged.supplier = merged.sources.join('+');
      merged.supplierName = merged.sources
        .map(s => (s === prev.supplier ? prev.supplierName : p.supplierName))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(' + ');

      map.set(key, merged);
    });
  });

  return Array.from(map.values());
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRODUCT LOADER (৬০ সেকেন্ড in-isolate cache)
   ═══════════════════════════════════════════════════════════════════════════ */
let MEM = { at: 0, payload: null };

async function loadProducts(env, force) {
  const now = Date.now();
  if (!force && MEM.payload && now - MEM.at < CACHE_TTL_MS) {
    return Object.assign({}, MEM.payload, { cached: true });
  }

  const sources = [
    {
      id: 'businesskoro',
      name: 'Business Koro',
      url: env.SOURCE_1_URL || DEFAULT_SOURCE_1,
      keyEnv: 'API_KEY_1'
    },
    {
      id: 'dropbazarbd',
      name: 'DropBazarBD',
      url: env.SOURCE_2_URL || DEFAULT_SOURCE_2,
      keyEnv: 'API_KEY_2'
    }
  ];

  const results = await Promise.all(sources.map(s => fetchSource(s, env)));
  const okLists = results.filter(r => r.ok).map(r => r.products);
  const products = mergeProducts(okLists);

  const sourceReport = results.map((r, i) => ({
    id: sources[i].id,
    name: sources[i].name,
    ok: r.ok,
    count: r.ok ? r.products.length : 0,
    reason: r.ok ? undefined : r.reason
  }));

  const cats = {};
  products.forEach(p => {
    const c = p.cat || 'gadget';
    if (!cats[c]) cats[c] = { id: c, name: p.catName || { bn: c, en: c }, count: 0 };
    cats[c].count++;
  });

  const payload = {
    ok: products.length > 0,
    partial: results.some(r => !r.ok) && products.length > 0,
    count: products.length,
    total: products.length,
    updatedAt: new Date().toISOString(),
    cached: false,
    sources: sourceReport,
    categories: Object.keys(cats).map(k => cats[k]),
    deliveryCharges: { insideDhaka: 70, outsideDhaka: 130 },
    customerPaysDelivery: true,
    products
  };

  if (products.length) MEM = { at: now, payload };
  return payload;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ORDER
   ═══════════════════════════════════════════════════════════════════════════ */
function orderId() {
  const ymd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rnd = String(Math.floor(Math.random() * 9000) + 1000);
  return 'TC-' + ymd + '-' + rnd;
}

/* ফ্রন্টএন্ড দুই রকম payload পাঠাতে পারে:
   ১) নতুন সাইট  → { productId, customerName, customerPhone, customerAddress, ... }
   ২) পুরোনো সাইট → { name, phone, address, items:[...], total, ... }
   দুটোই সাপোর্ট করা হয়। */
function readOrder(body) {
  const b = body || {};

  const name = String(b.name || b.customerName || '').trim();
  const phone = String(b.phone || b.customerPhone || '').trim();
  const address = String(b.address || b.customerAddress || '').trim();
  const division = String(b.division || b.customerDivision || '').trim();
  const district = String(b.district || b.customerDistrict || '').trim();
  const area = String(b.area || b.customerArea || '').trim();
  const note = String(b.note || b.customerNote || '').trim();
  const payment = String(b.payment || b.paymentMethod || 'cod').trim();
  const trxId = String(b.trxId || '').trim();
  const senderNumber = String(b.senderNumber || '').trim();
  const couponCode = String(b.couponCode || '').trim();

  // items — নতুন সাইটে এক আইটেম, পুরোনোতে অ্যারে
  let items = [];
  if (Array.isArray(b.items) && b.items.length) {
    items = b.items.map(it => ({
      id: String(it.id || it.productId || ''),
      name: String(it.name || ''),
      qty: num(it.qty) || 1,
      price: num(it.price),
      variant: it.variant || null
    }));
  } else if (b.productId) {
    items = [{
      id: String(b.productId),
      name: String(b.productName || ''),
      qty: num(b.qty) || 1,
      price: num(b.price),
      variant: (b.color || b.size) ? { color: b.color || null, size: b.size || null } : null
    }];
  }

  return {
    name, phone, address, division, district, area, note,
    payment, trxId, senderNumber, couponCode, items,
    subtotal: num(b.subtotal),
    discount: num(b.discount),
    delivery: num(b.delivery),
    total: num(b.total)
  };
}

function validateOrder(o) {
  const errors = [];
  if (o.name.length < 2) errors.push('নাম সঠিকভাবে দিন');
  if (!/^01[3-9]\d{8}$/.test(o.phone)) {
    errors.push('মোবাইল নম্বর সঠিক নয় (১১ ডিজিট, 01XXXXXXXXX)');
  }
  if (o.address.length < 5) errors.push('সম্পূর্ণ ঠিকানা দিন');
  if (!o.items.length) errors.push('কার্টে কোনো প্রোডাক্ট নেই');
  return errors;
}

async function handleOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(
      { ok: false, error: 'অর্ডারের তথ্য পড়া যায়নি (invalid JSON)' },
      400, request, env
    );
  }

  const o = readOrder(body);
  const errors = validateOrder(o);
  if (errors.length) {
    return json({ ok: false, error: errors[0], errors }, 400, request, env);
  }

  const id = orderId();
  const record = {
    id,
    createdAt: new Date().toISOString(),
    name: o.name,
    phone: o.phone,
    address: o.address,
    division: o.division,
    district: o.district,
    area: o.area,
    note: o.note,
    payment: o.payment,
    trxId: o.trxId,
    senderNumber: o.senderNumber,
    couponCode: o.couponCode,
    items: o.items,
    subtotal: o.subtotal,
    discount: o.discount,
    delivery: o.delivery,
    total: o.total,
    status: 'new',
    userAgent: request.headers.get('User-Agent') || ''
  };

  let stored = false;
  let storeNote = '';

  if (env.ORDERS && typeof env.ORDERS.put === 'function') {
    try {
      await env.ORDERS.put('order:' + id, JSON.stringify(record), {
        metadata: { phone: record.phone, total: record.total, at: record.createdAt }
      });
      try {
        const idxRaw = await env.ORDERS.get('index:recent');
        const idx = idxRaw ? JSON.parse(idxRaw) : [];
        idx.unshift({ id, at: record.createdAt, total: record.total, phone: record.phone });
        await env.ORDERS.put('index:recent', JSON.stringify(idx.slice(0, 200)));
      } catch (e) { /* index ঐচ্ছিক */ }
      stored = true;
    } catch (e) {
      storeNote = 'KV write failed';
    }
  } else {
    storeNote = 'KV binding ORDERS not configured — order logged only';
  }

  if (!stored) {
    // ⚠️ key কখনো লগ হয় না — শুধু অর্ডার নম্বর, ফোন ও টাকা
    console.log('[order] ' + id + ' | ' + record.phone + ' | ৳' + record.total + ' | ' + storeNote);
  }

  return json({
    ok: true,
    orderId: id,
    id,
    stored,
    finalPrice: record.total,
    total: record.total,
    discount: record.discount,
    message: 'অর্ডার গ্রহণ করা হয়েছে'
  }, 201, request, env);
}

/* ═══════════════════════════════════════════════════════════════════════════
   COUPON
   ═══════════════════════════════════════════════════════════════════════════ */
async function handleCoupon(request, env) {
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const code = String((body && body.code) || '').trim().toUpperCase();

  if (!code) {
    return json({ ok: true, valid: false, message: 'কুপন কোড লিখুন' }, 200, request, env);
  }

  // কুপন এখনো চালু নেই — ভবিষ্যতে KV থেকে পড়া যাবে
  let table = null;
  if (env.ORDERS && typeof env.ORDERS.get === 'function') {
    try {
      const raw = await env.ORDERS.get('coupons');
      if (raw) table = JSON.parse(raw);
    } catch (e) { table = null; }
  }

  if (table && table[code]) {
    const c = table[code];
    const items = Array.isArray(body.items) ? body.items : [];
    const perItem = num(c.perItem);
    const totalDiscount = perItem * Math.max(items.length, 1);
    return json({
      ok: true, valid: true, code,
      totalDiscount,
      discounts: items.map(it => ({ productId: it.productId, amount: perItem }))
    }, 200, request, env);
  }

  return json({
    ok: true, valid: false,
    message: 'কুপনটি বৈধ নয় বা মেয়াদ শেষ'
  }, 200, request, env);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    // ── CORS preflight ──
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      /* ── root / health ── */
      if (path === '/' || path === '/health' || path === '/api/health' || path === '/api') {
        return json({
          ok: true,
          name: 'Trendy Choice API',
          version: VERSION,
          endpoints: [
            'GET /api/products',
            'GET /products',
            'GET /api/product/:id',
            'GET /api/categories',
            'POST /api/order',
            'POST /orders',
            'POST /api/coupon',
            'GET /health'
          ],
          sources: [
            { id: 'businesskoro', keyConfigured: !!env.API_KEY_1 },
            { id: 'dropbazarbd', keyConfigured: !!env.API_KEY_2 }
          ],
          kv: !!env.ORDERS
        }, 200, request, env);
      }

      /* ── products ── */
      if (path === '/api/products' || path === '/products') {
        const force = url.searchParams.get('refresh') === '1';
        const data = await loadProducts(env, force);

        if (!data.count) {
          return json({
            ok: false,
            error: 'কোনো সোর্স থেকে প্রোডাক্ট পাওয়া যায়নি',
            sources: data.sources
          }, 502, request, env);
        }

        let list = data.products;
        const cat = url.searchParams.get('cat');
        const q = url.searchParams.get('q');
        const limit = num(url.searchParams.get('limit'));

        if (cat && cat !== 'all') list = list.filter(p => p.cat === cat);
        if (q) {
          const needle = q.toLowerCase();
          list = list.filter(p =>
            (p.name || '').toLowerCase().indexOf(needle) !== -1 ||
            (p.nameBn || '').toLowerCase().indexOf(needle) !== -1
          );
        }
        if (limit > 0) list = list.slice(0, limit);

        return json(
          Object.assign({}, data, { count: list.length, products: list }),
          200, request, env,
          { 'Cache-Control': 'public, max-age=60' }
        );
      }

      /* ── single product ── */
      const m = path.match(/^\/api\/product\/(.+)$/) || path.match(/^\/product\/(.+)$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const data = await loadProducts(env, false);
        const found =
          data.products.find(p => p.id === id) ||
          data.products.find(p => p.spid === id) ||
          data.products.find(p => slugify(p.name) === slugify(id));

        return found
          ? json({ ok: true, product: found }, 200, request, env)
          : json({ ok: false, error: 'প্রোডাক্ট পাওয়া যায়নি' }, 404, request, env);
      }

      /* ── categories ── */
      if (path === '/api/categories' || path === '/categories') {
        const data = await loadProducts(env, false);
        return json({
          ok: true,
          count: data.categories.length,
          categories: data.categories
        }, 200, request, env);
      }

      /* ── order ── */
      if ((path === '/api/order' || path === '/orders' || path === '/api/orders') && method === 'POST') {
        return await handleOrder(request, env);
      }

      /* ── coupon ── */
      if ((path === '/api/coupon' || path === '/coupon') && method === 'POST') {
        return await handleCoupon(request, env);
      }

      /* ── 404 ── */
      return json({ ok: false, error: 'Not found: ' + path }, 404, request, env);

    } catch (e) {
      return json({ ok: false, error: 'সার্ভারে সমস্যা হয়েছে' }, 500, request, env);
    }
  }
};
