# Easyspearfishing 3.1

Aplicação de apoio à pesca submarina entre Foz do Douro e Póvoa de Varzim.

## Inclui
- Previsão multi-modelo de onda e vento por spot.
- 7 dias e previsão horária.
- Estimativa heurística de visibilidade subaquática.
- Score específico de pesca submarina.
- Correção do calendário para começar sempre no dia atual em Europe/Lisbon.
- Sistema de observações reais dos pescadores por spot.
- Observação: Muito boa / Boa / Média / Fraca / Muito fraca.
- Metros aproximados, estado da água e nota opcional.
- Agregação das observações recentes.

## Observações
A V3.1 guarda observações no ficheiro `data/observations.json` enquanto a instância estiver disponível. Em Render Free, o filesystem não é armazenamento permanente; para produção, a próxima fase deve ligar esta camada a uma base de dados persistente.
