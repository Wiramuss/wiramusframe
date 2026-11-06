# Katkı rehberi

Katkıların için teşekkürler! Türkçe veya İngilizce yazabilirsin.

## Başlarken

```bash
npm install
python scripts/build_data.py          # oyun verisi
python scripts/gen_fixtures.py 60 99  # OCR test ekranları
npm test && npm run typecheck
npm start
```

## Kurallar

- **Oyuna dokunma:** oyuna kod enjekte eden, oyun dosyalarını değiştiren, oyun içinde otomatik işlem yapan
  (makro, bot) veya ağ trafiğini taklit eden katkılar kabul edilmez.
- **Gizlilik:** telemetri, analitik veya reklam eklenmez. Kullanıcı verisi bilgisayarından çıkmaz.
- **Görseller:** Digital Extremes'in logo veya sanat eserlerini depoya ekleme; eşya görselleri çalışma anında herkese açık kaynaklardan yüklenir.
- **Test ekranları:** gerçek oyun ekran görüntüsü eklerken başka oyuncuların adlarını karart.
- Her PR: `npm run typecheck` ve `npm test` geçmeli. Arayüz metinleri `src/renderer/i18n.ts` içinde hem TR hem EN olmalı.

## En çok istenen katkılar

1. **Yeni oyun dili** (relic ödül okuma): ilgili `tessdata` dil paketi + DE'nin `index_xx` eşya adları + test ekranları.
2. **Linux desteği:** Proton/Wine altında EE.log yolu, ekran yakalama, AppImage.
3. Hata bildirimleri: ekran çözünürlüğü, oyun dili ve `%APPDATA%\WiramusFrame\scan-debug.log` ile birlikte.

Katkıların GPL-3.0 lisansıyla yayınlanır.
