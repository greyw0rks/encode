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

# Run as a non-root user. The Coding Agent executes model-chosen commands
# from a whitelist inside a scoped clone; root would make a whitelist bypass
# considerably more interesting.
RUN useradd --create-home --shell /usr/sbin/nologin encode \
  && mkdir -p /app/tmp \
  && chown -R encode:encode /app
USER encode

# git refuses to commit without an identity, and the Coding Agent commits
# the patch it writes. Set at the image level so no incident depends on the
# host's global gitconfig.
RUN git config --global user.email "agent@encode.local" \
  && git config --global user.name "Encode Agent" \
  && git config --global init.defaultBranch main

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# Platform health checks hit /health; this is for `docker run` alone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
