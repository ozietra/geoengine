# GEO Engine — Marketplace Görselleri

Bu klasördeki `*.html` dosyaları, uygulamanın gerçek arayüzüne (renkler, skor kadranı,
benchmark widget'ı, öneri tablosu) birebir uygun tasarlanmıştır. Headless Chrome ile
`assets/` altına PNG olarak render edilmiştir.

## Üretilen dosyalar (`assets/`)

| Dosya | Boyut | Shopify App Store kullanımı |
|-------|-------|------------------------------|
| `icon.png` | 1200×1200 | **App icon / logo** |
| `feature.png` | 1600×900 | **Feature image** (liste başı banner) |
| `shot-dashboard.png` | 1600×900 | Ekran görüntüsü 1 — AI Readiness skoru |
| `shot-benchmark.png` | 1600×900 | Ekran görüntüsü 2 — AI Commerce Benchmark |
| `shot-recommendations.png` | 1600×900 | Ekran görüntüsü 3 — Öncelikli öneriler |
| `shot-agentic.png` | 1600×900 | Ekran görüntüsü 4 — Agentic Storefront (llms.txt) |
| `shot-pricing.png` | 1600×900 | Ekran görüntüsü 5 — Fiyatlandırma |

> Shopify gereksinimleri: app icon **1200×1200 px**, feature image ve ekran
> görüntüleri **en az 1600×900 px** PNG. Hepsi bu ölçülerde üretildi.

## Yeniden üretmek (tasarımı düzenledikten sonra)

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
B="C:/Users/oguzy/shop2/agent-ready/marketing"
# 1600x900 için (icon 1200x1200):
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --user-data-dir="C:/Users/oguzy/AppData/Local/Temp/chrshot" \
  --screenshot="$B/assets/feature.png" --window-size=1600,900 \
  "file:///$B/feature.html"
```

Logo'yu başka yerlerde (web sitesi, e-posta) kullanmak için `icon.html` içindeki
SVG glyph'i doğrudan kopyalayabilirsin — vektörel olduğu için her ölçüde nettir.
