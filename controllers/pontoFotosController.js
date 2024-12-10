const fs = require('fs');
const { Sequelize, Op } = require('sequelize');
const PontoFotos = require('../models/PontoFotos');
const chokidar = require('chokidar');
const sql = require('mssql');
const dbConfig = require('../config/dbConfig');

/**
 * Processa arquivos e salva no banco de dados.
 */
const ponto_fotos = async (req = {}, res = null) => {
    try {
        const directoryPath = '\\\\mao-s039\\c$\\rec_facial\\registros';
        if (!fs.existsSync(directoryPath)) {
            throw new Error(`O diretório especificado não existe: ${directoryPath}`);
        }

        const files = req.filePath ? [req.filePath.split('\\').pop()] : fs.readdirSync(directoryPath);

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

        // Processamento paralelo dos registros
        await Promise.all(registros.map(async (registro) => {
            const { nome, projeto, data, hora, anexo } = registro;

            if (!anexo) {
                console.error("Arquivo fora do padrão ou não definido:", registro);
                return;
            }

            console.log(`Processando: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);

            // Busca registros existentes pelo mesmo nome, projeto e data
            const existingRecords = await PontoFotos.findAll({
                attributes: ['id', 'horaInicial', 'horaFinal', 'anexo'],
                where: { nome, projeto, data },
            });

            if (existingRecords.length > 0) {
                // Formatar hora
                const formatTime = (time) => (typeof time === 'string' ? time : time.toISOString().split('T')[1].slice(0, 8));

                // Determinar novas horaInicial e horaFinal
                const horas = existingRecords.map((rec) => rec.horaInicial)
                    .concat(existingRecords.map((rec) => rec.horaFinal))
                    .concat(hora)
                    .filter(Boolean)
                    .map((time) => typeof time === 'string' ? time : time.toISOString().split('T')[1].slice(0, 8)) // Garantir que todos sejam strings
                    .sort((a, b) => a.localeCompare(b));

                const horaInicial = formatTime(horas[0]);
                const horaFinal = formatTime(horas[horas.length - 1]);

                console.log(`Atualizando registro: Nome=${nome}, Projeto=${projeto}, Hora Inicial=${horaInicial}, Hora Final=${horaFinal}`);

                await existingRecords[0].update({ horaInicial, horaFinal });
            } else {
                console.log(`Criando novo registro: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);
                await PontoFotos.create({ nome, projeto, data, horaInicial: hora, horaFinal: hora, anexo });
            }

            // Registrar atividade após atualizar ou criar ponto_fotos
            if (res) {
                await registrarAtividade({ Nome: nome, Data: data, horaInicial: hora, horaFinal: hora, Projeto: projeto, Anexo: anexo }, res);
            }
        }));

        if (res) {
            res.json({ message: 'Arquivos processados com sucesso.' });
        }
    } catch (error) {
        console.error('Erro ao processar arquivos:', error.message);
        if (res) {
            res.status(500).json({ error: 'Erro ao processar arquivos.' });
        }
    }
};

/**
 * Registra atividade no banco de dados.
 */
