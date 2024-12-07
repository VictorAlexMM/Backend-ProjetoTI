// Importações
const express = require('express');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const PDFDocument = require('pdfkit');


const app = express();
const port = process.env.PORT || 4001;

// Configuração do CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST' ,'PUT'],
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
const createUploadDir = (prazo, nomeProjeto) => {
  if (!nomeProjeto) {
    throw new Error('Nome do projeto não pode ser vazio.');
  }

  // Converte a data do prazo para um objeto Date
  const prazoDate = new Date(prazo);
  if (isNaN(prazoDate)) {
    throw new Error('Data de prazo inválida.');
  }

  const ano = prazoDate.getFullYear();
  const mes = String(prazoDate.getMonth() + 1).padStart(2, '0'); // Mês é 0-indexed
  const dia = String(prazoDate.getDate()).padStart(2, '0');
  
  // Define o caminho completo para a criação dos diretórios
  const dir = path.join(__dirname, 'uploads', ano.toString(), mes, dia, nomeProjeto);

  // Cria os diretórios, se não existirem
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

// Cria o pool de conexões global
const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then((pool) => {
    console.log('Conectado ao banco de dados SQL Server');
    return pool;
  })
  .catch((err) => {
    console.error('Erro ao conectar ao banco de dados:', err);
  });

  // Função para validar e formatar a hora para o SQL Server
function formatTimeForSQL(timeString) {
  const timeParts = timeString.split(':');
  if (timeParts.length !== 3) {
      throw new Error(`Formato de hora inválido: ${timeString}. Use HH:mm:ss.`);
  }

  let [hours, minutes, seconds] = timeParts.map(part => parseInt(part, 10));

  if (
      isNaN(hours) || isNaN(minutes) || isNaN(seconds) ||
      hours < 0 || hours > 23 ||
      minutes < 0 || minutes > 59 ||
      seconds < 0 || seconds > 59
  ) {
      throw new Error(`Hora inválida: ${timeString}. Use HH:mm:ss.`);
  }

  // Garantir que as partes tenham dois dígitos
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Função para formatar a data
function formatDate(dateString) {
const date = new Date(dateString);

if (isNaN(date.getTime())) {
    return 'Data Inválida';
}

return date.toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
}
// Função para formatar a hora no formato HH:MM:SS
function formatTime(timeString) {
if (!timeString || typeof timeString !== 'string') {
    return 'Hora Inválida';
}

// Verificar se a hora está no formato correto (HH:MM:SS)
const timeParts = timeString.split(':');
if (timeParts.length !== 3) {
    return 'Hora Inválida';
}

let [hours, minutes, seconds] = timeParts;

// Garantir que horas, minutos e segundos estão sempre com dois dígitos
hours = hours.padStart(2, '0');
minutes = minutes.padStart(2, '0');

return `${hours}:${minutes}:${seconds}`;
}

// Rota para adicionar um novo projeto (com upload de layout)
app.post('/projetos', (req, res) => {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          const { NomeProjeto, Prazo } = req.body;

          // Verifica se o Prazo foi informado corretamente
          if (!Prazo) {
            return cb(new Error('Data de prazo é obrigatória.'));
          }

          // Cria o diretório para o upload usando o prazo e nome do projeto
          const projectDir = createUploadDir(Prazo, NomeProjeto);

          cb(null, projectDir);  // Define o diretório de destino para o arquivo
        } catch (err) {
          return cb(new Error('Erro ao criar diretório para o upload: ' + err.message));
        }
      },
      filename: (req, file, cb) => {
        // Garante que o nome do arquivo seja o mesmo do original (sem alterações)
        cb(null, file.originalname);  // Usa o nome original do arquivo
      }
    }),
    fileFilter: (req, file, cb) => {
      // Permite apenas arquivos PDF e DWG
      const fileTypes = /pdf|dwg/;
      const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
      if (extname) {
        return cb(null, true);  // Aceita o arquivo se a extensão for válida
      } else {
        return cb(new Error('Apenas arquivos PDF e DWG são permitidos.'));
      }
    }
  }).single('Layout');  // Aceita apenas um arquivo de cada vez com o campo 'layout'

  // Executa o upload
  upload(req, res, async (err) => {
    if (err) {
      console.error('Erro no upload:', err.message);
      return res.status(500).send({ error: err.message });  // Retorna erro se houver falha
    }

    const { NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras } = req.body;

    // Verificação dos campos obrigatórios
    if (!NomeProjeto) {
      return res.status(400).send({ error: 'Nome do projeto é obrigatório.' });
    }
    if (!Empresa || !Responsavel || !Prazo || !EstimativaHoras) {
      return res.status(400).send({ error: 'Todos os campos são obrigatórios.' });
    }

    // Atribui o nome do arquivo do layout se houver
    const Layout = req.file ? req.file.filename : null;

    try {
      const estimativaHoras = parseInt(EstimativaHoras.replace(/[^\d]/g, ''), 10);
      
      // Obtém a data atual
      const currentDate = new Date();
      
      // Inserindo o projeto no banco de dados
      const result = await sql.query`
        INSERT INTO dbo.projeto (NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras, Layout, DataCriacao)
        OUTPUT INSERTED.ID
        VALUES (${NomeProjeto}, ${Empresa}, ${Responsavel}, ${Prazo}, ${estimativaHoras}, ${Layout}, ${currentDate})`;

      // Obtém o ID do projeto recém-criado
      const idProjeto = result.recordset[0].ID;

      // Retorna o ID do projeto criado com sucesso
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
    // Alterado para não retornar o campo 'Saldo'
    const result = await sql.query`SELECT ID, NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras, Layout FROM dbo.projeto`;
    
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

app.post('/registroDeAtividades', (req, res) => {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const { QualAtividade, DataDaAtividade } = req.body;

        // Verifica se os campos obrigatórios estão presentes
        if (!QualAtividade || !DataDaAtividade) {
          return cb(new Error('Os campos QualAtividade e DataDaAtividade são obrigatórios para o upload.'));
        }

        // Verifica se a DataDaAtividade é válida
        const data = new Date(DataDaAtividade);
        if (isNaN(data)) {
          return cb(new Error('DataDaAtividade inválida.'));
        }

        // Formatação de ano, mês e dia
        const ano = data.getFullYear();
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const dia = String(data.getDate()).padStart(2, '0');

        // Caminho onde os arquivos serão armazenados
        const dir = path.join(__dirname, 'uploads', 'registroDeAtividades', ano.toString(), mes, dia, QualAtividade);

        // Criação do diretório de forma recursiva, caso não exista
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Define o diretório de destino para o upload
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        // Define o nome do arquivo com timestamp para garantir nome único
        cb(null, `${Date.now()}-${file.originalname}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      // Define os tipos de arquivos permitidos
      const fileTypes = /\.(png|jpe?g|pdf|dwg)$/i;
      const isValid = fileTypes.test(path.extname(file.originalname).toLowerCase());

      if (isValid) {
        cb(null, true);
      } else {
        cb(new Error('Apenas arquivos PNG, JPG, PDF e DWG são permitidos.'));
      }
    },
  }).array('Anexo'); // Permite múltiplos arquivos

  // Processa o upload
  upload(req, res, async (err) => {
    if (err) {
      // Se ocorrer erro durante o upload (ex: tipo de arquivo inválido)
      console.error('Erro no upload de arquivo:', err.message);
      return res.status(500).json({ error: err.message });
    }

    // Desestruturação dos campos do formulário
    const { QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, CriadoEm, ProjetoID } = req.body;

    // Validação de campos obrigatórios
    if (!QualAtividade || !DataDaAtividade || !Responsavel) {
      return res.status(400).json({
        error: 'Campos obrigatórios faltando: QualAtividade, DataDaAtividade ou Responsavel.',
      });
    }

    // Mapeia os arquivos para o caminho final onde foram salvos
    const anexos = req.files.map((file) => path.join(file.destination, file.filename));

    try {
      // Define valores nulos para HoraInicial e HoraFinal, se não forem fornecidos
      const horaInicial = HoraInicial || null;
      const horaFinal = HoraFinal || null;

      // Inserção no banco de dados
      const result = await sql.query`
      INSERT INTO dbo.registroDeAtividades 
      (QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, CriadoEm, ProjetoID, Anexo)
      OUTPUT INSERTED.ID
      VALUES (
        ${QualAtividade}, 
        ${DataDaAtividade}, 
        ${QuantasPessoas || null}, 
        ${horaInicial}, -- Usar null se não fornecido
        ${horaFinal},   -- Usar null se não fornecido
        ${Responsavel}, 
        ${CriadoEm || null}, 
        ${ProjetoID || null},
        ${JSON.stringify(anexos)} -- Armazena como JSON os caminhos dos anexos
      )`;

      const idCriado = result.recordset[0]?.ID;

      // Resposta de sucesso
      res.status(201).json({ message: 'Atividade criada com sucesso', id: idCriado });
    } catch (error) {
      console.error('Erro ao criar atividade:', error);
      res.status(500).json({ error: 'Erro ao criar atividade.' });
    }
  });
});


// Rota para obter arquivos do projeto com base na data de criação (Prazo)
app.get('/uploads/projeto/:ano/:mes/:dia/:NomeProjeto/:filename', async (req, res) => {
  const { ano, mes, dia, NomeProjeto, filename } = req.params;

  try {
    // Busca o projeto no banco para validar a data de criação (Prazo) e o nome
    const result = await sql.query`
      SELECT Prazo, NomeProjeto
      FROM dbo.projeto
      WHERE NomeProjeto = ${NomeProjeto}`;

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado.' });
    }

    const projeto = result.recordset[0];
    const dataCriacao = new Date(projeto.Prazo); // Usando Prazo para validar
    const anoCriado = dataCriacao.getFullYear();
    const mesCriado = String(dataCriacao.getMonth() + 1).padStart(2, '0');
    const diaCriado = String(dataCriacao.getDate()).padStart(2, '0');

    // Verifica se a data de criação (Prazo) corresponde aos parâmetros recebidos
    if (ano !== String(anoCriado) || mes !== mesCriado || dia !== diaCriado) {
      return res.status(400).json({ error: 'Data de criação (Prazo) não corresponde.' });
    }

    // Construir o caminho completo do arquivo
    const filePath = path.join(__dirname, 'uploads', ano, mes, dia, NomeProjeto, filename);

    console.log(`Tentando acessar o arquivo: ${filePath}`);

    // Verifica se o arquivo existe
    await fs.promises.access(filePath);

    // Detectar o tipo de conteúdo (MIME type)
    const extname = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.pdf': 'application/pdf',
      '.dwg': 'application/vnd.dwg',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    // Enviar o arquivo
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
    console.log(`Arquivo enviado com sucesso: ${filePath}`);
  } catch (error) {
    console.error(`Erro ao acessar o arquivo ou buscar projeto:`, error.message);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
});

app.get('/uploads/registroDeAtividades/:ano/:mes/:dia/:qualAtividade/:filename', async (req, res) => {
  const { ano, mes, dia, qualAtividade, filename } = req.params;

  // Construir o caminho completo do arquivo com base nos parâmetros
  const filePath = path.join(__dirname, 'uploads', 'registroDeAtividades', ano, mes, dia, qualAtividade, filename);

  try {
    // Verifica se o arquivo existe
    await fs.promises.access(filePath);

    // Detecta o tipo de arquivo para definir o Content-Type
    const extname = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream'; // Default

    // Definir o tipo MIME com base na extensão
    if (extname === '.jpg' || extname === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (extname === '.png') {
      contentType = 'image/png';
    } else if (extname === '.pdf') {
      contentType = 'application/pdf';
    } else if (extname === '.dwg') {
      contentType = 'application/vnd.dwg';
    }

    // Enviar o arquivo com o tipo de conteúdo adequado
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  } catch (error) {
    // Se o arquivo não for encontrado, retornar um erro 404
    res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
});

// Rota para obter registro de atividades com base no ProjetoID ou ID específico
app.get('/registroDeAtividades/projeto/:projetoId', async (req, res) => {
  const { projetoId } = req.params;

  try {
    // Valida se o projetoId é um número
    if (!projetoId || isNaN(projetoId)) {
      return res.status(400).json({ message: 'ID do projeto inválido.' });
    }

    // Consulta ao banco de dados para buscar pelo ProjetoID ou ID específico
    const result = await sql.query`
      SELECT a.*
      FROM dbo.registroDeAtividades a
      WHERE a.ID = ${projetoId} OR a.ProjetoID = ${projetoId}`;

    // Verifica se houve algum registro encontrado
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Nenhuma atividade encontrada para este projeto ou ID.' });
    }

    // Mapeia os registros encontrados para incluir a URL do arquivo
    const attachments = result.recordset.map((attachment) => {
      const { Anexo, QualAtividade, DataDaAtividade } = attachment;

      // Valida campos necessários
      if (!Anexo || !QualAtividade || !DataDaAtividade) {
        console.error('Campos ausentes no registro:', attachment);
        return attachment;
      }

      // Converte a DataDaAtividade para criar o caminho do arquivo
      const dataAtividade = new Date(DataDaAtividade);
      if (isNaN(dataAtividade)) {
        console.error('DataDaAtividade inválida:', DataDaAtividade);
        return attachment; // Retorna o registro sem a URL se a data for inválida
      }

      const ano = dataAtividade.getFullYear();
      const mes = String(dataAtividade.getMonth() + 1).padStart(2, '0');
      const dia = String(dataAtividade.getDate()).padStart(2, '0');
      const filename = path.basename(Anexo);

      // Gera a URL do arquivo
      const fileUrl = `http://pc107662:4001/uploads/registroDeAtividades/${ano}/${mes}/${dia}/${QualAtividade}/${filename}`;

      // Retorna o registro com a URL do arquivo anexada
      return { ...attachment, fileUrl };
    });

    // Retorna os registros com as URLs geradas
    res.status(200).json(attachments);
  } catch (error) {
    console.error('Erro ao buscar registros de atividades:', error.message);
    res.status(500).json({ error: 'Erro ao buscar registros de atividades.' });
  }
});

// Rota para obter anexos com base no ID da atividade
app.get('/registroDeAtividades/anexos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Valida se o id é um número
    if (!id || isNaN(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    // Consulta ao banco de dados para buscar os anexos pelo ID específico
    const result = await sql.query`
      SELECT a.Anexo, a.QualAtividade, a.DataDaAtividade
      FROM dbo.registroDeAtividades a
      WHERE a.ID = ${id}`;

    // Verifica se houve algum registro encontrado
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Nenhum anexo encontrado para este ID.' });
    }

    // Mapeia os registros encontrados para incluir as URLs dos arquivos
    const activityWithAttachments = result.recordset.map((activity) => {
      const { Anexo, QualAtividade, DataDaAtividade } = activity;

      // Valida campos necessários
      if (!Anexo || !QualAtividade || !DataDaAtividade) {
        console.error('Campos ausentes no registro:', activity);
        return activity; // Retorna a atividade sem a URL se campos necessários estiverem ausentes
      }

      // Converte a DataDaAtividade para criar o caminho do arquivo
      const dataAtividade = new Date(DataDaAtividade);
      if (isNaN(dataAtividade)) {
        console.error('DataDaAtividade inválida:', DataDaAtividade);
        return activity; // Retorna a atividade sem a URL se a data for inválida
      }

      const ano = dataAtividade.getFullYear();
      const mes = String(dataAtividade.getMonth() + 1).padStart(2, '0');
      const dia = String(dataAtividade.getDate()).padStart(2, '0');

      // Verifica se o campo Anexo é uma string de array JSON e converte para um array real
      let anexos = [];
      try {
        anexos = JSON.parse(Anexo); // Converte a string de array JSON para um array real
      } catch (error) {
        console.error('Erro ao converter Anexo para array:', error);
      }

      // Gera as URLs para cada anexo
      const anexosComUrl = anexos.map((filePath) => {
        const filename = path.basename(filePath.trim());

        // Corrige o caminho absoluto do arquivo para um caminho relativo
        const fileUrl = `http://pc107662:4001/uploads/registroDeAtividades/${ano}/${mes}/${dia}/${QualAtividade}/${filename}`;

        return { nome: filename, url: fileUrl };
      });

      // Retorna o registro com os anexos e URLs gerados
      return { anexos: anexosComUrl };
    });

    // Retorna os anexos com as URLs geradas
    res.status(200).json(activityWithAttachments[0]); // Como temos um único ID, retornamos o primeiro item
  } catch (error) {
    console.error('Erro ao buscar anexos:', error.message);
    res.status(500).json({ error: 'Erro ao buscar anexos.' });
  }
});

