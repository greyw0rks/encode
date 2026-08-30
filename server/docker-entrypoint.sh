#!/bin/sh
# Fix up volume ownership, then drop to the unprivileged user.
#
# A platform-mounted volume (Railway, Fly, Docker) arrives owned by root with
# whatever mode the platform chose, and it *replaces* whatever the image had at
# that path — so the chown baked into the Dockerfile applies to a directory
# that no longer exists at runtime. A container that had already dropped to
# USER encode then can't create the database, and node:sqlite fails with a bare
# "unable to open database file".
#
# So this runs as root, fixes only the data directory, and immediately execs
# the server as `encode`. The Node process — the one that runs model-chosen
# commands inside a cloned repo — is never root, which is the property the
# non-root user exists for. `exec` matters: the server has to be PID 1 to
# receive the platform's SIGTERM and close cleanly.
set -e

DATA_DIR="$(dirname "${ENCODE_DB_PATH:-/app/data/encode.db}")"
mkdir -p "$DATA_DIR"
chown -R encode:encode "$DATA_DIR"

exec setpriv --reuid=encode --regid=encode --init-groups "$@"
