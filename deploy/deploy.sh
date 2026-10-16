#!/usr/bin/env bash
# Publica o Open Eddy web num servidor Ubuntu: copia o build e reinicia o serviço.
#   SSH_KEY=~/chave.pem ./deploy/deploy.sh ubuntu@1.2.3.4
# Na primeira vez também cria o usuário, o serviço e /etc/open-eddy/env (sem a chave:
# preencha ELEVENLABS_API_KEY lá à mão).
set -euo pipefail
HOST="${1:?uso: deploy.sh usuario@servidor}"
KEY="${SSH_KEY:-}"
SSH=(ssh ${KEY:+-i "$KEY"})
RSYNC_SSH="ssh ${KEY:+-i $KEY}"
cd "$(dirname "$0")/.."

(cd app && npm run build >/dev/null)
rsync -az --delete -e "$RSYNC_SSH" --rsync-path="sudo rsync" \
  --exclude '__pycache__' core/ "$HOST:/opt/open-eddy/core/"
rsync -az --delete -e "$RSYNC_SSH" --rsync-path="sudo rsync" app/dist/ "$HOST:/opt/open-eddy/app/dist/"
rsync -az -e "$RSYNC_SSH" --rsync-path="sudo rsync" deploy/open-eddy-web.service "$HOST:/etc/systemd/system/open-eddy-web.service"

"${SSH[@]}" "$HOST" 'set -e
  id openeddy >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin openeddy
  sudo mkdir -p /etc/open-eddy
  if [ ! -f /etc/open-eddy/env ]; then
    printf "ELEVENLABS_API_KEY=\nEDDY_WEB_HOST=172.17.0.1\nEDDY_WEB_PORT=8120\n" | sudo tee /etc/open-eddy/env >/dev/null
  fi
  sudo chown root:openeddy /etc/open-eddy/env && sudo chmod 640 /etc/open-eddy/env
  sudo chown -R root:root /opt/open-eddy
  sudo systemctl daemon-reload
  sudo systemctl enable --now open-eddy-web >/dev/null
  sudo systemctl restart open-eddy-web
  sleep 1; systemctl is-active open-eddy-web'
