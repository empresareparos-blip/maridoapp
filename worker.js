import { now, dig, def, makeBot } from './bot.js';

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...h } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
}
const weak = p => !p || p.length < 8 || !/[a-z]/i.test(p) || !/\d/.test(p);

// ---------- acesso ao D1 ----------
const get = async (db, kind, id) => { const r = await db.prepare('SELECT json FROM docs WHERE kind=?1 AND id=?2').bind(kind, id).first(); return r ? JSON.parse(r.json) : null; };
const all = async (db, kind) => (await db.prepare('SELECT json FROM docs WHERE kind=?1').bind(kind).all()).results.map(r => JSON.parse(r.json));
const put = (db, kind, id, o, k = null) => db.prepare('INSERT INTO docs(kind,id,k,json,updated) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(kind,id) DO UPDATE SET k=?3,json=?4,updated=?5').bind(kind, id, k, JSON.stringify(o), now());

async function seed(db) {
  if (await get(db, 'single', 'cfg')) return;
  const D = def();
  await db.batch([
    put(db, 'single', 'cfg', D.cfg), put(db, 'single', 'site', D.site), put(db, 'single', 'meta', { seq: 0 }),
    ...D.services.map(s => put(db, 'service', String(s.id), s)),
  ]);
}

// ---------- sessão ----------
const cookie = (r, n) => (r.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === n)?.[1];
async function session(req, env) {
  const t = cookie(req, 'mac_s'); if (!t) return null;
  const s = await env.DB.prepare('SELECT user_id,exp FROM sessions WHERE th=?1').bind(await sha(t)).first();
  if (!s || s.exp < Date.now()) return null;
  const u = await get(env.DB, 'user', s.user_id);
  return u && u.on ? u : null;
}
async function open(env, u) {
  const t = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions(th,user_id,exp) VALUES(?1,?2,?3)').bind(await sha(t), u.id, Date.now() + 12 * 36e5).run();
  return J({ ok: true, id: u.id, perm: u.perm }, 200, { 'set-cookie': `mac_s=${t}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200` });
}
const safeUser = u => ({ id: u.id, login: u.login, on: u.on, perm: u.perm });

// ---------- núcleo compartilhado (site, WhatsApp e formulário usam a mesma lógica) ----------
const bump = async (db, f) => (await db.prepare(`UPDATE docs SET json=json_set(json,'$.${f}',coalesce(json_extract(json,'$.${f}'),0)+1) WHERE kind='single' AND id='meta' RETURNING json_extract(json,'$.${f}') AS s`).first()).s;
const addMsg = (cv, f, x) => { cv.msgs.push({ f, x, t: now() }); cv.last = now(); };
const newConv = (cl, ch, st) => ({ id: 'C' + hex(crypto.getRandomValues(new Uint8Array(10))), cid: cl.id, ch, status: st || 'Novo', human: false, owner: '', msgs: [], at: now(), last: now() });
async function mkClient(db, name, phone, ch) {
  const d = dig(phone);
  if (d) { const r = await db.prepare("SELECT json FROM docs WHERE kind='client' AND k=?1").bind(d).first(); if (r) { const c = JSON.parse(r.json); if (name && c.name === 'Visitante') c.name = name; return c; } }
  return { id: 'MA-' + String(await bump(db, 'seq')).padStart(5, '0'), name: name || 'Visitante', phone: d, email: '', ch, at: now(), notes: '', log: [] };
}
async function runIncoming(db, cl, cv, text) {
  const D = { cfg: await get(db, 'single', 'cfg'), services: await all(db, 'service'), reqs: [] };
  const n = (await db.prepare("SELECT COUNT(*) n FROM docs WHERE kind='req'").first()).n;
  D.reqs = new Array(n).fill(null);
  addMsg(cv, 'c', text); cv.unread = true;
  const r = makeBot(D)(cv, text);
  if (r) addMsg(cv, 'bot', r);
  if (cv.status === 'Arquivado' || cv.status === 'Concluído') cv.status = 'Novo';
  const st = [put(db, 'client', cl.id, cl, cl.phone || null), put(db, 'conv', cv.id, cv, cl.id)];
  for (const q of D.reqs.slice(n)) { q.id = 'S-' + String(await bump(db, 'rseq')).padStart(4, '0'); st.push(put(db, 'req', q.id, q)); }
  await db.batch(st);
  return r;
}
const cmsg = s => 'Serviço selecionado: ' + s.name + '.\n' + (s.intro || 'Olá! Vi que você tem interesse em ' + s.name.toLowerCase() + '. Pode me contar o que precisa ser feito?');

