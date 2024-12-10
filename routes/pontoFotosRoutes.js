const express = require('express');
const router = express.Router();
const pontoFotosController = require('../controllers/pontoFotosController');

// Rota para processar os arquivos e salvar no banco de dados
router.post('/processar-arquivos', pontoFotosController.ponto_fotos);

// Rota para registrar a atividade de ponto
router.post('/registrar-atividade', pontoFotosController.registrarAtividade);

// Rota para adicionar tarefas à fila
router.post('/adicionar-tarefa', async (req, res) => {
    const { tarefa } = req.body;
  
    if (!tarefa) {
      return res.status(400).json({ error: 'Tarefa é obrigatória' });
    }
  
    try {
      // Adiciona a tarefa à fila
      await addTaskToQueue({ tarefa });
      res.status(200).json({ message: 'Tarefa adicionada à fila com sucesso' });
    } catch (error) {
      console.error('Erro ao adicionar tarefa:', error);
      res.status(500).json({ error: 'Erro ao adicionar tarefa à fila' });
    }
  });

module.exports = router;