app.get('/gerar-pdf/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Busca os detalhes do projeto
    const projectResult = await sql.query`
      SELECT ID, NomeProjeto, Empresa, Responsavel, Prazo, EstimativaHoras
      FROM dbo.projeto
      WHERE ID = ${id}
    `;

    if (projectResult.recordset.length === 0) {
      return res.status(404).json({ message: 'Projeto não encontrado.' });
    }

    const projeto = projectResult.recordset[0];

    // Busca os registros de atividades relacionados ao projeto
    const activityResult = await sql.query`
      SELECT QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, Anexo
      FROM dbo.registroDeAtividades
      WHERE ProjetoID = ${id}
    `;

    const atividades = activityResult.recordset;

    // Configurações para o PDF
    const pdfPath = path.join(__dirname, 'uploads', 'PDFs');
    if (!fs.existsSync(pdfPath)) fs.mkdirSync(pdfPath, { recursive: true });

    const fileName = `${projeto.NomeProjeto.replace(/\s+/g, '_')}.pdf`;

    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 30 });

    // Envia o PDF diretamente como resposta (sem salvar no servidor)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + fileName + '"');

    // Stream do PDF para a resposta HTTP
    doc.pipe(res);

    // Cabeçalho do projeto
    doc.fontSize(20).text('Detalhes do Projeto', { align: 'center' }).moveDown();
    doc.fontSize(12).text(`Nome do Projeto: ${projeto.NomeProjeto}`);
    doc.text(`Empresa: ${projeto.Empresa}`);
    doc.text(`Responsável: ${projeto.Responsavel}`);
    doc.text(`Prazo: ${new Date(projeto.Prazo).toLocaleString()}`);
    doc.text(`Estimativa de Horas: ${projeto.EstimativaHoras}`).moveDown();

    // Tabela de registros de atividades
    doc.fontSize(14).text('Registros de Atividades', { underline: true }).moveDown();

    // Configuração de largura das colunas para caber corretamente
    const columnWidths = [120, 120, 80, 80, 80, 120, 150]; // Ajustadas para caber
    const startX = 30;
    let currentY = doc.y + 20;

    const drawCell = (text, x, y, width, height) => {
      doc.rect(x, y, width, height).stroke();
      doc.text(text, x + 5, y + 5, { width: width - 10, height: height - 10, ellipsis: true });
    };

    const rowHeight = 25;

    // Cabeçalho da tabela
    const headers = ['Atividade', 'Data', 'Pessoas', 'Hora Inicial', 'Hora Final', 'Responsável', 'Anexo'];
    headers.forEach((header, i) => {
      drawCell(header, startX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0), currentY, columnWidths[i], rowHeight);
    });
    currentY += rowHeight;

    // Linhas da tabela com imagens anexadas
    atividades.forEach((atividade) => {
      const values = [
        atividade.QualAtividade,
        new Date(atividade.DataDaAtividade).toLocaleDateString(),
        atividade.QuantasPessoas || 'N/A',
        atividade.HoraInicial ? new Date(atividade.HoraInicial).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A',
        atividade.HoraFinal ? new Date(atividade.HoraFinal).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A',
        atividade.Responsavel || 'N/A',
        atividade.Anexo ? 'Ver abaixo' : 'Sem Anexo',
      ];

      values.forEach((value, i) => {
        drawCell(value, startX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0), currentY, columnWidths[i], rowHeight);
      });
      currentY += rowHeight;

      // Adiciona a imagem do anexo (caso seja JPG ou PNG)
      if (atividade.Anexo && /\.(jpg|jpeg|png)$/i.test(atividade.Anexo)) {
        const imagePath = path.resolve(__dirname, 'uploads', atividade.Anexo);
        if (fs.existsSync(imagePath)) {
          const imageHeight = 80; // Altura da imagem
          const imageWidth = 100; // Largura da imagem

          // Verifica se há espaço suficiente para renderizar a imagem na mesma página
          if (currentY + imageHeight > doc.page.height) {
            doc.addPage();
            currentY = doc.y; // Reseta a posição Y para o topo da nova página
          }

          // Adiciona a imagem
          doc.image(imagePath, startX, currentY, { width: imageWidth, height: imageHeight });
          currentY += imageHeight + 10; // Incrementa a posição Y para evitar sobreposição
        }
      }
    });

    // Finaliza o documento
    doc.end();
  } catch (error) {
    console.error('Erro ao gerar o PDF:', error.message);
    res.status(500).json({ error: 'Erro ao gerar o PDF.' });
  }
});

