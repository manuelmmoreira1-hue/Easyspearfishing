# Easyspearfishing 2.0 — versão completa

Esta versão recupera e amplia o trabalho anterior:

- 12 spots Foz do Douro → Póvoa de Varzim
- score técnico por spot
- estado/emoji
- onda, período, direção, água, vento, rajadas
- swell, período do swell, maré e corrente
- melhor janela
- previsão horária
- visibilidade atmosférica separada de visibilidade subaquática
- área de observações reais da comunidade
- média de visibilidade observada por spot
- média de condições/clareza/atividade de peixe
- número de observações e última observação
- formulário para novos relatos
- API agregada `/api/spots` para evitar 24 pedidos simultâneos
- cache do Open-Meteo
- cache-busting/no-store no frontend
- remoção do service worker antigo: NÃO incluir `public/sw.js`

## Estrutura

- `public/index.html`
- `server/index.js`
- `data/observations.json`
- `package.json`
- `render.yaml`

## Importante sobre observações

O servidor grava os relatos em `data/observations.json`. Em Render Free, o filesystem do serviço não é uma base de dados persistente: os relatos podem desaparecer depois de um novo deploy/restart. Para transformar a área de observações numa comunidade permanente, a próxima etapa deve ligar esta API a uma base de dados persistente (por exemplo Postgres/Supabase) através de variáveis de ambiente.

Não usar os valores do modelo como medição direta de visibilidade subaquática.


## V2.1 — Previsão de visibilidade subaquática

A versão 2.1 acrescenta uma estimativa de visibilidade subaquática derivada das condições disponíveis: onda, período, swell, vento e direção, rajadas, tendência recente da ondulação, chuva recente, corrente, maré e exposição relativa do spot. As observações reais recentes da comunidade podem calibrar a estimativa. A app apresenta também intervalo provável e confiança e mantém a distinção entre estimativa e observação real.


## V2.3 — apresentação da previsão
- A previsão horária mantém o cálculo completo no servidor, mas a interface mostra apenas horas de luz, aproximadamente de 3 em 3 horas.
- O servidor usa sunrise/sunset da previsão local para excluir horas noturnas.
- A memória de 72h continua a ser calculada com a série horária completa.
- A área de observações da comunidade foi movida para cima, antes da tabela horária.
- Foi adicionado um botão “Registar visibilidade” no topo do detalhe do spot para saltar diretamente para o formulário.
- Foi dado um tratamento visual ligeiramente mais marítimo; o redesign completo do layout pode ser feito numa etapa seguinte sem alterar a lógica.
