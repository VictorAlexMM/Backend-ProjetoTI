// Importações
const express = require('express');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const axios = require('axios');
require('dotenv').config();
const cors = require('cors');
const PDFDocument = require('pdfkit');


const app = express();
const port = process.env.PORT;

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
// Obter o tempo de inicialização do servidor
const serverStartTime = Date.now();
// Diretório para monitorar
const watchDirectory = '\\\\mao-s039\\c$\\rec_facial\\registros';

// Função para verificar se o arquivo é novo
function isNewFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.birthtimeMs >= serverStartTime; // Verifica se o arquivo foi criado após o início do servidor
  } catch (error) {
    console.error('Erro ao verificar o arquivo:', error);
    return false;
  }
}
// Função para coletar as informações do arquivo
const getFileInfo = (filePath) => {
  const fileName = path.basename(filePath); // Nome do arquivo
  const match = fileName.match(/^(.+?)_(.+?)_(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.jpg$/);
  if (!match) return null; // Se o arquivo não corresponde ao padrão, retorna null

  let nome = match[1]; // Nome
  let restante = match[2]; // Sobrenome e projeto

  // Identificar o último underscore para separar projeto
  const lastUnderscoreIndex = restante.lastIndexOf('_');
  if (lastUnderscoreIndex !== -1) {
    nome = `${nome} ${restante.slice(0, lastUnderscoreIndex).replace(/_/g, ' ')}`; // Adicionar sobrenome ao nome
    restante = restante.slice(lastUnderscoreIndex + 1); // O resto é o projeto
  }

  const projeto = restante; // Nome do projeto
  const data = `${match[3]}-${match[4]}-${match[5]}`; // Data formatada
  const hora = `${match[6]}:${match[7]}:${match[8]}`; // Hora formatada

  return { nome, projeto, data, hora, anexo: fileName }; // Retorna as informações extraídas
};

// Configuração do watcher
const watcher = chokidar.watch(watchDirectory, {
  persistent: true,
  ignoreInitial: true, // Ignorar os arquivos existentes ao iniciar o watcher
  usePolling: true, // Necessário para diretórios de rede
  interval: 1000, // Verifica alterações a cada segundo
});

// Monitorar adição de novos arquivos
watcher
  .on('add', async (filePath) => {
    console.log(`Novo arquivo detectado: ${filePath}`);

    try {
      // Coletar informações do arquivo
      const fileInfo = getFileInfo(filePath);
      if (!fileInfo) {
        console.log(`Arquivo fora do padrão: ${filePath}`);
        return; // Ignora arquivos fora do padrão
      }

      console.log('Enviando dados para a API...', fileInfo);

      // Chamar API POST para processar os arquivos no diretório
      const response = await axios.post('http://pc107662:4002/api/ponto_fotos', {
        files: [fileInfo], // Envia o arquivo no corpo da requisição
      });
      
      console.log('Resposta da API POST:', response.data);
    } catch (error) {
      console.error(`Erro ao chamar API POST: ${error.message}`);
    }
  })
  .on('error', (error) => {
    console.error(`Erro no watcher: ${error.message}`);
  });
console.log(`Monitorando o diretório: ${watchDirectory}`);

app.post('/api/ponto_fotos', async (req, res) => {
  const { files } = req.body;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  // Processar os arquivos conforme necessário
  // Aqui você pode adicionar a lógica para salvar os dados no banco de dados ou realizar outras operações

  res.status(200 ).json({ message: 'Arquivos processados com sucesso.' });
});

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

        // Formatação de ano, mês e dia com base na data UTC
        const ano = data.getUTCFullYear();
        const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
        const dia = String(data.getUTCDate()).padStart(2, '0');

        // Caminho onde os arquivos serão armazenados
        const dir = path.join(__dirname, 'uploads', 'registroDeAtividades', ano.toString(), mes, dia);

        // Criação do diretório de forma recursiva, caso não exista
        fs.mkdirSync(dir, { recursive: true });

        // Define o diretório de destino para o upload
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        // Define o nome do arquivo com o nome original
        cb(null, file.originalname);
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
      // Se ocorrer erro durante o upload (ex: tipo de arquivo inválido ou pasta não existente)
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

    // Mapeia os arquivos para o nome final onde foram salvos, apenas o nome do arquivo
    const anexos = req.files.map((file) => file.originalname).join(', ');  // Armazena como uma string separada por vírgulas

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
        ${anexos} -- Armazena os nomes dos anexos como uma string simples
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

      // Converte a DataDaAtividade para criar o caminho do arquivo usando UTC
      const dataAtividade = new Date(DataDaAtividade);
      if (isNaN(dataAtividade)) {
        console.error('DataDaAtividade inválida:', DataDaAtividade);
        return attachment; // Retorna o registro sem a URL se a data for inválida
      }

      // Extrai ano, mês e dia no contexto UTC
      const ano = dataAtividade.getUTCFullYear();
      const mes = String(dataAtividade.getUTCMonth() + 1).padStart(2, '0'); // Mês corrigido (1-indexado)
      const dia = String(dataAtividade.getUTCDate()).padStart(2, '0'); // Dia no contexto UTC

      // Divide os anexos em um array (caso haja mais de um)
      const anexos = Anexo.split(',').map((anexo) => {
        const filename = path.basename(anexo.trim()); // Remove espaços extras e extrai o nome do arquivo
        // Gera a URL do arquivo
        return `http://pc107662:4002/uploads/registroDeAtividades/${ano}/${mes}/${dia}/${filename}`;
      });

      // Retorna o registro com os anexos separados
      return { ...attachment, fileUrls: anexos };
    });

    // Retorna os registros com as URLs geradas
    res.status(200).json(attachments);
  } catch (error) {
    console.error('Erro ao buscar registros de atividades:', error.message);
    res.status(500).json({ error: 'Erro ao buscar registros de atividades.' });
  }
});



