#!/bin/sh
# Optionnel : affiche le tableau de bord en plein écran sur l'écran du Raspberry Pi.
# À ajouter au démarrage de la session graphique (ex. ~/.config/autostart).
sleep 5
exec chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:8080/ \
  || exec chromium --kiosk --noerrdialogs --disable-infobars http://localhost:8080/
