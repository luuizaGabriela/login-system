const digite = require("prompt-sync")();
const { Client } = require("pg");
const bcrypt = require('bcrypt');

// Configurações do banco de dados
const dbConfig = {
    database: "Login_User",
    user: "admin",
    password: "admin",
    host: "localhost",
    port: 5432
};

// Cache para armazenar consultas de gênero
const generoCache = {};

// Função para determinar gênero usando a API
async function determinarGenero(nomeCompleto) {
    const primeiroNome = nomeCompleto.split(' ')[0].toLowerCase();
    
    // Verifica se já temos no cache
    if (generoCache[primeiroNome]) {
        return generoCache[primeiroNome];
    }
    
    try {
        const response = await fetch(`https://api.genderize.io?name=${primeiroNome}`);
        const data = await response.json();
        
        if (!data.gender || data.probability < 0.7) {
            return null;
        }
        
        // Armazena no cache
        generoCache[primeiroNome] = {
            genero: data.gender,
            probabilidade: data.probability
        };
        
        return generoCache[primeiroNome];
    } catch (err) {
        console.error('\nErro ao consultar gênero:', err);
        return null;
    }
}

// Função para criar saudação com base no gênero
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

// Função para criar nova conexão 
async function criarConexao() {
    const client = new Client(dbConfig);
    await client.connect();
    return client;
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

// Função para listar usuários 
async function listarUsuarios() {
    const client = await criarConexao();
    try {
        const res = await client.query('SELECT id, nome, email, genero FROM users ORDER BY nome');
        
        if (res.rows.length === 0) {
            console.log("\nNenhum usuário cadastrado ainda.");
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
        console.error('\nErro ao listar usuários:', err);
    } finally {
        await client.end();
    }
}

/// Função para editar usuário 
async function editarUsuario() {
    console.log("\n======== EDITAR USUÁRIO ========");
    
    const usuario = await login();
    if (!usuario) return;

    const client = await criarConexao();
    try {
        console.log(`\nEditando perfil de ${usuario.nome} (${usuario.email})`);
        
        console.log("\nDeixe em branco para manter o valor atual");
        const novoNome = digite(`Nome [${usuario.nome}]: `) || usuario.nome;
        const novoEmail = digite(`Email [${usuario.email}]: `) || usuario.email;
        const novaSenha = digite("Nova senha (deixe em branco para não alterar): ");

        let hashSenha = usuario.senha;
        if (novaSenha) {
            hashSenha = await bcrypt.hash(novaSenha, 10);
        }

        // Inicializa com os valores atuais
        let genero = usuario.genero;
        let probGenero = usuario.prob_genero;
        
        // Se o nome foi alterado, atualiza o gênero
        if (novoNome !== usuario.nome) {
            console.log("\nNome alterado. Atualizando gênero...");
            const dadosGenero = await determinarGenero(novoNome);
            
            if (dadosGenero) {
                genero = dadosGenero.genero;
                probGenero = dadosGenero.probabilidade;
                console.log(`Novo gênero detectado: ${genero} (${Math.round(probGenero * 100)}% de precisão)`);
            } else {
                genero = null;
                probGenero = null;
                console.log("Não foi possível determinar um gênero para o novo nome");
            }
        }

        await client.query(
            'UPDATE users SET nome = $1, email = $2, senha = $3, genero = $4, prob_genero = $5 WHERE id = $6',
            [novoNome, novoEmail, hashSenha, genero, probGenero, usuario.id]
        );
        
        console.log("\nUsuário atualizado com sucesso!");
    } catch (err) {
        console.error('\nErro ao editar usuário:', err);
    } finally {
        await client.end();
    }
}
// Função para excluir usuário
async function excluirUsuario() {
    console.log("\n======== EXCLUIR USUÁRIO ========");
    
    // Primeiro faz o login
    const usuario = await login();
    if (!usuario) return;

    const confirmacao = digite(`\nTem certeza que deseja excluir permanentemente sua conta? (s/n): `).toLowerCase();
    if (confirmacao !== 's') {
        console.log("\nOperação cancelada.");
        return;
    }

    const client = await criarConexao();
    try {
        await client.query('DELETE FROM users WHERE id = $1', [usuario.id]);
        console.log("\nUsuário excluído com sucesso!");
    } catch (err) {
        console.error('\nErro ao excluir usuário:', err);
    } finally {
        await client.end();
    }
}

// Função de login
async function login() {
    console.log("\n======== LOGIN ========");
    const client = await criarConexao();
    
    try {
        const email = digite("Digite seu email: ");
        const senha = digite("Digite sua senha: ");

        if (!email || !senha) {
            console.log("\nEmail e senha são obrigatórios!");
            return false;
        }

        const res = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (res.rows.length > 0) {
            const user = res.rows[0];
            const senhaValida = await bcrypt.compare(senha, user.senha);
            
            if (senhaValida) {
                const saudacao = criarSaudacao(user.nome, user.genero);
                console.log(`\n${saudacao} Login bem-sucedido!`);
                return user;
            } else {
                console.log("\nSenha incorreta.");
                return false;
            }
        } else {
            console.log("\nUsuário não encontrado.");
            return false;
        }
    } catch (err) {
        console.error('\nErro ao acessar o banco de dados:', err);
        return false;
    } finally {
        await client.end();
    }
}

// Função de cadastro de usuário
async function cadastrarUsuario() {
    console.log("\n======== CADASTRO DE USUÁRIO ========");
    const client = await criarConexao();
    
    try {
        const nome = digite("Digite seu nome completo: ");
        const email = digite("Digite seu email: ");
        const senha = digite("Digite sua senha: ");
        const confirmarSenha = digite("Confirme sua senha: ");

        if (!nome || !email || !senha) {
            console.log("\nTodos os campos são obrigatórios!");
            return;
        }

        if (senha !== confirmarSenha) {
            console.log("\nAs senhas não coincidem!");
            return;
        }

        // Verifica se o email já existe
        const res = await client.query('SELECT * FROM users WHERE email = $1', [email]);
        if (res.rows.length > 0) {
            console.log("\nEste email já está cadastrado!");
            return;
        }

        // Consulta o gênero
        const dadosGenero = await determinarGenero(nome);
        const hashSenha = await bcrypt.hash(senha, 10);
        
        await client.query(
            'INSERT INTO users (nome, email, senha, genero, prob_genero) VALUES ($1, $2, $3, $4, $5)', 
            [nome, email, hashSenha, dadosGenero?.genero || null, dadosGenero?.probabilidade || null]
        );
        
        const saudacao = criarSaudacao(nome, dadosGenero?.genero);
        console.log(`\n${saudacao} Cadastro realizado com sucesso!`);
    } catch (err) {
        console.error('\nErro ao cadastrar usuário:', err);
    } finally {
        await client.end();
    }
}

// Função para estatísticas de gênero 
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
    console.log("Bem-vindo ao Sistema de Gerenciamento de Usuários com Gender Detection!");

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
                console.log("\nOpção inválida! Tente novamente.");
        }
    }
}

main().catch(console.error);