# Easyspearfishing — armazenamento persistente

Esta versão mantém a V2.16 e troca apenas o armazenamento das observações/estatísticas para Supabase.

## 1. Criar o projeto Supabase
Cria um projeto gratuito em https://supabase.com/ e abre SQL Editor.

## 2. Executar SQL
Copia todo o conteúdo de `supabase.sql` para o SQL Editor e executa.

## 3. Variáveis no Render
No Render → Easyspearfishing → Environment adiciona:

- `SUPABASE_URL` = URL do projeto Supabase
- `SUPABASE_SECRET_KEY` = Secret key do projeto (não é a publishable key)

A secret key fica apenas no servidor Render e nunca é enviada para o navegador.

## 4. Deploy
Faz deploy desta versão. Se as variáveis não estiverem configuradas, a app continua a funcionar com o armazenamento local como fallback; para persistência real, as duas variáveis têm de estar configuradas.

## 5. Estatísticas
Depois do deploy:

`/stats.html`

Mostra acessos totais, acessos de hoje, visitantes/navegadores únicos, observações e spots com relatos.

## Importante
A identificação de visitante é um identificador aleatório guardado no navegador, não nome, email ou IP. “Visitantes únicos” significa navegadores/dispositivos únicos, não pessoas identificadas.
