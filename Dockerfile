# Development container for kbx.
# All Node.js tooling runs inside this image; the host only needs Docker.
FROM node:24-bookworm-slim

WORKDIR /app

# Fail fast in CI-like runs and keep npm quiet about funding/audit noise.
ENV CI=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# 6606: vite dev server / 6506: vite preview
EXPOSE 6606 6506

CMD ["bash"]