// Endpoint para atualizar status e observação
app.put('/api/projetos/:id', async (req, res) => {
  const { id } = req.params;
  const { status, observacao } = req.body;

  try {
    const pool = await poolPromise; // Certifique-se de usar o pool criado acima

    // Atualiza o status e a observação no banco de dados
    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar, status)
      .input('observacao', sql.NVarChar, observacao)
      .query(`
        UPDATE projeto
        SET Status = @status, observacao = @observacao
        WHERE id = @id
      `);

    res.status(200).json({ message: 'Projeto atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro ao atualizar status do projeto' });
  }
});

// Endpoint para obter observação de um projeto
app.get('/api/projetos/:id/observacao', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT Observacao
        FROM projeto
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    res.status(200).json({ observacao: result.recordset[0].observacao });
  } catch (error) {
    console.error('Erro ao buscar observação:', error);
    res.status(500).json({ error: 'Erro ao buscar observação do projeto' });
  }
});

// Configuração do Sequelize
const sequelize = new Sequelize(process.env.DB_DATABASE, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_SERVER,
  dialect: 'mssql',
});

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

// Diretório onde os arquivos estão armazenados
const directoryPath = '\\\\mao-s039\\c$\\rec_facial\\registros';

// Rota principal para processar os arquivos e salvar no banco de dados
app.get('/api/ponto_fotos', async (req, res) => {
  try {
    if (!fs.existsSync(directoryPath)) {
      throw new Error(`O diretório especificado não existe: ${directoryPath}`);
    }

    const files = fs.readdirSync(directoryPath);

    const registros = files.map((file) => {
      const match = file.match(/^(.+?)_(.+?)_(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.jpg$/);
      if (!match) {
        console.warn(`Arquivo fora do padrão: ${file}`);
        return null;
      }

      let nome = match[1]; // Primeiro segmento do nome
      let restante = match[2]; // Combinação de sobrenome e projeto

      // Identificar o último underscore para separar projeto
      const lastUnderscoreIndex = restante.lastIndexOf('_');
      if (lastUnderscoreIndex !== -1) {
        nome = `${nome} ${restante.slice(0, lastUnderscoreIndex).replace(/_/g, ' ')}`; // Adicionar sobrenome ao nome
        restante = restante.slice(lastUnderscoreIndex + 1); // Parte final é o projeto
      }

      const projeto = restante; // Último segmento é o projeto
      const data = `${match[3]}-${match[4]}-${match[5]}`; // Data formatada como YYYY-MM-DD
      const hora = `${match[6]}:${match[7]}:${match[8]}`; // Hora formatada como HH:mm:ss
      const anexo = file; // Nome do arquivo para a coluna Anexo

      return { nome, projeto, data, hora, anexo };
    }).filter(Boolean); // Remove valores nulos

    for (const registro of registros) {
      const { nome, projeto, data, hora, anexo } = registro;

      if (!anexo) {
        console.error("Arquivo fora do padrão ou não definido:", registro);
        continue; // Pule arquivos sem nome válido.
      }

      console.log(`Processando: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);

      const existingRecords = await PontoFotos.findAll({ where: { nome, projeto, data } });

      const formatTime = (time) => (typeof time === 'string' ? time : time.toISOString().split('T')[1].slice(0, 8));

      if (existingRecords.length > 0) {
        const horas = existingRecords.map((rec) => rec.horaInicial).concat(hora).sort((a, b) => a.localeCompare(b));
        const horaInicial = formatTime(horas[0]);
        const horaFinal = formatTime(horas[horas.length - 1]);

        // Concatenar os anexos existentes com o novo arquivo
        const novosAnexos = existingRecords[0].anexo ? existingRecords[0].anexo.split(',').concat(anexo) : [anexo];
        const anexoAtualizado = [...new Set(novosAnexos)].join(', '); // Remove duplicatas e entradas vazias

        console.log(`Tamanho do valor em Anexo: ${anexoAtualizado.length}`);

        // Validação do tamanho do campo
        const LIMITE_DE_CARACTERES = 500; // Ajuste conforme o tamanho definido no banco
        if (anexoAtualizado.length > LIMITE_DE_CARACTERES) {
          console.error('Erro: O valor excede o limite permitido para a coluna Anexo.');
          continue;
        }

        console.log(`Atualizando registro: Nome=${nome}, Projeto=${projeto}, Hora Inicial=${horaInicial}, Hora Final=${horaFinal}, Anexos=${anexoAtualizado}`);
        await existingRecords[0].update({
          horaInicial,
          horaFinal,
          anexo: anexoAtualizado,
        });
      } else {
        console.log(`Criando novo registro: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);
        await PontoFotos.create({ nome, projeto, data, horaInicial: hora, horaFinal: hora, anexo });
      }
    }

    res.json({ message: 'Arquivos processados com sucesso.' });
  } catch (error) {
    console.error('Erro ao processar arquivos:', error);
    res.status(500).json({ error: 'Erro ao processar arquivos.' });
  }
});

