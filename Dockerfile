# Development container for kbx.
# All Node.js tooling runs inside this image; the host only needs Docker.
FROM node:24-bookworm-slim

WORKDIR /app

# Fail fast in CI-like runs and keep npm quiet about funding/audit noise.
ENV CI=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# 5173: vite dev server / 4173: vite preview
EXPOSE 5173 4173

CMD ["bash"]