// ---------- WhatsApp (API oficial da Meta) ----------
async function waSend(env, to, text) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, {
      method: 'POST', headers: { authorization: 'Bearer ' + env.WA_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    return r.ok;
  } catch (e) { return false; }
}
async function waIncoming(env, phone, name, text) {
  const db = env.DB, cl = await mkClient(db, name, phone, 'WhatsApp');
  const rows = (await db.prepare("SELECT json FROM docs WHERE kind='conv' AND k=?1").bind(cl.id).all()).results.map(r => JSON.parse(r.json));
  const cv = rows.find(c => c.ch === 'WhatsApp' && c.status !== 'Arquivado') || newConv(cl, 'WhatsApp');
  const reply = await runIncoming(db, cl, cv, text);
  if (reply) await waSend(env, cl.phone, reply);
}
async function waWebhook(req, env, url) {
  if (req.method === 'GET') {
    const ok = env.WA_VERIFY_TOKEN && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env.WA_VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('forbidden', { status: 403 });
  }
  const raw = await req.text();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WA_APP_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  if (!env.WA_APP_SECRET || sig !== req.headers.get('x-hub-signature-256')) return new Response('bad signature', { status: 401 });
  await seed(env.DB);
  for (const e of JSON.parse(raw).entry || []) for (const c of e.changes || []) {
    const v = c.value || {};
    for (const m of v.messages || []) {
      const name = (v.contacts || []).find(x => x.wa_id === m.from)?.profile?.name;
      await waIncoming(env, m.from, name, m.type === 'text' ? String(m.text.body).slice(0, 2000) : '[mensagem não textual recebida: abra o WhatsApp para ver]');
    }
  }
  return new Response('ok');
}

// ---------- limite de uso por IP (anti-spam) ----------
async function limited(db, key, max, ms) {
  const r = await db.prepare('SELECT n,until FROM attempts WHERE ip=?1').bind(key).first(), t = Date.now();
  if (!r || r.until < t) { await db.prepare('INSERT INTO attempts(ip,n,until) VALUES(?1,1,?2) ON CONFLICT(ip) DO UPDATE SET n=1,until=?2').bind(key, t + ms).run(); return false; }
  await db.prepare('UPDATE attempts SET n=n+1 WHERE ip=?1').bind(key).run();
  return r.n >= max;
}

