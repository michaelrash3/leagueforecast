FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
# CI already installs this locked dependency tree before bundling. Reuse it rather than
# resolving and downloading the same packages a second time inside the container build.
COPY node_modules ./node_modules
RUN npm prune --omit=dev --offline --ignore-scripts
COPY lib ./lib
ENV NODE_OPTIONS=--max-old-space-size=12288
CMD ["node", "lib/importJob.js"]
