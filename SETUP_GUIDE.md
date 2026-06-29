# GEO Engine — Kurulum, Test ve Yayın Rehberi

Bu rehber seni **sıfırdan canlıya** ve oradan **Shopify App Store'da resmi yayına**
kadar adım adım götürür. Akış bilinçli olarak şu sırada:

> **Önce Render'a yükle → development mağazasında test et → sonra resmi yayına gönder.**

Çünkü uygulama bir **Node.js sunucusu**dur ve veritabanına (Neon) bağlı çalışır; en
sağlıklı test, canlı Render kurulumunun üzerinde yapılır.

**Kullandığımız ücretsiz stack:**
- **Render** — Node sunucusu (Web Service, Free plan)
- **Neon** — kalıcı ücretsiz PostgreSQL
- **UptimeRobot** — Render free servisini uyanık tutar (webhook kaçmasın)

---

## ⚙️ Önce iki küçük not

**1) pnpm gerekmiyor — npm kullan.**
Projede `pnpm-workspace.yaml` görünse de **pnpm kurmana gerek yok.** Kök dizinde
`package-lock.json` var; proje `npm` ile çalışır. Daha önce `shopify app dev`
çalıştırdığında pnpm'e ihtiyaç duymamanın sebebi: **Shopify CLI bağımlılıkları ve
tüneli senin için otomatik hallediyordu.** Bu rehberdeki tüm komutlar **npm** iledir.

**2) Node.js / Git zaten kurulu varsayılıyor.** Hızlı kontrol:
```bash
node -v    # v20.19+ veya v22.12+ olmalı
npm -v
git --version
```

---

# BÖLÜM A — HAZIRLIK

## A1. Hesaplar (hepsi ücretsiz)
- Shopify Partner: https://partners.shopify.com
- GitHub: https://github.com
- Neon: https://neon.tech
- Render: https://render.com
- UptimeRobot: https://uptimerobot.com

## A2. Shopify Partner'da uygulamayı bağla / oluştur
Bu projeyi mevcut Partner uygulamana bağlamak en kolayı (`shopify.app.toml` içinde
`client_id` zaten var):

```bash
cd C:\Users\oguzy\shop2\agent-ready
npm install
npm run config:link      # = shopify app config link
```
- CLI seni Partner hesabına yönlendirir, uygulamayı seçtirir (ya da yeni oluşturur).
- Uygulamanın adını Partner panelinde **GEO Engine** yap.
- Partner → Apps → GEO Engine → **API credentials** ekranından:
  - **Client ID** → `SHOPIFY_API_KEY`
  - **Client secret** → `SHOPIFY_API_SECRET`
  
  Bu ikisini bir kenara not et; Render'da kullanacaksın.

