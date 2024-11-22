// Importações
const express = require('express');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4001;

// Configuração do CORS
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Configuração do banco de dados
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

// Conectar ao banco de dados SQL Server
async function connectToDatabase() {
  try {
    await sql.connect(dbConfig);
    console.log('Conectado ao banco de dados SQL Server');
  } catch (err) {
    console.error('Erro ao conectar ao banco de dados:', err);
  }
}

// Função para criar diretórios dinamicamente para armazenar os uploads
const createUploadDir = (nomeProjeto) => {
  if (!nomeProjeto) {
    throw new Error('Nome do projeto não pode ser vazio.');
  }

  const now = new Date();
  const ano = now.getFullYear();
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const dia = String(now.getDate()).padStart(2, '0');
  const dir = path.join(__dirname, 'uploads', ano.toString(), mes, dia, nomeProjeto);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
};

// Filtro de arquivo para aceitar apenas PNG, JPG, PDF e DWG
const fileFilter = (req, file, cb) => {
  const fileTypes = /png|jpe?g|pdf|dwg/;
  const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
  if (extname) {
    return cb(null, true);
  } else {
    cb(new Error('Apenas arquivos PNG, JPG, PDF e DWG são permitidos.'));
  }
};

// Rota para adicionar um novo projeto (com upload de layout)
app.post('/projetos', (req, res) => {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = createUploadDir(req.body.NomeProjeto);
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        cb(null, file.originalname);
      }
    }),
    fileFilter: fileFilter
  }).single('layout');

  upload(req, res, async (err) => {
    if (err) {
      return res.status(500).send({ error: err.message });
    }

    const { NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras, Saldo } = req.body;

    // Verificação dos campos obrigatórios
    if (!NomeProjeto) {
      return res.status(400).send({ error: 'Nome do projeto é obrigatório.' });
    }
    if (!Empresa || !Responsavel || !Prazo || !EstimativaHoras || !Saldo) {
      return res.status(400).send({ error: 'Todos os campos são obrigatórios.' });
    }

    const Layout = req.file ? req.file.filename : null;

    try {
      const estimativaHoras = parseInt(EstimativaHoras.replace(/[^\d]/g, ''), 10);
      // Inserindo o projeto no banco de dados
      const result = await sql.query`
        INSERT INTO dbo.projeto (NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras, Saldo, Layout)
        OUTPUT INSERTED.ID
        VALUES (${NomeProjeto}, ${Empresa}, ${Responsavel}, ${Prazo}, ${estimativaHoras}, ${Saldo}, ${Layout})`;

      // Obtém o ID do projeto recém-criado
      const idProjeto = result.recordset[0].ID;

      // Retorna o ID do projeto
      res.status(201).send({ message: 'Projeto criado com sucesso!', id: idProjeto });

    } catch (error) {
      console.error('Erro ao criar projeto:', error);
      res.status(500).send({ error: 'Erro ao criar projeto.' });
    }
  });
});

// Rota para obter todos os projetos
app.get('/projetos', async (req, res) => {
  try {
    const result = await sql.query`SELECT ID, NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras, Saldo, Layout FROM dbo.projeto`;
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Nenhum projeto encontrado.' });
    }

    // Retorna os projetos com seus respectivos IDs
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error('Erro ao buscar projetos:', error);
    res.status(500).send({ error: 'Erro ao buscar projetos.' });
  }
});

// Rota para obter um projeto específico
app.get('/projetos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await sql.query`SELECT * FROM dbo.projeto WHERE ID = ${id}`;
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Projeto não encontrado.' });
    }
    res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error('Erro ao buscar projeto:', error);
    res.status(500).send({ error: 'Erro ao buscar projeto.' });
  }
});