// Endpoint para buscar informações da tabela "pontos_fotos"
app.get('/api/buscar-ponto', async (req, res) => {
  try {
      // Conectar ao banco de dados
      const pool = await sql.connect(dbConfig);

      // Query para buscar os dados
      const result = await pool.request().query(
          `SELECT Nome, Data, horaInicial, horaFinal, Projeto, Anexo FROM ponto_fotos`
      );

      // Função para formatar a hora no padrão HH:mm:ss
      const formatTime = (time) => {
          if (time instanceof Date) {
              return time.toISOString().split('T')[1].slice(0, 8); // Extrai HH:mm:ss de uma data completa
          }
          return time; // Assume que já está no formato HH:mm:ss se não for Date
      };

      // Função para formatar a data no padrão DD-MM-YYYY
      const formatDate = (date) => {
          if (date instanceof Date) {
              const [year, month, day] = date.toISOString().split('T')[0].split('-');
              return `${day}-${month}-${year}`; // Reorganiza para DD-MM-YYYY
          }
          if (typeof date === 'string' && date.includes('-')) {
              const [year, month, day] = date.split('-');
              return `${day}-${month}-${year}`; // Reorganiza para DD-MM-YYYY
          }
          return date; // Assume que já está no formato desejado se não for manipulável
      };

      // Verificar se existem registros no dbo.projeto com nomes correspondentes na tabela ponto_fotos
      const projetoResult = await pool.request().query(
          `SELECT DISTINCT p.Projeto
           FROM ponto_fotos p
           WHERE EXISTS (
               SELECT 1 FROM dbo.projeto pr WHERE pr.NomeProjeto = p.Projeto
           )`
      );

      const projetosValidos = projetoResult.recordset.map(item => item.Projeto);

      // Formatar os dados antes de enviar a resposta
      const formattedResult = result.recordset.map(item => {
          const formattedData = formatDate(item.Data);  // Formata a data para DD-MM-YYYY
          const formattedHoraInicial = formatTime(item.horaInicial);  // Formata a hora inicial
          const formattedHoraFinal = formatTime(item.horaFinal);  // Formata a hora final

          return {
              Nome: item.Nome,
              Data: formattedData, // Data formatada para DD-MM-YYYY
              horaInicial: formattedHoraInicial, // Hora inicial formatada
              horaFinal: formattedHoraFinal, // Hora final formatada
              Projeto: item.Projeto,
              Anexo: item.Anexo,
              ProjetoValido: projetosValidos.includes(item.Projeto) // Indica se o projeto é válido
          };
      });

      // Retornar os dados formatados para o cliente
      res.status(200).json(formattedResult);
  } catch (err) {
      console.error('Erro ao acessar o banco de dados:', err);
      res.status(500).json({ error: 'Erro ao acessar o banco de dados' });
  } finally {
      // Fechar a conexão com o banco de dados
      sql.close();
  }
});

