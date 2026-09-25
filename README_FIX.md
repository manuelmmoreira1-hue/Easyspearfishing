# Easyspearfishing — correção dos Spots

## O problema
A versão anterior fazia 12 chamadas `/api/spot` ao abrir a página. Cada uma fazia mais 2 chamadas externas (Marine + Weather), ou seja, até 24 pedidos externos em simultâneo. Se o backend/serviço ou a API externa falhasse/limitasse pedidos, os 12 cartões apareciam como erro.

## O que esta versão muda
- `/api/spots` carrega os 12 spots com apenas 2 pedidos externos agrupados.
- Cache de 5 minutos no servidor.
- `/api/spot` continua disponível para compatibilidade.
- Timeout de 15 s nas fontes externas.
- `/api/health` para confirmar que o servidor está vivo.
- Frontend deixa de disparar 12 pedidos simultâneos.
- O erro passa a mostrar a causa devolvida pelo backend.

## Estrutura necessária no GitHub
```
/
  package.json
  render.yaml
  /server
    index.js
  /public
    index.html
```

## Render
Build Command: `npm install`
Start Command: `npm start`
Health Check Path: `/api/health`

Depois de fazer push para a branch ligada ao Render, aguardar o deploy terminar e abrir a página novamente com Ctrl+F5.
