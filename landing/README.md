# GEO Engine — Landing Page

`geoengine.ozietra.store` adresine yüklenecek **statik** tanıtım sitesi. Node.js
gerektirmez; Hostinger cPanel'e olduğu gibi yüklenebilir.

## İçerik
- `index.html` — ana tanıtım sayfası (gerçek eklenti ekran görüntüleriyle)
- `privacy.html` — gizlilik politikası (Shopify'a bu sayfanın URL'ini verirsin)
- `assets/` — logo ve ekran görüntüsü PNG'leri

## Yükleme (Hostinger cPanel)
1. cPanel → **File Manager** → `geoengine.ozietra.store` subdomain'inin kök klasörü
   (genelde `public_html/geoengine` ya da subdomain için ayrılan klasör).
2. `index.html`, `privacy.html` ve `assets/` klasörünü **olduğu gibi** yükle.
3. Test et:
   - Ana sayfa: `https://geoengine.ozietra.store/`
   - Gizlilik: `https://geoengine.ozietra.store/privacy.html`

## Shopify'a verilecek gizlilik URL'i
App Store listing formundaki **Privacy policy URL** alanına:
```
https://geoengine.ozietra.store/privacy.html
```

## App Store linki
Tüm "Add to Shopify" butonları şu an `https://apps.shopify.com/geo-engine` adresine
gidiyor. Uygulaman yayınlanınca Shopify sana **kesin listing URL'ini** verir; farklıysa
`index.html` içinde (en üstte yorum satırıyla işaretledim) tüm `apps.shopify.com/geo-engine`
geçen yerleri o URL ile değiştir.

## İletişim e-postası
`privacy.html` içinde `support@ozietra.store` yazıyor — kendi destek adresinle değiştir.

## Görselleri güncellemek
Ekran görüntüleri `../marketing/` klasöründeki HTML'lerden üretiliyor. Tasarımı
değiştirip yeniden render edersen (`marketing/README.md`'ye bak), yeni PNG'leri
`assets/` içine kopyalaman yeterli.