// ---------- visitante (site público) ----------
const str = (x, n) => String(x ?? '').trim().slice(0, n);
async function visitor(p, req, env, url) {
  const db = env.DB, ip = req.headers.get('cf-connecting-ip') || 'x';
  if (req.method === 'POST' && await limited(db, 'v:' + ip, 60, 6e5)) return J({ error: 'Muitas solicitações. Aguarde alguns minutos.' }, 429);
  const view = async (cv, cl) => J({ cv: { ...cv, rated: !!(await db.prepare("SELECT 1 x FROM docs WHERE kind='rev' AND k=?1").bind(cv.id).first()) }, cl: { id: cl.id, name: cl.name, phone: cl.phone } });
  const own = async id => { const cv = id ? await get(db, 'conv', String(id)) : null; return cv && cv.ch !== 'WhatsApp' ? [cv, await get(db, 'client', cv.cid)] : [null, null]; };

  if (p === '/api/v/conv') { const [cv, cl] = await own(url.searchParams.get('id')); return cv ? view(cv, cl) : J({ cv: null }); }
  const b = await req.json().catch(() => ({}));

  if (p === '/api/v/msg') {
    const text = str(b.text, 1000); if (!text) return J({ error: 'Escreva uma mensagem.' }, 400);
    let [cv, cl] = await own(b.cvid);
    if (!cv) {
      cl = await mkClient(db, 'Visitante', '', 'Chat do site'); cv = newConv(cl, 'Chat do site');
      const s = b.sid && (await get(db, 'service', String(b.sid)));
      if (s) { cv.svc = s.name; cv.sid = s.id; cv.fl = { sid: s.id, i: 0, ans: [] }; addMsg(cv, 'bot', cmsg(s)); }
    }
    await runIncoming(db, cl, cv, text); return view(cv, cl);
  }
  if (p === '/api/v/svc') {
    const [cv, cl] = await own(b.cvid), s = await get(db, 'service', String(b.sid)); if (!cv || !s) return J({ error: 'Não encontrado.' }, 404);
    cv.svc = s.name; cv.sid = s.id;
    if (cv.human) addMsg(cv, 'bot', 'Serviço selecionado: ' + s.name + '.'); else { cv.fl = { sid: s.id, i: 0, ans: [] }; addMsg(cv, 'bot', cmsg(s)); }
    cv.unread = true; await put(db, 'conv', cv.id, cv, cl.id).run(); return view(cv, cl);
  }
  if (p === '/api/v/contact') {
    const [cv, cl] = await own(b.cvid); if (!cv) return J({ error: 'Não encontrado.' }, 404);
    if (!b.skip) {
      const n = str(b.name, 80), ph = dig(b.phone);
      if (!n && !ph) return J({ error: 'Informe nome ou telefone.' }, 400);
      if (n && n.length < 2) return J({ error: 'Nome muito curto.' }, 400);
      if (ph && (ph.length < 10 || ph.length > 13)) return J({ error: 'Telefone inválido. Use DDD + número.' }, 400);
      if (n) cl.name = n;
      if (ph) { const o = await db.prepare("SELECT id FROM docs WHERE kind='client' AND k=?1 AND id<>?2").bind(ph, cl.id).first(); if (o) cv.phoneNote = ph; else cl.phone = ph; }
      addMsg(cv, 'bot', 'Obrigado! Contato recebido. Nossa equipe usará essas informações para retornar.');
    }
    cv.cdone = true;
    await db.batch([put(db, 'client', cl.id, cl, cl.phone || null), put(db, 'conv', cv.id, cv, cl.id)]); return view(cv, cl);
  }
  if (p === '/api/v/quote') {
    const n = str(b.name, 80), ph = dig(b.phone), s = await get(db, 'service', String(b.sid)), d = str(b.desc, 800), r = str(b.region, 80), x = str(b.extra, 500);
    if (n.length < 2 || ph.length < 10 || ph.length > 13 || !s || d.length < 5 || r.length < 2) return J({ error: 'Preencha todos os campos obrigatórios corretamente.' }, 400);
    const cl = await mkClient(db, n, ph, 'Formulário'), cv = newConv(cl, 'Formulário', 'Orçamento solicitado');
    cv.svc = s.name; cv.sid = s.id; cv.unread = true;
    addMsg(cv, 'c', 'Solicitação de orçamento\nServiço: ' + s.name + '\nRegião: ' + r + '\n' + d + (x ? '\nInformações adicionais: ' + x : ''));
    addMsg(cv, 'bot', (await get(db, 'single', 'cfg')).msgs.got);
    const id = 'S-' + String(await bump(db, 'rseq')).padStart(4, '0');
    await db.batch([put(db, 'client', cl.id, cl, cl.phone), put(db, 'conv', cv.id, cv, cl.id), put(db, 'req', id, { id, cid: cl.id, cvid: cv.id, svc: s.name, ans: [d, r, x], ch: 'Formulário', at: now() })]);
    return J({ ok: true, id });
  }
  if (p === '/api/v/rate') {
    const [cv, cl] = await own(b.cvid); const st = +b.stars;
    if (!cv || cv.status !== 'Concluído') return J({ error: 'Só é possível avaliar atendimentos concluídos.' }, 400);
    if (await db.prepare("SELECT 1 x FROM docs WHERE kind='rev' AND k=?1").bind(cv.id).first()) return J({ error: 'Este atendimento já foi avaliado.' }, 409);
    if (!(st >= 1 && st <= 5)) return J({ error: 'Escolha uma nota de 1 a 5 estrelas.' }, 400);
    const id = 'R-' + String(await bump(db, 'vseq')).padStart(4, '0');
    await put(db, 'rev', id, { id, cvid: cv.id, cid: cl.id, svc: cv.svc || '', stars: st, liked: str(b.liked, 300), improve: str(b.improve, 300), comment: str(b.comment, 800), ok: !!b.ok, mod: 'pend', at: now() }, cv.id).run();
    return J({ ok: true });
  }
  if (p === '/api/v/review') {
    const st = +b.stars, svc = str(b.svc, 80); if (!svc || !(st >= 1 && st <= 5)) return J({ error: 'Informe o serviço e a nota.' }, 400);
    const id = 'R-' + String(await bump(db, 'vseq')).padStart(4, '0');
    await put(db, 'rev', id, { id, cvid: '', cid: 'EXTERNO', name: str(b.name, 60) || 'Cliente', source: 'Site / avaliação externa', svc, stars: st, liked: '', improve: '', comment: str(b.comment, 800), ok: !!b.ok, mod: 'pend', at: now(), external: true }).run();
    return J({ ok: true });
  }
  if (p === '/api/v/like') {
    const r = await get(db, 'rev', String(b.id)); if (!r || r.mod !== 'pub' || !r.ok) return J({ error: 'Não encontrado.' }, 404);
    r.likes = (+r.likes || 0) + 1; await put(db, 'rev', r.id, r, r.cvid || null).run(); return J({ ok: true, likes: r.likes });
  }
  return J({ error: 'Rota não encontrada.' }, 404);
}