app.post('/api/registrar-ponto-atividade', async (req, res) => {
    try {
        const { Nome, Data, horaInicial, horaFinal, Projeto, Anexo, ProjetoValido } = req.body;

        // Validar campos obrigatórios
        if (!Nome || !Data || !horaInicial || !horaFinal || !Projeto || !Anexo || ProjetoValido === undefined) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
        }

        // Validar se o projeto é válido
        if (!ProjetoValido) {
            return res.status(400).json({ error: 'Projeto inválido. Não é possível registrar a atividade.' });
        }

        // Validar e formatar a hora
        const horaInicialFormatada = formatTimeForSQL(horaInicial);
        const horaFinalFormatada = formatTimeForSQL(horaFinal);

        // Validar e formatar a data
        const dataRegex = /^\d{2}-\d{2}-\d{4}$/; // Formato DD-MM-YYYY
        if (!dataRegex.test(Data)) {
            return res.status(400).json({ error: 'Formato de data inválido. Use DD-MM-YYYY.' });
        }

        const [day, month, year] = Data.split('-');
        const dataFormatada = new Date(`${year}-${month}-${day}`);
        if (isNaN(dataFormatada.getTime())) {
            return res.status(400).json({ error: 'Data inválida. Verifique os valores fornecidos.' });
        }

        // Conectar ao banco de dados
        const pool = await sql.connect(dbConfig);

        // Verificar se o projeto existe no banco (opcional, pois ProjetoValido já é fornecido)
        const projetoResult = await pool.request()
            .input('NomeProjeto', sql.VarChar, Projeto)
            .query(`SELECT ID FROM dbo.projeto WHERE NomeProjeto = @NomeProjeto`);

        if (projetoResult.recordset.length === 0) {
            return res.status(400).json({ error: 'Projeto não encontrado no banco de dados.' });
        }

        const ProjetoID = projetoResult.recordset[0].ID;

        // Processar a lista de anexos
        const anexosArray = Anexo.split(',').map(anexo => anexo.trim()); // Separar e limpar os valores

        // Inserir no banco de dados
        await pool.request()
            .input('QualAtividade', sql.VarChar, `Registro de Ponto =${Nome}`)
            .input('DataDaAtividade', sql.Date, dataFormatada)
            .input('QuantasPessoas', sql.Int, 1)
            .input('HoraInicial', sql.Time, new Date(`1970-01-01T${horaInicialFormatada}Z`))
            .input('HoraFinal', sql.Time, new Date(`1970-01-01T${horaFinalFormatada}Z`))
            .input('Responsavel', sql.VarChar, Nome)
            .input('ProjetoID', sql.Int, ProjetoID)
            .input('Anexo', sql.VarChar, anexosArray.join(';')) // Armazenar os anexos como string separada por ';'
            .query(`
                INSERT INTO dbo.registroDeAtividades 
                (QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, ProjetoID, Anexo)
                VALUES 
                (@QualAtividade, @DataDaAtividade, @QuantasPessoas, @HoraInicial, @HoraFinal, @Responsavel, @ProjetoID, @Anexo)
            `);

        res.status(201).json({ message: 'Atividade registrada com sucesso.' });
    } catch (err) {
        console.error('Erro ao registrar atividade:', err.message);
        res.status(500).json({ error: 'Erro ao registrar atividade.' });
    }
});


// Iniciar o servidor e a conexão com o banco
connectToDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
  });
});
