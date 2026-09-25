# Easyspearfishing V2.15 — Motor exigente

Esta versão mantém a interface e funcionalidades da V2.14 e altera apenas o motor de avaliação.

- Score hierárquico com maior peso para energia, altura da onda, rajadas e visibilidade subaquática.
- Média geométrica ponderada para impedir que vários fatores secundários compensem um fator dominante muito mau.
- Limites rígidos para combinações severas: visibilidade <1 m, rajadas >30 km/h, energia >700 kJ, onda >1,5 m e combinações de vários fatores fortes.
- Período <=10 s, onda <1 m, rajadas <10 km/h e energia <=200 kJ continuam a representar a zona favorável definida para o projeto.
- Memória das últimas 72 h com distinção entre recuperação e deterioração do mar.
- Janela favorável apenas durante a luz do dia; se não houver score >=4, apresenta “Sem janela favorável”.
- A energia em kJ é um índice calibrado do projeto, não uma leitura direta do Windguru.
- A visibilidade subaquática continua a ser uma estimativa heurística calibrável pelas observações reais da comunidade.

Teste interno do motor:
- Condições ideais: 10/10
- Condições moderadas: 7,3/10
- Caso semelhante ao observado (1,3 m / 10,9 s / rajadas 33,1 / visibilidade 1,6 m): 2,8/10
- Caso semelhante com visibilidade 1,0 m e rajadas 31,3: 1,5/10

## V2.16 — score hora a hora
- O score principal passa a seguir a hora local atual da previsão horária.
- A melhor janela de hoje considera apenas horas de luz que ainda não passaram.
- O painel de condições mostra os valores da hora atual, em vez da média diária.
- O frontend atualiza automaticamente a cada 5 minutos para acompanhar a passagem das horas.
