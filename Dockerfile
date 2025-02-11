FROM node:latest

WORKDIR /controleDeTerceiros/backend-db
COPY package.json package-lock.json ./
RUN npm install
COPY . .
CMD [ "node","server..js" ]

EXPOSE 4002