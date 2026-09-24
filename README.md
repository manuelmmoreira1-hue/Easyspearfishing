# Easyspearfishing

App de condições para pesca submarina na costa Foz do Douro → Póvoa de Varzim.

## Estrutura
- `public/index.html` — interface
- `server/index.js` — API e agregação dos dados

## Deploy
- Node.js
- Start command: `node server/index.js`
- O servidor faz **uma chamada Marine + uma chamada Weather em lote para os 12 spots**, em vez de abrir 12 pedidos simultâneos.
- Cache de 55 minutos.
- `/api/health` — estado do serviço
- `/api/test-sources` — teste rápido das fontes externas
- `/api/forecast` — previsão agregada dos 12 spots

## Fontes
Open-Meteo Marine, Open-Meteo Weather e IPMA. A visibilidade subaquática é uma estimativa heurística; não são inventados valores de Copernicus.
