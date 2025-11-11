#!/bin/bash

# Зручний wrapper для supervisorctl
# Використання: ./supervisor.sh status

BACKEND_DIR="/Users/alinakovpaka/Documents/Work/youtube_translation/backend"
CONFIG="$BACKEND_DIR/supervisord.conf"

supervisorctl -c "$CONFIG" "$@"