// Rota para registrar atividades associadas a um projeto específico
app.post('/projetos/:id/atividades', async (req, res) => {
  const { id: idProjeto } = req.params;

  const parsedIdProjeto = parseInt(idProjeto, 10);
  if (isNaN(parsedIdProjeto)) {
      return res.status(400).json({ message: 'ID do projeto inválido.' });
  }

  try {
      // Verificar se o projeto existe
      const projeto = await sql.query`SELECT * FROM dbo.projeto WHERE ID = ${parsedIdProjeto}`;
      if (projeto.recordset.length === 0) {
          return res.status(404).json({ message: 'Projeto não encontrado.' });
      }

      // Validar campos obrigatórios no corpo da requisição
      const { QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel } = req.body;

      if (!QualAtividade || !DataDaAtividade || !QuantasPessoas || !HoraInicial || !HoraFinal || !Responsavel) {
          return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
      }

      const dataAtividade = new Date(DataDaAtividade);

      // Validar dados adicionais
      if (new Date(`1970-01-01T${HoraInicial}:00`) >= new Date(`1970-01-01T${HoraFinal}:00`)) {
          return res.status(400).json({ message: 'HoraInicial deve ser menor que HoraFinal.' });
      }

      if (isNaN(QuantasPessoas) || QuantasPessoas <= 0) {
          return res.status(400).json({ message: 'QuantasPessoas deve ser um número maior que 0.' });
      }

      // Configuração do upload com Multer
      const upload = multer({
          storage: multer.diskStorage({
              destination: (req, file, cb) => {
                  const dir = createUploadDir(projeto.recordset[0].NomeProjeto || `Projeto_${parsedIdProjeto}`);
                  cb(null, dir);
              },
              filename: (req, file, cb) => {
                  const dataFormatada = `${dataAtividade.getFullYear()}-${String(dataAtividade.getMonth() + 1).padStart(2, '0')}-${String(dataAtividade.getDate()).padStart(2, '0')}`;
                  const nomeArquivo = `${dataFormatada}_${file.originalname}`;
                  cb(null, nomeArquivo);
              }
          }),
          fileFilter: fileFilter
      }).single('anexo');

      // Executar upload do arquivo
      upload(req, res, async (err) => {
          if (err) {
              return res.status(500).json({ message: 'Erro ao enviar o arquivo.', error: err.message });
          }

          const Anexo = req.file ? req.file.filename : null;

          // Inserir atividade no banco de dados
          try {
              const pool = await sql.connect(dbConfig);
              const request = pool.request();
              request.input('ProjectID', sql.Int, parsedIdProjeto);
              request.input('QualAtividade', sql.NVarChar, QualAtividade);
              request.input('DataDaAtividade', sql.Date, dataAtividade);
              request.input('QuantasPessoas', sql.Int, QuantasPessoas);
              request.input('HoraInicial', sql.Time, HoraInicial);
              request.input('HoraFinal', sql.Time, HoraFinal);
              request.input('Responsavel', sql.NVarChar, Responsavel);
              request.input('Anexo', sql.NVarChar, Anexo);

              const result = await request.query(`
                  INSERT INTO dbo.registroDeAtividade (ProjectID, QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, Anexo)
                  OUTPUT INSERTED.ID
                  VALUES (@ProjectID, @QualAtividade, @DataDaAtividade, @QuantasPessoas, @HoraInicial, @HoraFinal, @Responsavel, @Anexo);
              `);

              const idAtividade = result.recordset[0].ID;

              // Resposta de sucesso
              res.status(201).json({ message: 'Atividade registrada com sucesso!', id: idAtividade });
          } catch (dbError) {
              console.error('Erro ao registrar atividade:', dbError.message);
              res.status(500).json({ message: 'Erro ao registrar atividade.', error: dbError.message });
          }
      });
  } catch (err) {
      console.error('Erro ao verificar projeto:', err.message);
      res.status(500).json({ message: 'Erro ao verificar projeto.', error: err.message });
  }
});

// Iniciar o servidor e a conexão com o banco
connectToDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
  });
});