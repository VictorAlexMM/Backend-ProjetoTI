const chokidar = require('chokidar');
const { fileQueue } = require('../config/queue');

// Função para monitorar a pasta
const startDirectoryListener = () => {
  const directoryPath = '\\\\mao-s039\\c$\\rec_facial\\registros';

  const watcher = chokidar.watch(directoryPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /DumpStack\.log\.tmp/,
    awaitWriteFinish: {
      stabilityThreshold: 2000, // Aguarda 2 segundos antes de processar
      pollInterval: 100,
    },
  });

  watcher
    .on('add', async (filePath) => {
      console.log(`Novo arquivo detectado: ${filePath}`);
      try {
        // Adicionar o job na fila para processamento
        await fileQueue.add({ filePath });
        console.log(`Arquivo adicionado à fila: ${filePath}`);
      } catch (error) {
        console.error(`Erro ao adicionar o arquivo à fila: ${filePath}`, error.message);
      }
    })
    .on('error', (error) => {
      console.error('Erro no monitoramento de arquivos:', error);
    });
};

module.exports = { startDirectoryListener };
