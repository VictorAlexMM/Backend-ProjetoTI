// Carregar variáveis de ambiente do arquivo .env
require('dotenv').config();

const { Sequelize } = require('sequelize');

// Configuração do Sequelize com as variáveis de ambiente
const sequelize = new Sequelize(process.env.DB_DATABASE, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_SERVER,
    dialect: 'mssql',  // Use o dialeto 'mssql' para SQL Server
    logging: false,    // Desabilita o log de consultas no console, pode ser útil em produção
});

module.exports = sequelize;
