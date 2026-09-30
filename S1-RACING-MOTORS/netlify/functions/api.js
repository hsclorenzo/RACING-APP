// Adaptador serverless. E o UNICO arquivo que sabe que o backend roda
// dentro de uma Netlify Function — o Express de src/app.js e um Express
// comum. Se um dia o sistema mudar pro Railway, este arquivo some e o
// src/server.js assume; nenhuma rota muda.
import serverless from 'serverless-http'
import { app } from '../../backend/src/app.js'

export const handler = serverless(app)
