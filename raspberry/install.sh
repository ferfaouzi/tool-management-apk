#!/bin/sh
# Installation sur Raspberry Pi (Raspberry Pi OS / Debian) - à lancer depuis le dossier du projet :
#   sudo sh raspberry/install.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-pi}"

apt-get update
apt-get install -y python3 python3-venv python3-pip

python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install -r "$DIR/requirements.txt"
mkdir -p "$DIR/data"
chown -R "$USER_NAME" "$DIR/data" "$DIR/.venv"

sed -e "s#@DIR@#$DIR#g" -e "s#@USER@#$USER_NAME#g" "$DIR/raspberry/toolmanager.service" \
  > /etc/systemd/system/toolmanager.service
systemctl daemon-reload
systemctl enable --now toolmanager

IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "Gestion des outils est démarrée : http://$IP:8080"
echo "Mot de passe admin par défaut : admin (à changer dans Administration)"