const registrarAtividade = async (req, res) => {
    let transaction;
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
        const formatTimeForSQL = (time) => {
            return (typeof time === 'string' ? time : time.toISOString().split('T')[1].slice(0, 8));
        };

        const horaInicialFormatada = formatTimeForSQL(horaInicial);
        const horaFinalFormatada = formatTimeForSQL(horaFinal);

        // Validar e formatar a data
        const dataRegex = /^\d{2}-\d{2}-\d{4}$/;
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
        transaction = new sql.Transaction(pool);
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
        const anexosArray = Anexo.split(',').map(anexo => anexo.trim()).filter(anexo => anexo !== '');

        // Verificar se já existe um registro para o mesmo Nome, Data e Projeto
        const existingRecord = await transaction.request()
            .input('Nome', sql.VarChar, Nome)
            .input('Data', sql.Date, dataFormatada)
            .input('ProjetoID', sql.Int, ProjetoID)
            .query(`
                SELECT * FROM dbo.registroDeAtividades 
                WHERE LOWER(Responsavel) = LOWER(@Nome) 
                AND DataDaAtividade = @Data 
                AND ProjetoID = @ProjetoID
            `);

        if (existingRecord.recordset.length > 0) {
            // Já existe um registro, vamos atualizar as colunas que necessitam de atualização
            const updateFields = [];
            const params = [];

            const existingRecords = existingRecord.recordset;
            existingRecords.sort((a, b) => a.HoraInicial.localeCompare(b.HoraInicial));

            // Verificar e atualizar HoraInicial e HoraFinal
            const horaInicialExistente = existingRecords[0].HoraInicial;
            const horaFinalExistente = existingRecords[existingRecords.length - 1].HoraFinal;

            // Atualizar HoraInicial se necessário
            if (horaInicialExistente !== horaInicialFormatada) {
                updateFields.push('HoraInicial = @HoraInicial');
                params.push({ name: 'HoraInicial', value: new Date(`1970-01-01T${horaInicialFormatada}Z`) });
            }

            // Atualizar HoraFinal se necessário
            if (horaFinalExistente !== horaFinalFormatada) {
                updateFields.push('HoraFinal = @HoraFinal');
                params.push({ name: 'HoraFinal', value: new Date(`1970-01-01T${horaFinalFormatada}Z`) });
            }

            // Atualizar Anexo se necessário
            const anexosAtualizados = anexosArray.join(';');
            if (anexosAtualizados !== existingRecords[0].Anexo) {
                updateFields.push('Anexo = @Anexo');
                params.push({ name: 'Anexo', value: anexosAtualizados });
            }

            // Se algum campo precisa ser atualizado
            if (updateFields.length > 0) {
                let updateQuery = `
                    UPDATE dbo.registroDeAtividades
                    SET ${updateFields.join(', ')}
                    WHERE LOWER(Responsavel) = LOWER(@Nome)
                    AND ProjetoID = @ProjetoID
                    AND DataDaAtividade = @Data
                `;
                // Adicionar parâmetros ao request
                const request = transaction.request();
                params.forEach(param => {
                    request.input(param.name, sql.VarChar, param.value);
                });

                await request.query(updateQuery);

                // Mensagem de log: Registro atualizado
                console.log(`Registro atualizado: Nome=${Nome}, Projeto=${Projeto}, Hora Inicial=${horaInicialFormatada}, Hora Final=${horaFinalFormatada}`);
            }

        } else {
            // Caso não exista, criar um novo registro
            await transaction.request()
                .input('QualAtividade', sql.VarChar, `Registro de Ponto = ${Nome}`)
                .input('DataDaAtividade', sql.Date, dataFormatada)
                .input('QuantasPessoas', sql.Int, 1)
                .input('HoraInicial', sql.Time, new Date(`1970-01-01T${horaInicialFormatada}Z`))
                .input('HoraFinal', sql.Time, new Date(`1970-01-01T${horaFinalFormatada}Z`))
                .input('Responsavel', sql.VarChar, Nome)
                .input('ProjetoID', sql.Int, ProjetoID)
                .input('Anexo', sql.VarChar, anexosArray.join(';'))
                .query(`
                    INSERT INTO dbo.registroDeAtividades 
                    (QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, ProjetoID, Anexo)
                    VALUES 
                    (@QualAtividade, @DataDaAtividade, @QuantasPessoas, @HoraInicial, @HoraFinal, @Responsavel, @ProjetoID, @Anexo)
                `);

            // Mensagem de log: Novo registro criado
            console.log(`Novo registro criado: Nome=${Nome}, Projeto=${Projeto}, Data=${Data}, Hora Inicial=${horaInicialFormatada}, Hora Final=${horaFinalFormatada}`);
        }

        // Commit da transação
        await transaction.commit();

        // Retornar resposta de sucesso
        res.status(201).json({ message: 'Atividade registrada com sucesso.' });

    } catch (err) {
        console.error('Erro ao registrar atividade:', err);
        
        // Se houver erro, efetuar o rollback da transação
        if (transaction) {
            await transaction.rollback();
        }

        res.status(500).json({ error: 'Erro ao registrar atividade.' });
    } finally {
        sql.close();
    }
};

/**
 * Busca registros de ponto_fotos no banco.
 */
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

/**
 * Inicia monitoramento do diretório.
 */
const startDirectoryListener = () => {
    const directoryPath = '\\\\mao-s039\\c$\\rec_facial\\registros';

    const watcher = chokidar.watch(directoryPath, {
        persistent: true,
        ignoreInitial: true,
        ignored: /DumpStack\.log\.tmp/,
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100,
        },
    });

    watcher
        .on('add', async (filePath) => {
            console.log(`Novo arquivo detectado: ${filePath}`);
            await ponto_fotos({ filePath });
        })
        .on('error', (error) => {
            console.error('Erro ao monitorar diretório:', error.message);
        });
};

module.exports = {
    ponto_fotos,
    buscarPontos,
    registrarAtividade,
    startDirectoryListener,
};
