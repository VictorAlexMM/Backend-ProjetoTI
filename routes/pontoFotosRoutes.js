const express = require('express');
const router = express.Router();
const pontoFotosController = require('../controllers/pontoFotosController');

// Rota para processar os arquivos e salvar no banco de dados
router.post('/processar-arquivos', pontoFotosController.ponto_fotos);

// Rota para buscar os pontos de fotos no banco de dados
router.get('/buscar-pontos', pontoFotosController.buscarPontos);

// Rota para registrar a atividade de ponto
router.post('/registrar-atividade', pontoFotosController.registrarAtividade);

module.exports = router;
