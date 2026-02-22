# Use official Node image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the app
COPY . .

# Expose port (Render provides PORT env variable)
EXPOSE 10000

# Start app
CMD ["node", "index.js"]