// Servindo arquivos estáticos da rede
app.use('/uploads', express.static('\\\\mao-s039\\c$\\rec_facial\\registros'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

      // O caminho do arquivo é diretamente retirado da coluna Anexo
      let anexos = [];

      // Verifica se o campo Anexo é uma string ou um JSON
      if (typeof Anexo === 'string') {
        // Se for uma string simples, podemos tratá-la diretamente
        anexos = [Anexo];
      } else {
        try {
          anexos = JSON.parse(Anexo); // Converte a string de array JSON para um array real
        } catch (error) {
          console.error('Erro ao converter Anexo para array:', error);
        }
      }

      // Gera as URLs para cada anexo
      const anexosComUrl = anexos.map((filePath) => {
        const trimmedFilePath = filePath.trim();

        // Verifica se o filePath não está vazio ou nulo
        if (!trimmedFilePath) {
          return null; // Ignora caso o caminho esteja vazio
        }

        const filename = path.basename(trimmedFilePath);

        // Remove a parte do caminho absoluto, mantendo apenas a parte após a pasta "uploads"
        let relativePath = trimmedFilePath.replace(/^.*\\uploads/, '/uploads');  // Remove a parte antes de "/uploads"

        // Corrige o caminho da URL, considerando o formato que você mencionou
        let fileUrl = `http://pc107662:4002${relativePath.replace(/\\/g, '/')}`;

        // Remove caracteres indesejados como \"] no final da URL
        fileUrl = fileUrl.replace(/\\?"]$/, '');

        return { nome: filename, url: fileUrl };
      }).filter(Boolean); // Remove valores null ou inválidos

      // Retorna o registro com os anexos e URLs gerados
      return { anexos: anexosComUrl };
    });

    // Retorna os anexos com as URLs geradas
    res.status(200).json(activityWithAttachments[0]); // Como temos um único ID, retornamos o primeiro item
  } catch (error) {
    console.error('Erro ao buscar anexos:', error.message);
    res.status(500).json({ error: 'Erro ao buscar anexos.', details: error.message });
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

// Iniciar o servidor e a conexão com o banco
connectToDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
  });
});
