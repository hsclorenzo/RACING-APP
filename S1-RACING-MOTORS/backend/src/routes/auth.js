import express from 'express'
import { pool } from '../db/pool.js'
import { executarComoSistema } from '../lib/contextoRls.js'
import { gerarHash, conferirSenha, assinarToken } from '../lib/auth.js'
import { exigirAutenticacao, exigirPapel, oficinaPadrao } from '../middleware/autenticacao.js'

export const rotasAuth = express.Router()

const normalizarEmail = (e) => String(e || '').trim().toLowerCase()

// ---------------------------------------------------------------------
// POST /api/auth/login
// Roda como sistema porque o login precisa ACHAR o usuario antes de
// existir contexto de RLS — e o unico lugar do backend que le `usuarios`
// com bypass. Nenhum handler autenticado faz isso.
// ---------------------------------------------------------------------
rotasAuth.post('/login', async (req, res, next) => {
  try {
    const email = normalizarEmail(req.body.email)
    const senha = String(req.body.senha || '')
    if (!email || !senha) return res.status(400).json({ erro: 'Informe email e senha' })

    await executarComoSistema(async () => {
      const r = await pool.query(
        `select id, email, nome, senha_hash, ativo from usuarios where email = $1`,
        [email]
      )
      const u = r.rows[0]
      // Mesma mensagem para email inexistente e senha errada: dizer qual
      // dos dois errou entrega a lista de quem tem conta.
      const generico = { erro: 'Email ou senha incorretos' }
      if (!u || !u.ativo) return res.status(401).json(generico)
      if (!(await conferirSenha(senha, u.senha_hash))) return res.status(401).json(generico)

      const m = await pool.query(
        `select m.tenant_id, m.papel, t.nome as oficina
           from memberships m join tenants t on t.id = m.tenant_id
          where m.usuario_id = $1 and m.ativo = true and t.ativo = true`,
        [u.id]
      )
      if (m.rows.length === 0) {
        return res.status(403).json({ erro: 'Sua conta ainda nao foi ligada a uma oficina.' })
      }

      await pool.query(`update usuarios set ultimo_login = now() where id = $1`, [u.id])

      res.json({
        token: assinarToken({ id: u.id, nome: u.nome, email: u.email }),
        usuario: { id: u.id, nome: u.nome, email: u.email },
        oficinas: m.rows,
      })
    })
  } catch (erro) {
    next(erro)
  }
})

// GET /api/auth/eu — quem sou e onde entro. O frontend chama ao abrir.
rotasAuth.get('/eu', exigirAutenticacao, (req, res) => {
  res.json({ usuario: req.usuario, oficinas: req.tenants })
})

// ---------------------------------------------------------------------
// POST /api/auth/instalar — cria a oficina e o primeiro admin.
//
// So roda com a ADMIN_KEY e SO enquanto nao existe nenhuma oficina. As
// duas travas juntas: a chave impede estranho, e a checagem de banco
// vazio impede que a rota vire uma porta dos fundos permanente mesmo que
// a chave vaze algum dia.
// ---------------------------------------------------------------------
rotasAuth.post('/instalar', async (req, res, next) => {
  try {
    const chave = req.headers['x-admin-key'] || req.query.chave
    if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) {
      return res.status(403).json({ erro: 'Acesso restrito — ADMIN_KEY invalida' })
    }

    const nomeOficina = String(req.body.oficina || 'Racing Motors').trim()
    const nome = String(req.body.nome || '').trim()
    const email = normalizarEmail(req.body.email)
    const senha = String(req.body.senha || '')
    if (!nome || !email || senha.length < 8) {
      return res.status(400).json({ erro: 'Informe nome, email e uma senha de 8+ caracteres' })
    }

    await executarComoSistema(async () => {
      const jaTem = await pool.query(`select 1 from tenants limit 1`)
      if (jaTem.rows.length > 0) {
        return res.status(409).json({
          erro: 'A oficina ja foi instalada. Use o login, ou crie usuarios pela tela de Equipe.',
        })
      }

      const t = await pool.query(`insert into tenants (nome) values ($1) returning id, nome`, [
        nomeOficina,
      ])
      const u = await pool.query(
        `insert into usuarios (email, senha_hash, nome) values ($1,$2,$3) returning id`,
        [email, await gerarHash(senha), nome]
      )
      await pool.query(
        `insert into memberships (tenant_id, usuario_id, papel) values ($1,$2,'admin')`,
        [t.rows[0].id, u.rows[0].id]
      )
      // Devolve o token junto: quem acabou de instalar ja entra, sem
      // passar pela tela de login uma unica vez.
      res.json({
        ok: true,
        oficina: t.rows[0],
        token: assinarToken({ id: u.rows[0].id, nome, email }),
        usuario: { id: u.rows[0].id, nome, email },
        oficinas: [{ tenant_id: t.rows[0].id, papel: 'admin', oficina: t.rows[0].nome }],
        mensagem: 'Pronto. Voce ja esta dentro.',
      })
    })
  } catch (erro) {
    next(erro)
  }
})

