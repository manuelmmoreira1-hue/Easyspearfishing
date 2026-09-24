# Easyspearfishing 2.0

Aplicação de apoio à pesca submarina para 12 spots entre Foz do Douro e Póvoa de Varzim.

## Metodologia

- Ondulação: blend explícito de DWD EWAM (45%), ECMWF WAM (35%) e Météo-France MFWAM (20%).
- Vento: blend de DWD ICON-EU (60%) e ECMWF IFS (40%).
- Os modelos são consultados para as coordenadas dos 12 spots, não para uma única localização regional.
- O score inclui a exposição direcional específica de cada spot, calculada a partir da direção de onda/swell e do azimute de exposição definido para o spot.
- A dispersão entre modelos é apresentada para indicar concordância/incerteza.
- A visibilidade subaquática é uma estimativa heurística baseada em energia/ressuspensão recente, vento/onda incidente e chuva como proxy de escorrência. Não é uma medição direta.
- Copernicus Marine Ocean Colour é identificado como futura camada de turbidez/SPM; não são inventados valores de satélite sem acesso aos dados.
- IPMA é usado como referência regional portuguesa.

## Fontes

Open-Meteo Marine API: https://open-meteo.com/en/docs/marine-weather-api
Open-Meteo Weather API: https://open-meteo.com/en/docs
Copernicus Marine Ocean Colour IBI HR: https://data.marine.copernicus.eu/product/OCEANCOLOUR_IBI_BGC_HR_L3_NRT_009_204/description
IPMA Open Data: https://api.ipma.pt/open-data/

## Nota importante

A resolução dos modelos de ondas continua a ser de vários quilómetros. Mesmo uma previsão por coordenada não transforma o modelo numa medição do ponto exato junto às pedras. A app mostra essa limitação e usa a exposição local para diferenciar os spots sem fabricar uma altura de onda medida localmente.
