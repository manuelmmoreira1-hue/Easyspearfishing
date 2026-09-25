# Easyspearfishing — versão completa corrigida

Esta versão recupera a interface completa que já existia e mantém a correção do backend.

Inclui:
- 12 spots
- score e estado por spot
- onda, período, direção, água
- vento e rajadas
- energia estimada
- swell e período
- nível do mar/modelo de maré
- corrente
- melhor janela
- previsão horária
- distinção entre visibilidade atmosférica e subaquática
- `/api/spots` com cache de 5 minutos
- `/api/spot`
- `/api/health`

IMPORTANTE:
Substituir no GitHub os ficheiros:
- public/index.html
- server/index.js
- package.json
- render.yaml

Depois fazer commit e deixar o Render fazer o deploy automático.
