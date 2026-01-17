# Använd Node.js 18 (LTS) som base image
FROM node:18-alpine

# Sätt arbetsmapp
WORKDIR /app

# Kopiera package files först (för bättre Docker cache)
COPY package*.json ./

# Installera dependencies
RUN npm ci --only=production

# Kopiera allt projekt-filer (dist/, server.js, server/, routes/, middleware/, public/, etc.)
COPY . .

# Exponera port (Cloud Run sätter PORT automatiskt)
EXPOSE 8080

# Använd PORT från environment (Cloud Run)
ENV PORT=8080
ENV NODE_ENV=production

# Starta servern
CMD ["node", "server.js"]
