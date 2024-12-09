const { DataTypes } = require('sequelize');
const sequelize = require('../config/sequelizeConfig'); // Importa a configuração do Sequelize

// Definição do modelo PontoFotos
const PontoFotos = sequelize.define('ponto_fotos', {
  nome: { type: DataTypes.STRING, allowNull: false },
  projeto: { type: DataTypes.STRING, allowNull: false },
  data: { type: DataTypes.DATEONLY, allowNull: false },
  horaInicial: { type: DataTypes.TIME, allowNull: false },
  horaFinal: { type: DataTypes.TIME, allowNull: false },
  anexo: { type: DataTypes.STRING, allowNull: true }, // Coluna para o nome da foto
}, {
  timestamps: false, // Não cria automaticamente as colunas createdAt e updatedAt
});

module.exports = PontoFotos;