// ---------------------------------------------------------------------
// EQUIPE — so admin mexe.
// ---------------------------------------------------------------------
rotasAuth.get('/equipe', exigirAutenticacao, async (req, res, next) => {
  try {
    const tenant = oficinaPadrao(req)
    exigirPapel(req, tenant, ['admin'])
    const r = await pool.query(
      `select u.id, u.nome, u.email, u.telefone, u.ativo, u.ultimo_login, m.papel, m.ativo as acesso_ativo
         from memberships m join usuarios u on u.id = m.usuario_id
        where m.tenant_id = $1 order by u.nome`,
      [tenant]
    )
    res.json(r.rows)
  } catch (erro) {
    next(erro)
  }
})

rotasAuth.post('/equipe', exigirAutenticacao, async (req, res, next) => {
  try {
    const tenant = oficinaPadrao(req)
    exigirPapel(req, tenant, ['admin'])
    const nome = String(req.body.nome || '').trim()
    const email = normalizarEmail(req.body.email)
    const senha = String(req.body.senha || '')
    const papel = String(req.body.papel || 'balcao')
    if (!nome || !email || senha.length < 8) {
      return res.status(400).json({ erro: 'Informe nome, email e uma senha de 8+ caracteres' })
    }
    if (!['admin', 'balcao', 'mecanico'].includes(papel)) {
      return res.status(400).json({ erro: 'Papel invalido' })
    }

    // `usuarios` e a unica tabela GLOBAL do sistema (nao tem tenant_id —
    // um email e um email). A policy dela deixa voce ver a si mesmo e
    // quem divide oficina com voce; um usuario que ainda nao existe nao
    // atende nenhuma das duas, entao criar por RLS seria impossivel.
    //
    // Por isso este trecho — e SO este trecho — roda como sistema. A
    // autorizacao ja aconteceu no exigirPapel(admin) acima, e o vinculo
    // com a oficina (o membership) e criado logo abaixo JA SOB RLS, que
    // e quem de fato prova que o admin so pode ligar gente a propria
    // oficina.
    const hash = await gerarHash(senha)
    const u = await executarComoSistema(async () => {
      await pool.query(
        `insert into usuarios (email, senha_hash, nome, telefone) values ($1,$2,$3,$4)
           on conflict (email) do nothing`,
        [email, hash, nome, req.body.telefone || null]
      )
      return pool.query(`select id from usuarios where email = $1`, [email])
    })
    if (!u.rows[0]) return res.status(500).json({ erro: 'Nao foi possivel criar o usuario' })

    await pool.query(
      `insert into memberships (tenant_id, usuario_id, papel) values ($1,$2,$3)
         on conflict (tenant_id, usuario_id) do update set papel = excluded.papel, ativo = true`,
      [tenant, u.rows[0].id, papel]
    )
    res.json({ ok: true, id: u.rows[0].id })
  } catch (erro) {
    next(erro)
  }
})

rotasAuth.patch('/equipe/:id', exigirAutenticacao, async (req, res, next) => {
  try {
    const tenant = oficinaPadrao(req)
    exigirPapel(req, tenant, ['admin'])
    if (req.params.id === req.usuario.id && req.body.ativo === false) {
      return res.status(400).json({ erro: 'Voce nao pode desativar o proprio acesso.' })
    }
    const campos = []
    const valores = [tenant, req.params.id]
    if (req.body.papel) {
      if (!['admin', 'balcao', 'mecanico'].includes(req.body.papel)) {
        return res.status(400).json({ erro: 'Papel invalido' })
      }
      valores.push(req.body.papel)
      campos.push(`papel = $${valores.length}`)
    }
    if (typeof req.body.ativo === 'boolean') {
      valores.push(req.body.ativo)
      campos.push(`ativo = $${valores.length}`)
    }
    if (campos.length === 0) return res.status(400).json({ erro: 'Nada para alterar' })

    await pool.query(
      `update memberships set ${campos.join(', ')}, atualizado_em = now()
        where tenant_id = $1 and usuario_id = $2`,
      valores
    )
    res.json({ ok: true })
  } catch (erro) {
    next(erro)
  }
})

// Troca da propria senha.
rotasAuth.post('/senha', exigirAutenticacao, async (req, res, next) => {
  try {
    const nova = String(req.body.nova || '')
    if (nova.length < 8) return res.status(400).json({ erro: 'A senha nova precisa de 8+ caracteres' })
    const r = await pool.query(`select senha_hash from usuarios where id = $1`, [req.usuario.id])
    if (!(await conferirSenha(String(req.body.atual || ''), r.rows[0].senha_hash))) {
      return res.status(400).json({ erro: 'Senha atual incorreta' })
    }
    await pool.query(`update usuarios set senha_hash = $2, atualizado_em = now() where id = $1`, [
      req.usuario.id,
      await gerarHash(nova),
    ])
    res.json({ ok: true })
  } catch (erro) {
    next(erro)
  }
})
