# Easyspearfishing — Intelligence v2

Camada de inteligência para pesca submarina sobre a base Open-Meteo existente.

## Inclui
- 12 spots Foz do Douro → Póvoa de Varzim
- 7 dias / 168 horas
- histórico recente até 72 h
- estimativa de visibilidade submarina
- tendência e confiança
- Easy Spear Score
- melhor janela diurna
- chuva/runoff e energia relativa
- exposição individual por spot
- observações reais dos utilizadores
- concordância de modelos para ondas, período e vento no detalhe do spot

## Arranque
```bash
npm install
npm start
```

## Observações
As observações são guardadas em `data/observations.json`. Em Render Free, o disco local não é persistente entre certos redeploys/restarts; para produção será recomendável trocar esta camada por Postgres/Supabase/Firebase.

A visibilidade submarina é uma estimativa heurística e não uma medição direta.
