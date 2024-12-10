const { fileQueue } = require('../config/queue');
const fs = require('fs');
const path = require('path');
const PontoFotos = require('../models/PontoFotos');  // Seu modelo de banco de dados

// Defina a lógica de processamento de cada trabalho na fila
fileQueue.process(async (job) => {
  const { filePath } = job.data;
  try {
    console.log(`Processando o arquivo: ${filePath}`);

    // Lógica para processar o arquivo
    const fileName = path.basename(filePath);
    const match = fileName.match(/^(.+?)_(.+?)_(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.jpg$/);
    if (!match) {
      throw new Error(`Arquivo fora do padrão: ${fileName}`);
    }

    // Extrair dados do nome do arquivo
    const nome = match[1];
    const projeto = match[2];
    const data = `${match[3]}-${match[4]}-${match[5]}`;
    const hora = `${match[6]}:${match[7]}:${match[8]}`;
    const anexo = fileName;

    // Registrar os dados no banco de dados
    await PontoFotos.create({
      nome,
      projeto,
      data,
      horaInicial: hora,
      horaFinal: hora,
      anexo,
    });

    console.log(`Arquivo processado e registrado no banco: ${fileName}`);
  } catch (error) {
    console.error(`Erro ao processar o arquivo ${filePath}: ${error.message}`);
    throw error;  // O Bull vai tentar novamente, se configurado para isso
  }
});
