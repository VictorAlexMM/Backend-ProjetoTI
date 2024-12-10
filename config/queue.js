const Bull = require('bull');

// Configuração da fila com Redis
const queue = new Bull('minhaFila', 'redis://localhost:6380');

// Função para adicionar tarefas à fila
const addTaskToQueue = async (data) => {
  await queue.add(data); // Adiciona a tarefa à fila
};

module.exports = {
  queue,
  addTaskToQueue
};
