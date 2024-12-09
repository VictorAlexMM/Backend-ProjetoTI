const fs = require('fs');
const { Sequelize, Op } = require('sequelize');
const PontoFotos = require('../models/PontoFotos');
const chokidar = require('chokidar');
const sql = require('mssql');
const dbConfig = require('../config/dbConfig');

// Função para processar os arquivos e salvar no banco de dados
const ponto_fotos = async (req, res) => {
    try {
      const directoryPath =  '\\\\mao-s039\\c$\\rec_facial\\registros'; // Caminho para o diretório
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
  
        let nome = match[1];
        let restante = match[2];
  
        const lastUnderscoreIndex = restante.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
          nome = `${nome} ${restante.slice(0, lastUnderscoreIndex).replace(/_/g, ' ')}`;
          restante = restante.slice(lastUnderscoreIndex + 1);
        }
  
        const projeto = restante;
        const data = `${match[3]}-${match[4]}-${match[5]}`;
        const hora = `${match[6]}:${match[7]}:${match[8]}`;
        const anexo = file;
  
        return { nome, projeto, data, hora, anexo };
      }).filter(Boolean);
  
      for (const registro of registros) {
        const { nome, projeto, data, hora, anexo } = registro;
  
        if (!anexo) {
          console.error("Arquivo fora do padrão ou não definido:", registro);
          continue;
        }
  
        console.log(`Processando: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);
  
        // Verificar se já existe um registro com o mesmo nome, projeto e data
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
  };
  

// Função para buscar os pontos de fotos no banco de dados
const buscarPontos = async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);

    const result = await pool.request().query(
      `SELECT Nome, Data, horaInicial, horaFinal, Projeto, Anexo FROM ponto_fotos`
    );

    const formatTime = (time) => (typeof time === 'string' ? time : time.toISOString().split('T')[1].slice(0, 8));

    const formatDate = (date) => {
      if (date instanceof Date) {
        const [year, month, day] = date.toISOString().split('T')[0].split('-');
        return `${day}-${month}-${year}`;
      }
      return date;
    };

    const projetoResult = await pool.request().query(
      `SELECT DISTINCT p.Projeto
       FROM ponto_fotos p
       WHERE EXISTS (
           SELECT 1 FROM dbo.projeto pr WHERE pr.NomeProjeto = p.Projeto
       )`
    );

    const projetosValidos = projetoResult.recordset.map(item => item.Projeto);

    const formattedResult = result.recordset.map(item => {
      const formattedData = formatDate(item.Data);
      const formattedHoraInicial = formatTime(item.horaInicial);
      const formattedHoraFinal = formatTime(item.horaFinal);

      return {
        Nome: item.Nome,
        Data: formattedData,
        horaInicial: formattedHoraInicial,
        horaFinal: formattedHoraFinal,
        Projeto: item.Projeto,
        Anexo: item.Anexo,
        ProjetoValido: projetosValidos.includes(item.Projeto),
      };
    });

    res.status(200).json(formattedResult);
  } catch (error) {
    console.error('Erro ao buscar pontos de fotos:', error.message);
    res.status(500).json({ error: 'Erro ao buscar pontos de fotos' });
  } finally {
    sql.close();
  }
};

const registrarAtividade = async (req, res) => {
    try {
      // Desestruturando os dados do corpo da requisição
      const { Nome, Data, horaInicial, horaFinal, Projeto, Anexo, ProjetoValido } = req.body;
  
      // Validar campos obrigatórios
      if (!Nome || !Data || !horaInicial || !horaFinal || !Projeto || !Anexo || ProjetoValido === undefined) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
      }
  
      // Validar se o projeto é válido
      if (!ProjetoValido) {
        return res.status(400).json({ error: 'Projeto inválido. Não é possível registrar a atividade.' });
      }
  
      // Validar e formatar a hora (função auxiliar para formatar o horário)
      const formatTimeForSQL = (time) => {
        return (typeof time === 'string' ? time : time.toISOString().split('T')[1].slice(0, 8));
      };
  
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
  
      if (!pool) {
        return res.status(500).json({ error: 'Falha ao conectar ao banco de dados.' });
      }
  
      // Iniciar transação
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
  
      // Verificar se o projeto existe no banco de dados
      const projetoResult = await transaction.request()
        .input('NomeProjeto', sql.VarChar, Projeto)
        .query(`SELECT ID FROM dbo.projeto WHERE LOWER(NomeProjeto) = LOWER(@NomeProjeto)`);
  
      if (projetoResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Projeto não encontrado no banco de dados.' });
      }
  
      const ProjetoID = projetoResult.recordset[0].ID;
  
      // Processar a lista de anexos
      const anexosArray = Anexo.split(',').map(anexo => anexo.trim()).filter(anexo => anexo !== ''); // Filtrando anexos vazios
  
      // Inserir no banco de dados
      await transaction.request()
        .input('QualAtividade', sql.VarChar, `Registro de Ponto = ${Nome}`)
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
  
      // Commit da transação
      await transaction.commit();
  
      // Retornar resposta de sucesso
      res.status(201).json({ message: 'Atividade registrada com sucesso.' });
  
    } catch (err) {
      console.error('Erro ao registrar atividade:', err.message);
      res.status(500).json({ error: 'Erro ao registrar atividade.' });
    }
  };
  
// Função para monitorar o diretório
const startDirectoryListener = () => {
  const directoryPath = '\\\\mao-s039\\c$\\rec_facial\\registros';

  const watcher = chokidar.watch(directoryPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /DumpStack\.log\.tmp/,
  });

  watcher
    .on('add', (filePath) => {
      console.log(`Novo arquivo detectado: ${filePath}`);
      // Adicione a lógica para processar o arquivo
    })
    .on('error', (error) => {
      console.error('Erro no monitoramento de arquivos:', error);
    });
};

module.exports = {
  ponto_fotos,
  buscarPontos,
  registrarAtividade,
  startDirectoryListener,
};
