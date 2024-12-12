require('dotenv').config();
const fs = require('fs/promises');
const { existsSync } = require('fs');
const path = require('path');
const { Sequelize, Op } = require('sequelize');
const PontoFotos = require('../models/PontoFotos');
const chokidar = require('chokidar');
const sql = require('mssql');
const dbConfig = require('../config/dbConfig');
const { format } = require('date-fns');

// Diretório configurado via variável de ambiente
const DIRECTORY_PATH = process.env.DIRECTORY_PATH ;

const validateFilePattern = (file) => {
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
};

const ponto_fotos = async (req = {}, res = null) => {
    try {
        if (!existsSync(DIRECTORY_PATH)) {
            throw new Error(`O diretório especificado não existe: ${DIRECTORY_PATH}`);
        }

        const files = req.filePath
            ? [path.basename(req.filePath)]
            : await fs.readdir(DIRECTORY_PATH);

        const registros = files.map(validateFilePattern).filter(Boolean);

        // Processamento paralelo dos registros
        await Promise.all(registros.map(async (registro) => {
            const { nome, projeto, data, hora, anexo } = registro;

            console.log(`Processando: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);

            // Busca registros existentes pelo mesmo nome, projeto e data
            const existingRecords = await PontoFotos.findAll({
                attributes: ['id', 'horaInicial', 'horaFinal', 'anexo'],
                where: { nome, projeto, data },
            });

            if (existingRecords.length > 0) {
                const formatTime = (time) => (typeof time === 'string' ? time : format(new Date(time), 'HH:mm:ss'));
                const horas = existingRecords
                    .flatMap((rec) => [rec.horaInicial, rec.horaFinal])
                    .concat(hora)
                    .filter(Boolean)
                    .map(formatTime)
                    .sort();

                const horaInicial = horas[0];
                const horaFinal = horas[horas.length - 1];

                console.log(`Atualizando registro: Nome=${nome}, Projeto=${projeto}, Hora Inicial=${horaInicial}, Hora Final=${horaFinal}`);

                await existingRecords[0].update({ horaInicial, horaFinal });
            } else {
                console.log(`Criando novo registro: Nome=${nome}, Projeto=${projeto}, Data=${data}, Hora=${hora}, Anexo=${anexo}`);
                await PontoFotos.create({ nome, projeto, data, horaInicial: hora, horaFinal: hora, anexo });
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

const registrarAtividade = async (req, res) => {
    let transaction;
    try {
        const { Nome, Data, horaInicial, horaFinal, Projeto, Anexo, ProjetoValido } = req.body;

        if (!Nome || !Data || !horaInicial || !horaFinal || !Projeto || !Anexo || ProjetoValido === undefined) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
        }

        if (!ProjetoValido) {
            return res.status(400).json({ error: 'Projeto inválido. Não é possível registrar a atividade.' });
        }

        const pool = await sql.connect(dbConfig);
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const projetoResult = await transaction.request()
            .input('NomeProjeto', sql.VarChar, Projeto)
            .query('SELECT ID FROM dbo.projeto WHERE LOWER(NomeProjeto) = LOWER(@NomeProjeto)');

        if (projetoResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Projeto não encontrado no banco de dados.' });
        }

        const ProjetoID = projetoResult.recordset[0].ID;
        const anexosArray = Anexo.split(',').map(anexo => anexo.trim()).filter(Boolean);

        const existingRecord = await transaction.request()
            .input('Nome', sql.VarChar, Nome)
            .input('Data', sql.Date, new Date(Data))
            .input('ProjetoID', sql.Int, ProjetoID)
            .query(`
                SELECT * FROM dbo.registroDeAtividades 
                WHERE LOWER(Responsavel) = LOWER(@Nome) 
                AND DataDaAtividade = @Data 
                AND ProjetoID = @ProjetoID
            `);

        if (existingRecord.recordset.length > 0) {
            const updateFields = [];
            const params = [];

            const horaInicialExistente = existingRecord.recordset[0].HoraInicial;
            const horaFinalExistente = existingRecord.recordset[0].HoraFinal;

            if (horaInicialExistente !== horaInicial) {
                updateFields.push('HoraInicial = @HoraInicial');
                params.push({ name: 'HoraInicial', value: horaInicial });
            }

            if (horaFinalExistente !== horaFinal) {
                updateFields.push('HoraFinal = @HoraFinal');
                params.push({ name: 'HoraFinal', value: horaFinal });
            }

            if (updateFields.length > 0) {
                let updateQuery = `
                    UPDATE dbo.registroDeAtividades
                    SET ${updateFields.join(', ')}
                    WHERE LOWER(Responsavel) = LOWER(@Nome)
                    AND ProjetoID = @ProjetoID
                    AND DataDaAtividade = @Data
                `;

                const request = transaction.request();
                params.forEach(param => {
                    request.input(param.name, sql.VarChar, param.value);
                });

                await request.query(updateQuery);
            }
        } else {
            await transaction.request()
                .input('QualAtividade', sql.VarChar, `Registro de Ponto = ${Nome}`)
                .input('DataDaAtividade', sql.Date, new Date(Data))
                .input('QuantasPessoas', sql.Int, 1)
                .input('HoraInicial', sql.Time, horaInicial)
                .input('HoraFinal', sql.Time, horaFinal)
                .input('Responsavel', sql.VarChar, Nome)
                .input('ProjetoID', sql.Int, ProjetoID)
                .input('Anexo', sql.VarChar, anexosArray.join(';'))
                .query(`
                    INSERT INTO dbo.registroDeAtividades 
                    (QualAtividade, DataDaAtividade, QuantasPessoas, HoraInicial, HoraFinal, Responsavel, ProjetoID, Anexo)
                    VALUES 
                    (@QualAtividade, @DataDaAtividade, @QuantasPessoas, @HoraInicial, @HoraFinal, @Responsavel, @ProjetoID, @Anexo)
                `);
        }

        await transaction.commit();
        res.status(201).json({ message: 'Atividade registrada com sucesso.' });
    } catch (error) {
        console.error('Erro ao registrar atividade:', error.message);
        if (transaction) await transaction.rollback();
        res.status(500).json({ error: 'Erro ao registrar atividade.' });
    } finally {
        sql.close();
    }
};

const startDirectoryListener = () => {
    const watcher = chokidar.watch(DIRECTORY_PATH, {
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
    registrarAtividade,
    startDirectoryListener,
};
