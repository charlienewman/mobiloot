#!/bin/sh
# Hosts such as Railway mount the /data volume owned by root. Fix its ownership, then
# drop to the unprivileged `node` user. `exec` keeps node as PID 1 so it gets SIGTERM.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
