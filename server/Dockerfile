# Encode's Coding Agent shells out: it needs git, and it runs the target
# repo's own test suite. A slim base without git would fail at the clone
# step, so this uses the Debian-based image rather than alpine.
FROM node:22-bookworm-slim

# git is required by simple-git (clone, worktree, commit) and by verify.js's
# baseline check. ca-certificates for HTTPS to GitHub and the facilitator.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so a code-only change doesn't re-run npm ci.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# The server runs as a non-root user. The Coding Agent executes model-chosen
# commands from a whitelist inside a scoped clone; root would make a whitelist
# bypass considerably more interesting.
#
# The image can't be `USER encode`, though: a platform-mounted volume replaces
# /app/data at runtime and arrives owned by root, so a process that had already
# dropped privileges couldn't create the database in it. The entrypoint starts
# as root, chowns only the data directory, and execs the server as `encode` —
# so the Node process is still never root. See docker-entrypoint.sh.
RUN useradd --create-home --shell /usr/sbin/nologin encode \
  && mkdir -p /app/tmp /app/data \
  && chown -R encode:encode /app \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

# git refuses to commit without an identity, and the Coding Agent commits the
# patch it writes. Written to the *system* gitconfig rather than a user
# --global one, because the entrypoint switches users and setpriv leaves HOME
# pointing at root's — a --global config would then be invisible.
RUN git config --system user.email "agent@encode.local" \
  && git config --system user.name "Encode Agent" \
  && git config --system init.defaultBranch main

ENV NODE_ENV=production
ENV PORT=8787
# setpriv doesn't change HOME, and git/npm both write there.
ENV HOME=/home/encode
# Under /app/data so a mounted volume makes settlement records survive a
# redeploy. Without a volume this is container-local and erased on deploy —
# the store logs the path at boot for exactly that reason.
#
# No `VOLUME` instruction: Railway rejects the build outright with "docker
# VOLUME at Line N is not supported, use Railway Volumes". The mount is
# declared on the service instead (`railway volume add --mount-path /app/data`).
ENV ENCODE_DB_PATH=/app/data/encode.db
EXPOSE 8787

# Platform health checks hit /health; this is for `docker run` alone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
