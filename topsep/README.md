# TopSep

Prywatny komunikator: konta, czaty prywatne, grupy, zdjęcia (w planach), rozmowy głosowe (WebRTC), wiadomości szyfrowane w bazie.

## Uruchomienie lokalne (test)
Wymagany Node.js 22.13+.
```bash
npm install
TOPSEP_KEY=$(openssl rand -hex 32) npm start
```
Otwórz http://localhost:8080 i załóż dwa konta w dwóch oknach (np. prywatne okno przeglądarki).

## Wdrożenie na VPS (Ubuntu 24.04)
1. Ustaw rekord DNS typu A: `twoja.domena.pl` → IP serwera.
2. Wgraj projekt na serwer (np. `scp -r topsep root@IP:/root/`).
3. Na serwerze:
```bash
cd /root/topsep
sudo ./deploy/install.sh twoja.domena.pl
```
Skrypt instaluje Node.js 22 i Caddy, tworzy klucz w `/etc/topsep.env`, uruchamia usługę `topsep` i konfiguruje HTTPS.

Zrób kopię `/etc/topsep.env`. Bez tego klucza nie odczytasz zapisanych wiadomości.

Przydatne komendy:
- Status: `systemctl status topsep`
- Logi: `journalctl -u topsep -f`
- Baza danych: `/var/lib/topsep/topsep.db` (kopię rób przez `sudo cp`, usługa używa WAL)

## Aplikacja desktopowa
```bash
cd desktop && npm install
TOPSEP_URL=https://twoja.domena.pl npm start
```

## Ograniczenia
- Szyfrowanie jest w bazie (AES-256-GCM), ale nie end-to-end. Serwer widzi treść wiadomości.
- Rozmowy głosowe między różnymi sieciami mogą wymagać serwera TURN (np. coturn). Bez niego część połączeń się nie uda.
- Brak zdjęć profilowych i edycji profilu w tej wersji.