// ---------- CORS (só para origens que você listar em ALLOWED_ORIGINS) ----------
function cors(req, env, res) {
  const o = req.headers.get('origin');
  if (!o || !(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).includes(o)) return res;
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', o); h.set('access-control-allow-credentials', 'true'); h.set('vary', 'Origin');
  h.set('access-control-allow-headers', 'content-type'); h.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(req, env, new Response(null, { status: 204 }));
    return cors(req, env, await route(req, env));
  },
};

async function route(req, env) {
  const url = new URL(req.url), p = url.pathname, db = env.DB;
  try {
    if (p === '/api/whatsapp') return await waWebhook(req, env, url);
    // proteção CSRF: POST de outra origem não é aceito (exceto origens liberadas)
    const o = req.headers.get('origin');
    if (req.method === 'POST' && o && o !== url.origin && !(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).includes(o)) return J({ error: 'Origem não permitida.' }, 403);
    await seed(db);

    if (p === '/api/public' && req.method === 'GET') {
      const site = await get(db, 'single', 'site');
      const services = (await all(db, 'service')).filter(s => s.on);
      const reviews = (await all(db, 'rev')).filter(r => r.mod === 'pub' && r.ok).map(({ id, name, svc, stars, comment, at, likes }) => ({ id, name, svc, stars, comment, at, likes, mod: 'pub', ok: true }));
      const cfg = await get(db, 'single', 'cfg');
      return J({ site: { pub: site.pub }, services, reviews, setup: !(await all(db, 'user')).length, msgs: { got: cfg.msgs.got } });
    }
    if (p.startsWith('/api/v/')) return await visitor(p, req, env, url);

    if (p === '/api/setup' && req.method === 'POST') {
      if ((await all(db, 'user')).length) return J({ error: 'Já configurado.' }, 409);
      const { login, password } = await req.json();
      if (!login || login.length < 3 || weak(password)) return J({ error: 'Usuário com 3+ caracteres; senha com 8+ caracteres, letras e números.' }, 400);
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const u = { id: 'ADMIN-01', login: login.toLowerCase(), salt, hash: await pbkdf2(password, salt), on: true, perm: { editor: true } };
      await put(db, 'user', u.id, u, u.login).run();
      return open(env, u);
    }
    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.headers.get('cf-connecting-ip') || 'x';
      const a = await db.prepare('SELECT n,until FROM attempts WHERE ip=?1').bind('l:' + ip).first();
      if (a && a.until > Date.now() && a.n >= 5) return J({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, 429);
      const { login, password } = await req.json();
      const u = (await all(db, 'user')).find(x => x.login === String(login || '').toLowerCase() && x.on);
      if (u && (await pbkdf2(String(password || ''), u.salt)) === u.hash) { await db.prepare('DELETE FROM attempts WHERE ip=?1').bind('l:' + ip).run(); return open(env, u); }
      const n = (a && a.until > Date.now() ? a.n : 0) + 1;
      await db.prepare('INSERT INTO attempts(ip,n,until) VALUES(?1,?2,?3) ON CONFLICT(ip) DO UPDATE SET n=?2,until=?3').bind('l:' + ip, n, Date.now() + 3e5).run();
      return J({ error: 'Usuário ou senha incorretos.' }, 401);
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const t = cookie(req, 'mac_s'); if (t) await db.prepare('DELETE FROM sessions WHERE th=?1').bind(await sha(t)).run();
      return J({ ok: true }, 200, { 'set-cookie': 'mac_s=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
    }

    // --- tudo abaixo exige login ---
    const u = await session(req, env);
    if (!u) return J({ error: 'Não autenticado.' }, 401);
    if (p === '/api/me') return J({ id: u.id, perm: u.perm });

    if (p === '/api/admin/state' && req.method === 'GET') {
      const [cfg, site, meta, log] = await Promise.all([get(db, 'single', 'cfg'), get(db, 'single', 'site'), get(db, 'single', 'meta'), get(db, 'single', 'log')]);
      const [clients, convs, rev, reqs, services, users] = await Promise.all(['client', 'conv', 'rev', 'req', 'service', 'user'].map(k => all(db, k)));
      return J({ seq: meta.seq, cfg, site, log: log || [], clients, convs, rev, reqs, services, users: users.map(safeUser), waOn: !!(env.WA_TOKEN && env.WA_PHONE_ID) });
    }
    if (p === '/api/admin/sync' && req.method === 'POST') {
      const { upserts = [], deletes = [] } = await req.json();
      const okKind = k => ['client', 'conv', 'rev', 'req', 'service', 'single'].includes(k);
      const st = [], wa = [];
      for (const x of upserts) {
        if (!okKind(x.kind) || (x.kind === 'single' && !['cfg', 'site', 'log'].includes(x.id))) return J({ error: 'Tipo inválido.' }, 400);
        if ((x.kind === 'service' || (x.kind === 'single' && x.id === 'site')) && !(u.id === 'ADMIN-01' || u.perm.editor)) return J({ error: 'Sem permissão para editar o site.' }, 403);
        let o = x.json, k = null;
        if (x.kind === 'client') k = dig(o.phone) || null;
        if (x.kind === 'rev') k = o.cvid || null;
        if (x.kind === 'conv') {
          k = o.cid;
          const old = await get(db, 'conv', String(x.id));
          if (old) { // mescla mensagens que chegaram enquanto o painel estava aberto
            const key = m => m.t + '|' + m.f + '|' + m.x, have = new Set(o.msgs.map(key));
            o.msgs = [...o.msgs, ...old.msgs.filter(m => !have.has(key(m)))].sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
          }
          const oldKeys = new Set((old ? old.msgs : []).map(key2)), cl = o.ch === 'WhatsApp' ? await get(db, 'client', o.cid) : null;
          if (cl && cl.phone) for (const m of o.msgs) if (m.f === 'adm' && !oldKeys.has(key2(m))) wa.push({ to: cl.phone, text: m.x });
        }
        st.push(put(db, x.kind, String(x.id), o, k));
      }
      for (const x of deletes) if (okKind(x.kind) && x.kind !== 'single') st.push(db.prepare('DELETE FROM docs WHERE kind=?1 AND id=?2').bind(x.kind, String(x.id)));
      if (st.length) await db.batch(st);
      let failed = 0; for (const m of wa) if (!(await waSend(env, m.to, m.text))) failed++;
      return J({ ok: true, n: st.length, wa: wa.length, waFailed: failed });
    }
    if (p === '/api/admin/user' && req.method === 'POST') { // ADMIN-02
      if (u.id !== 'ADMIN-01') return J({ error: 'Só o ADMIN-01.' }, 403);
      const b = await req.json();
      if (b.op === 'create') {
        const login = String(b.login || '').trim().toLowerCase();
        if (login.length < 3 || (await all(db, 'user')).some(x => x.login === login) || weak(b.password)) return J({ error: 'Usuário inválido, já existe ou senha fraca.' }, 400);
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        await put(db, 'user', 'ADMIN-02', { id: 'ADMIN-02', login, salt, hash: await pbkdf2(b.password, salt), on: true, perm: { editor: true } }, login).run();
      } else {
        const t = await get(db, 'user', 'ADMIN-02'); if (!t) return J({ error: 'Não existe.' }, 404);
        if (b.op === 'on') t.on = !t.on; else t.perm.editor = !t.perm.editor;
        await put(db, 'user', 'ADMIN-02', t, t.login).run();
        if (!t.on) await db.prepare('DELETE FROM sessions WHERE user_id=?1').bind('ADMIN-02').run();
      }
      return J({ ok: true });
    }
    return J({ error: 'Rota não encontrada.' }, 404);
  } catch (e) {
    return J({ error: 'Erro interno.' }, 500);
  }
}
const key2 = m => m.t + '|' + m.x;
