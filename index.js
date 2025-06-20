const digite = require("prompt-sync")();
const { Client } = require("pg");
const bcrypt = require('bcrypt');
const { authenticator } = require('otplib');
const fetch = require('node-fetch');
const qrcode = require('qrcode-terminal');

// Configurações do banco de dados
const dbConfig = {
    database: "Login_User",
    user: "admin",
    password: "admin",
    host: "localhost",
    port: 5432
};

// URL da API Genderize
const API_URL = "https://api.genderize.io";

// Função para determinar gênero usando a API
async function determinarGenero(nome) {
    try {
        const primeiroNome = nome.split(' ')[0];
        const response = await fetch(`${API_URL}?name=${encodeURIComponent(primeiroNome)}`);

        if (!response.ok) {
            console.error(`Erro HTTP: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();

        if (!data.gender || !data.probability || Number(data.probability) < 0.5) {
            return null;
        }

        return {
            genero: data.gender,
            probabilidade: Number(data.probability)
        };
    } catch (err) {
        console.error('Erro ao acessar a API Genderize:', err.message);
        return null;
    }
}

// Criar nova conexão com o banco
async function criarConexao() {
    const client = new Client(dbConfig);
    await client.connect();
    return client;
}

// Criar saudação baseada no gênero
function criarSaudacao(nome, genero) {
    const primeiroNome = nome.split(' ')[0];
    if (genero === 'female') {
        return `Bem-vinda, ${primeiroNome}!`;
    } else if (genero === 'male') {
        return `Bem-vindo, ${primeiroNome}!`;
    } else {
        return `Bem-vindo(a), ${primeiroNome}!`;
    }
}

// Menu principal
function exibirMenu() {
    console.log("\n======== MENU PRINCIPAL ========");
    console.log("1. Login");
    console.log("2. Cadastrar novo usuário");
    console.log("3. Listar todos usuários");
    console.log("4. Editar usuário");
    console.log("5. Excluir usuário");
    console.log("6. Estatísticas de gênero");
    console.log("7. Sair");
    return digite("Escolha uma opção: ");
}

// Função de login
async function login() {
    console.log("\n======== LOGIN ========");
    const client = await criarConexao();
    try {
        const email = digite("Digite seu email: ");
        const senha = digite("Digite sua senha: ");

        // Busca usuário por email
        const res = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        if (res.rows.length === 0) {
            console.log("\nUsuário não encontrado!");
            return null;
        }

        const usuario = res.rows[0];

        // Verifica senha
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            console.log("\nSenha incorreta!");
            return null;
        }

        // Verifica autenticação de dois fatores
        if (usuario.otp_secret) {
            console.log("\nAutenticação de dois fatores está habilitada.");
            const token = digite("Digite o código de autenticação: ");
            if (!authenticator.check(token, usuario.otp_secret)) {
                console.log("\nCódigo inválido! Acesso negado.");
                return null;
            }
        } else {
            const configurarOtp = digite("\nDeseja configurar autenticação de dois fatores? (s/n): ").toLowerCase();
            if (configurarOtp === 's') {
                const otpSecret = authenticator.generateSecret();
                qrcode.generate(authenticator.keyuri(email, 'Login_User', otpSecret), { small: true });
                console.log("Escaneie o QR Code com seu app de autenticação.");
                const token = digite("Digite o código gerado pelo app: ");
                if (!authenticator.check(token, otpSecret)) {
                    console.log("\nCódigo inválido! Configuração falhou.");
                    return null;
                }

                await client.query('UPDATE users SET otp_secret = $1 WHERE id = $2', [otpSecret, usuario.id]);
                console.log("\nAutenticação de dois fatores configurada!");
            }
        }

        console.log(criarSaudacao(usuario.nome, usuario.genero));
        return usuario;

    } catch (err) {
        console.error('\nErro no login:', err);
    } finally {
        await client.end();
    }
}

// Cadastrar novo usuário
async function cadastrarUsuario() {
    console.log("\n======== CADASTRAR USUÁRIO ========");
    const client = await criarConexao();
    try {
        const nome = digite("Digite seu nome completo: ");
        const email = digite("Digite seu email: ");
        const senha = digite("Digite sua senha: ");

        async function Verificarerros() {
            if (!nome || !email || !senha) {
                console.log("\nTodos os campos são obrigatórios!");
                return;
            }

            // Verifica se o nome contém apenas letras e espaços
            if (!/^[a-zA-Z\s]+$/.test(nome)) {
                console.log("\nO nome deve conter apenas letras e espaços!");
                return;
            }
            // Verifica se email é válido
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                console.log("\nEmail inválido!");
                return;
            }
            // Verifica se senha é forte
            if (senha.length < 6) {
                console.log("\nA senha deve ter pelo menos 6 caracteres!");
                return;
            }
            // Verifica se email já existe
            const VerificaEmail = await client.query('SELECT * FROM users WHERE email = $1', [email]);
            if (resEmail.rows.length > 0) {
                console.log("\nEmail já cadastrado!");
                return;
            }
            return true;
            

        }

        // Determina gênero
        let genero = null;
        let probabilidade = null;
        const dadosGenero = await determinarGenero(nome);

        if (dadosGenero) {
            genero = dadosGenero.genero;
            probabilidade = dadosGenero.probabilidade;
            console.log(`Gênero detectado: ${genero} (${Math.round(probabilidade * 100)}% de precisão)`);
        } else {
            console.log("\nNão foi possível determinar o gênero automaticamente.");
            const generoInput = digite("Informe seu gênero (M/F/O): ").toLowerCase();
            genero = generoInput === 'm' ? 'male' : generoInput === 'f' ? 'female' : 'other';
            probabilidade = 1.0;
        }

        // Criptografa senha
        const hashSenha = await bcrypt.hash(senha, 10);

        // Insere usuário
        await client.query(
            'INSERT INTO users (nome, email, senha, genero, prob_genero) VALUES ($1, $2, $3, $4, $5)',
            [nome, email, hashSenha, genero, probabilidade]
        );

        console.log("\nUsuário cadastrado com sucesso!");

        // Configuração de 2FA
        const configurarOtp = digite("Deseja configurar autenticação de dois fatores? (s/n): ").toLowerCase();
        if (configurarOtp === 's') {
            const otpSecret = authenticator.generateSecret();
            qrcode.generate(authenticator.keyuri(email, 'Login_User', otpSecret), { small: true });
            console.log("Escaneie o QR Code com seu app de autenticação.");
            const token = digite("Digite o código gerado pelo app: ");

            if (!authenticator.check(token, otpSecret)) {
                console.log("\nCódigo inválido! Configuração falhou.");
            } else {
                await client.query('UPDATE users SET otp_secret = $1 WHERE email = $2', [otpSecret, email]);
                console.log("\nAutenticação de dois fatores configurada!");
            }
        }

    } catch (err) {
        console.error('\nErro ao cadastrar:', err);
    } finally {
        await client.end();
    }
}

// Listar usuários
async function listarUsuarios() {
    const client = await criarConexao();
    try {
        const res = await client.query('SELECT id, nome, email, genero FROM users ORDER BY nome');

        if (res.rows.length === 0) {
            console.log("\nNenhum usuário cadastrado.");
            return;
        }

        console.log("\n===== LISTA DE USUÁRIOS =====");
        console.log("ID  Nome                Email                     Gênero");
        console.log("-------------------------------------------------------");
        res.rows.forEach(user => {
            console.log(
                `${user.id.toString().padEnd(4)}${user.nome.padEnd(20)}${user.email.padEnd(25)}${user.genero || 'Não identificado'}`
            );
        });

    } catch (err) {
        console.error('\nErro ao listar:', err);
    } finally {
        await client.end();
    }
}

// Editar usuário
async function editarUsuario() {
    console.log("\n======== EDITAR USUÁRIO ========");

    const usuario = await login();
    if (!usuario) return;

    const client = await criarConexao();
    try {
        console.log(`\nEditando perfil de ${usuario.nome}`);

        console.log("\nDeixe em branco para manter o valor atual");
        const novoNome = digite(`Nome [${usuario.nome}]: `) || usuario.nome;
        const novoEmail = digite(`Email [${usuario.email}]: `) || usuario.email;
        const novaSenha = digite("Nova senha (deixe em branco para não alterar): ");

        let hashSenha = usuario.senha;
        if (novaSenha) {
            hashSenha = await bcrypt.hash(novaSenha, 10);
        }

        // Determina gênero se nome mudou
        let genero = usuario.genero;
        let probGenero = usuario.prob_genero;

        if (novoNome !== usuario.nome) {
            const dadosGenero = await determinarGenero(novoNome);
            if (dadosGenero) {
                genero = dadosGenero.genero;
                probGenero = dadosGenero.probabilidade;
                console.log(`Gênero detectado: ${genero} (${Math.round(probGenero * 100)}% de precisão)`);
            } else {
                console.log("\nNão foi possível determinar o gênero para o novo nome.");
            }
        }

        // Atualiza usuário
        await client.query(
            'UPDATE users SET nome = $1, email = $2, senha = $3, genero = $4, prob_genero = $5 WHERE id = $6',
            [novoNome, novoEmail, hashSenha, genero, probGenero, usuario.id]
        );
        console.log("\nUsuário atualizado com sucesso!");
    } catch (err) {
        console.error('\nErro ao editar:', err);
    } finally {
        await client.end();
    }
}

// Excluir usuário
async function excluirUsuario() {
    console.log("\n======== EXCLUIR USUÁRIO ========");

    const usuario = await login();
    if (!usuario) return;

    const confirmacao = digite(`\nTem certeza que deseja excluir sua conta? (s/n): `).toLowerCase();
    if (confirmacao !== 's') {
        console.log("\nOperação cancelada.");
        return;
    }

    const client = await criarConexao();
    try {
        await client.query('DELETE FROM users WHERE id = $1', [usuario.id]);
        console.log("\nUsuário excluído com sucesso!");
    } catch (err) {
        console.error('\nErro ao excluir:', err);
    } finally {
        await client.end();
    }
}

// Estatísticas de gênero
async function estatisticasGenero() {
    const client = await criarConexao();
    try {
        const res = await client.query(`
            SELECT 
                CASE 
                    WHEN genero = 'male' THEN 'Masculino'
                    WHEN genero = 'female' THEN 'Feminino'
                    ELSE 'Não identificado'
                END as genero,
                COUNT(*) as total,
                ROUND(AVG(COALESCE(prob_genero, 0)) * 100) as precisao_media
            FROM users
            GROUP BY genero
            ORDER BY total DESC
        `);

        console.log("\n===== ESTATÍSTICAS DE GÊNERO =====");
        console.log("Gênero         | Total | Precisão Média");
        console.log("-------------------------------------");

        res.rows.forEach(row => {
            console.log(
                `${row.genero.padEnd(14)} | ${row.total.toString().padEnd(5)} | ${row.precisao_media || 0}%`
            );
        });
    } catch (err) {
        console.error('\nErro ao gerar estatísticas:', err);
    } finally {
        await client.end();
    }
}

// Função principal
async function main() {
    console.log("Bem-vindo ao Sistema de Gerenciamento de Usuários!");

    let sair = false;
    while (!sair) {
        const opcao = exibirMenu();

        switch (opcao) {
            case '1':
                await login();
                break;
            case '2':
                await cadastrarUsuario();
                break;
            case '3':
                await listarUsuarios();
                break;
            case '4':
                await editarUsuario();
                break;
            case '5':
                await excluirUsuario();
                break;
            case '6':
                await estatisticasGenero();
                break;
            case '7':
                sair = true;
                console.log("\nSaindo do sistema...");
                break;
            default:
                console.log("\nOpção inválida!");
                break;
        }
    }
}

main().catch(console.error);