## A3. Neon — ücretsiz kalıcı PostgreSQL
1. https://neon.tech → GitHub ile giriş → **Create project** (Region: **Frankfurt / EU**).
2. **Connection string**'i kopyala. Şuna benzer:
   ```
   postgresql://kullanici:sifre@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
3. Bunu birazdan hem lokalde (A5) hem Render'da (B2) `DATABASE_URL` olarak kullanacaksın.

## A4. Projeyi GitHub'a yükle
Render deploy'u GitHub reposundan yapar.
```bash
cd C:\Users\oguzy\shop2\agent-ready
git init
git add .
git commit -m "GEO Engine"
# GitHub'da boş bir repo aç (ör. geo-engine), sonra:
git remote add origin https://github.com/KULLANICI_ADIN/geo-engine.git
git branch -M main
git push -u origin main
```

## A5. İlk veritabanı migration'ını üret (lokalde, bir kez)
Projede henüz `prisma/migrations` klasörü yok. Production'da tabloların oluşması için
bir kez init migration üret ve commit'le:
```bash
# Kök dizinde .env dosyası oluştur ve içine Neon bağlantını yaz:
#   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"
npx prisma migrate dev --name init
git add prisma/migrations
git commit -m "init migration"
git push
```
> Migration ile uğraşmak istemezsen bu adımı atlayabilirsin — o durumda B1'deki
> **Start Command**'ı `npx prisma db push && npm run start` yap (şema yine oluşur,
> sadece migration geçmişi tutulmaz).

---

# BÖLÜM B — RENDER'A YÜKLE (CANLI SUNUCU)

## B1. Render Web Service oluştur
1. https://render.com → GitHub ile giriş.
2. **New → Web Service** → `geo-engine` reponu seç.
3. Ayarlar:
   - **Name:** `geo-engine`  → URL'in `https://geo-engine.onrender.com` olur
   - **Region:** Frankfurt
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run setup && npm run start`
     - *(`setup` = `prisma generate && prisma migrate deploy`. A5'i atladıysan:
       `npx prisma db push && npm run start`)*
   - **Instance Type:** **Free**
4. Henüz **Create** etme — önce env değişkenlerini gir (B2).

## B2. Environment Variables (Render → Environment)
```
DATABASE_URL        = (A3'teki Neon connection string)
SHOPIFY_API_KEY     = (A2'deki Client ID)
SHOPIFY_API_SECRET  = (A2'deki Client secret)
SHOPIFY_APP_URL     = https://geo-engine.onrender.com
SCOPES              = write_products,write_metaobjects,write_metaobject_definitions,read_content
OPENAI_API_KEY      = sk-...   (OPSİYONEL — yoksa uygulama offline heuristik önerilere düşer)
NODE_ENV            = production
```
> ⚠️ AI önerileri **OpenAI** kullanır (`OPENAI_API_KEY`). Anahtar koymazsan uygulama
> çalışır ama öneriler yapay zekâ yerine yerleşik kural motorundan gelir.
> `PORT`'u **sen ayarlama** — Render otomatik verir, uygulama onu okur.

**Create Web Service** → ilk deploy başlar (~5–10 dk). Üstte durum **Live** olunca hazır.

## B3. UptimeRobot ile uyanık tut (uyku engelleme)
Render free servis 15 dk hareketsizlikte uyur. İstediğin site **UptimeRobot**:
1. https://uptimerobot.com → ücretsiz kayıt.
2. **Add New Monitor** → Type: **HTTP(s)** → URL: `https://geo-engine.onrender.com`
   → Monitoring Interval: **5 minutes** → **Create Monitor**.
Artık 5 dakikada bir ping geleceği için servis uyumaz, webhook'ları kaçırmaz.

---

# BÖLÜM C — SHOPIFY AYARLARINI RENDER'A BAĞLA

Render artık çalışıyor; şimdi Shopify'a "uygulamam burada" dememiz lazım.

## C1. `shopify.app.toml` URL'lerini güncelle
Dosyada `example.com` yazan yerleri Render adresinle değiştir:
```toml
application_url = "https://geo-engine.onrender.com"

[auth]
redirect_urls = [
  "https://geo-engine.onrender.com/auth/callback",
  "https://geo-engine.onrender.com/api/auth"
]

[app_proxy]
url = "https://geo-engine.onrender.com/proxy"
subpath = "geo"
prefix = "apps"
```

## C2. Uygulama konfigürasyonunu Shopify'a gönder
```bash
npm run deploy      # = shopify app deploy
```
Bu komut `shopify.app.toml`'daki **App URL, redirect URL, scope'lar, webhook'lar ve
app proxy** ayarlarını Shopify'a yazar. İlk seferde bir "version" oluşturmayı onaylat.

> 🔑 İki ayrı "deploy" var, karıştırma:
> - **Render deploy** = sunucuyu (kodu) çalıştırır. (git push ile tetiklenir.)
> - **`npm run deploy` (shopify app deploy)** = Shopify tarafındaki ayarları (URL,
>   webhook, app proxy) günceller. Kod değiştirmediğin sürece tekrar gerekmez.

---

# BÖLÜM D — TEST (Render üzerinde, veritabanı bağlıyken)

Artık her şey canlı. Testi doğrudan Render kurulumunun üzerinde yapacağız.

## D1. Bir development (test) mağazası oluştur
1. Partner → **Stores → Add store → Development store**.
2. "Create store to test apps" seç, oluştur (ör. `geo-engine-test.myshopify.com`).
3. Mağazaya birkaç **örnek ürün** ekle (Shopify Admin → Products → "Add product" veya
   Settings'ten örnek/dummy ürünler). Test taramasının skor üretebilmesi için ürün lazım.

## D2. Uygulamayı test mağazasına kur
- Partner → Apps → **GEO Engine → Test your app** (ya da **Select store**) → test
  mağazanı seç → **Install app**.
- OAuth ekranı Render'a gider, izinleri onayla. Uygulama Shopify Admin içinde gömülü açılır.
- (Bu kurulum kaydı Neon veritabanına yazılır — yani DB bağlı çalışıyor demektir.)

## D3. Test senaryosu — hepsi Render'da çalışır
- **Home (Dashboard):** **Scan Catalog Now**'a bas. Tarama Render worker'ında çalışır;
  birkaç saniye sonra AI Readiness skoru, kategori barları, **AI Commerce Benchmark** ve
  **öncelikli öneriler** tablosu görünür.
- **Products Directory:** ürün listesini ve tek tek skorları gör. Bir ürüne gir →
  AI önerisini gör → **Apply** ile Shopify'a geri yaz (writeback testi).
- **Agentic Storefront (YENİ):** llms.txt önizlemesini ve yayın URL'ini gör. Sonra
  tarayıcıda şunu aç:
  ```
  https://geo-engine-test.myshopify.com/apps/geo/llms.txt
  ```
  Mağazanın katalogunu özetleyen llms.txt'i görmelisin (app proxy çalışıyor mu testi).
- **Billing:** bir plan seç. Development mağazasında **gerçek ücret alınmaz** (test modu).
- **Webhook testi:** Shopify Admin'de bir ürünü düzenleyip kaydet → `products/update`
  webhook'u tetiklenir → o ürün otomatik yeniden taranır. Render **Logs**'ta görürsün.

## D4. Logları izle
Render dashboard → servis → **Logs** sekmesi. Bir hata olursa burada görünür.

## D5. (Opsiyonel) Lokal hızlı test
Kod değişikliklerini anında görmek istersen lokalde:
```bash
npm run dev      # = shopify app dev  (geçici tünel açar, dev store'a bağlar)
```
Daha önce pnpm kurmadan test edebilmenin yolu buydu: `shopify app dev` tünel + URL +
bağımlılıkları otomatik halleder. Lokal çalıştırırken `.env` içindeki `DATABASE_URL`'i
Neon'a (ya da lokal bir Postgres'e) yönlendir. **Kalıcı/gerçekçi test için Render'ı kullan.**

---

# BÖLÜM E — RESMİ YAYIN (Shopify App Store)

Test tamamsa artık inceleme için gönderebilirsin.

## E1. Listing görselleri — HAZIR ✅
`marketing/assets/` klasöründeki PNG'leri yükle:

| Alan | Dosya |
|------|-------|
| App icon | `icon.png` (1200×1200) |
| Feature image | `feature.png` (1600×900) |
| Ekran görüntüsü 1 | `shot-dashboard.png` |
| Ekran görüntüsü 2 | `shot-benchmark.png` |
| Ekran görüntüsü 3 | `shot-recommendations.png` |
| Ekran görüntüsü 4 | `shot-agentic.png` |
| Ekran görüntüsü 5 | `shot-pricing.png` |

## E2. Listing metni (kopyala-yapıştır)
- **App name:** `GEO Engine`
- **Tagline (kısa):** `Generative Engine Optimization for Shopify`
- **Açıklama:**
  > GEO Engine scores your entire Shopify catalog for AI readiness (0–100) and shows you
  > exactly what to fix — prioritized by impact — so AI shopping engines like ChatGPT
  > Shopping, Gemini, Perplexity, Claude, and Google AI Overviews discover and recommend
  > your products. One-click AI suggestions rewrite titles, descriptions, and alt text.
  > The new **Agentic Storefront** feature publishes an `llms.txt` on your storefront so
  > AI agents can understand your store instantly. Benchmark against optimized stores,
  > monitor weekly, and never fall behind in AI-first search.
- **Öne çıkan özellikler (3):**
  1. AI Readiness Score + prioritized, ROI-ranked fixes
  2. One-click AI suggestions with Shopify write-back
  3. Agentic Storefront — auto-published `llms.txt`

## E3. Zorunlu teknik gereksinimler (çoğu hazır)
- ✅ **GDPR webhook'ları** kodda mevcut (`customers/data_request`, `customers/redact`,
  `shop/redact`).
- ✅ **App proxy + webhook'lar** Shopify'a yazıldı (BÖLÜM C2'deki `npm run deploy`).
- ✅ **Billing** kodda tanımlı (Free / Starter / Growth / Unlimited).
- ⛳ **Privacy Policy URL** lazım. Hızlı yol: https://termly.io ile ücretsiz üret, ya da
  `public/privacy.html` koyup `https://geo-engine.onrender.com/privacy` adresini kullan.

## E4. İncelemeye gönder
1. Partner → Apps → **GEO Engine → Distribution → Shopify App Store → Create listing**.
2. Görselleri (E1) ve metni (E2) doldur, kategori seç (öneri: **Store management / SEO**).
3. Pricing, privacy policy URL, destek e-postası gibi alanları doldur.
4. **Submit for review**.
5. Shopify incelemesi genelde **5–10 iş günü** sürer. Düzeltme isterlerse e-posta ile bildirir.

## E5. Yayın sonrası
- İlk kurulumları Render Logs'tan ve Partner panelinden izle.
- Uygulama içindeki "review iste" banner'ı zaten var; ilk olumlu kullanıcılardan yorum gelir.
- UptimeRobot ayrıca **downtime** olursa sana mail atar.

---

## 🔁 Güncelleme yaparken (kod değiştirince)
```bash
git add .
git commit -m "değişiklik açıklaması"
git push           # → Render otomatik yeniden build & deploy eder
```
`shopify.app.toml` (scope/webhook/proxy/URL) değiştirdiysen ayrıca:
```bash
npm run deploy     # Shopify tarafını da güncelle
```

## 🆘 Sık karşılaşılan sorunlar
- **Kurulumda "redirect_uri" hatası:** `shopify.app.toml` ve Partner panelindeki
  redirect URL'leri Render adresiyle birebir aynı mı? `npm run deploy` çalıştırdın mı?
- **Tablolar yok / Prisma hatası:** A5'teki migration'ı üretip push'ladın mı? Yoksa
  Start Command'ı `npx prisma db push && npm run start` yap.
- **İlk isteğin yavaş:** Render free servis uyumuştur. UptimeRobot monitor'ünün aktif
  ve 5 dk'da bir çalıştığından emin ol (BÖLÜM B3).
- **llms.txt boş/hatalı:** Önce Dashboard'dan en az bir kez **Scan** yap, ürün olduğundan
  emin ol.

---

*GEO Engine v1.0 — Render + Neon + UptimeRobot kurulumu*
