#!/usr/bin/env bash
# Instalacja TopSep na świeżym Ubuntu 24.04 (VPS).
# Użycie (z katalogu projektu, jako root):  sudo ./deploy/install.sh twoja.domena.pl
set -euo pipefail

DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Użycie: sudo ./deploy/install.sh twoja.domena.pl"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root (sudo)."; exit 1; }

APP=/opt/topsep
SRC="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Node.js 22 i Caddy
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# 2. Kopia aplikacji i zależności
mkdir -p "$APP"
[ "$SRC" = "$APP" ] || cp -r "$SRC"/. "$APP"/
cd "$APP" && npm install --omit=dev

# 3. Klucz szyfrowania (tworzony tylko raz)
if [ ! -f /etc/topsep.env ]; then
  echo "TOPSEP_KEY=$(openssl rand -hex 32)" > /etc/topsep.env
  chmod 600 /etc/topsep.env
  echo ">>> Utworzono /etc/topsep.env z kluczem. Zrób jego kopię w bezpiecznym miejscu!"
fi

# 4. Usługa systemd
cp "$APP/deploy/topsep.service" /etc/systemd/system/topsep.service
systemctl daemon-reload
systemctl enable --now topsep

# 5. Caddy: HTTPS + WebSocket
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    encode gzip
    reverse_proxy localhost:8080
}
CADDY
systemctl reload caddy || systemctl restart caddy

# 6. Firewall (jeśli ufw jest zainstalowany)
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null
  ufw --force enable >/dev/null
fi

echo
echo "Gotowe! Upewnij się, że rekord DNS $DOMAIN wskazuje na IP serwera."
echo "Aplikacja: https://$DOMAIN"
echo "Status usługi: systemctl status topsep"
