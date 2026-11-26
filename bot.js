// Gerado a partir do index.html original (mesma lógica do bot).
const now=()=>new Date().toISOString();
const dig=s=>String(s||'').replace(/\D/g,'');
const RUDE=/(idiota|imbecil|babaca|merda|porra|caralho|puta|burro|lixo|otário|vai se f)/;
const DQ2='Onde o serviço será realizado? (bairro ou região)',DQ3='Quer acrescentar algum detalhe? Se necessário, nossa equipe poderá pedir fotos para entender melhor o serviço.';
const dMsgs={menu:"Olá! Seja bem-vindo(a) ao Marido de Aluguel.\n\nSerá um prazer ajudar você!\n\nPara começarmos, escolha uma das opções:\n\n1. Conhecer nossos serviços.\n2. Solicitar um orçamento.\n3. Consultar atendimento.\n4. Falar com um atendente.",
services:"Claro! Podemos ajudar você com isso.\n\nConte um pouco sobre o serviço que precisa. Se possível, informe o que deve ser feito e onde será realizado.",
quote:"Perfeito! Vamos registrar sua solicitação.\n\nPor favor, informe:\n\n- Seu nome.\n- Qual serviço precisa.\n- Bairro ou região.\n- Uma breve descrição do que precisa ser realizado.\n\nSe necessário, nossa equipe poderá solicitar fotos para entender melhor o serviço.",
hours:"Nosso atendimento humano funciona nos horários configurados pela administração.\n\nSua mensagem já foi recebida e ficará registrada. Assim que possível, nossa equipe dará continuidade.",
human:"Claro! Vou encaminhar sua conversa para um atendente.\n\nPor favor, aguarde um instante.",
rude1:"Entendemos que você possa estar insatisfeito(a). Estamos aqui para ajudar da melhor maneira possível.\n\nVamos manter a conversa respeitosa para que possamos entender o que aconteceu e buscar uma solução.",
rude2:"Queremos ajudar você, mas precisamos manter uma comunicação respeitosa. Se preferir, posso encaminhar sua conversa para um atendente.",
unk:"Desculpe, não consegui entender sua solicitação.\n\nVocê poderia explicar um pouco melhor o que precisa?",
unk2:"Para não passar uma informação incorreta, posso encaminhar sua dúvida para nossa equipe. Digite 4 para falar com um atendente.",
got:"Recebemos sua mensagem. Nossa equipe dará continuidade e retornará assim que possível.",
bye:"Obrigado por entrar em contato com o Marido de Aluguel!\n\nEstamos à disposição sempre que precisar."};
const dSite=()=>({name:"Marido de Aluguel",slogan:"Soluções para sua casa, com qualidade e confiança!",intro:"Serviços e reparos em geral em Campinas e região. Consulte disponibilidade.",pri:"#FFC107",sec:"#161616",banner:"",wa:"5519997752573",region:"Campinas e região (consulte disponibilidade)",hours:"Consulte nossos horários pelo WhatsApp"});
const dSv=["Serviços de Solda|Reparos, adaptações e estruturas metálicas.","Pequenos Serviços Elétricos|Instalações e manutenção.","Portões, Grades e Suportes|Manutenção e reparos.","Instalação de Prateleiras e Suportes|TVs, quadros, cortinas e acessórios.","Marcenaria|Montagem e reparos em móveis de madeira.","Manutenção Residencial em Geral|Ajustes, consertos e soluções do dia a dia.","Reparos Hidráulicos|Torneiras, sifões e acessórios.","Calhas e Rufos|Instalação e pequenos reparos em calhas e rufos.","Outros Serviços|Pequenos trabalhos e adaptações conforme sua necessidade."];
const def=()=>({seq:0,clients:[],convs:[],users:[],log:[],cfg:{botOn:true,msgs:dMsgs},site:{pub:dSite(),draft:null,ver:[]},services:dSv.map((s,i)=>({id:i+1,name:s.split('|')[0],desc:s.split('|')[1],price:'',on:true}))});
export { now, dig, dMsgs, def };
export function makeBot(D){
const rid=()=>'S-'+String(D.reqs.length+1).padStart(4,'0');
function bot(cv,tx){const M=D.cfg.msgs;if(!D.cfg.botOn||cv.human)return;const t=tx.trim().toLowerCase();let r;
if(/\b(atendente|humano|pessoa)\b/.test(t)||t==='4'){r=M.human;cv.human=true;cv.status='Aguardando atendimento'}
else if(RUDE.test(t)){cv.rude=(cv.rude||0)+1;r=cv.rude>1?M.rude2:M.rude1}
else if(cv.fl&&!cv.fl.done){const f=cv.fl,s=D.services.find(x=>x.id===f.sid)||{name:'o serviço'},q=[null,s.q2||DQ2,s.q3||DQ3];f.ans.push(tx);f.i++;if(f.i<3)r=q[f.i];else{f.done=1;cv.human=true;cv.owner='';cv.status='Orçamento solicitado';D.reqs.push({id:rid(),cid:cv.cid,cvid:cv.id,svc:s.name,ans:f.ans,ch:'Chat do site',at:now()});r='Obrigado! Registramos sua solicitação sobre '+s.name+'. Nossa equipe vai analisar e retornar com o orçamento. Valores e serviços só são confirmados por uma pessoa.'}}
else if(t==='1'||/servi[cç]o/.test(t)){r=M.services;cv.step='svc'}
else if(t==='2'||/or[cç]amento/.test(t)){r=M.quote;cv.step='q';cv.status='Orçamento solicitado'}
else if(t==='3'||/hor[aá]rio|consultar/.test(t))r=M.hours;
else if(/obrigad|tchau/.test(t))r=M.bye;
else if(!cv.msgs.some(m=>m.f==='bot'))r=M.menu;
else if(cv.step){r=M.got;cv.status=cv.step==='q'?'Orçamento solicitado':'Aguardando atendimento';cv.step=''}
else{cv.unk=(cv.unk||0)+1;r=cv.unk>=3?M.unk2:M.unk}
return r}
return bot;
}
