# Spearo PT — protótipo web

## O que já está preparado
- Interface mobile
- 12 spots Foz → Póvoa
- Ficha individual por spot
- Backend Node/Express
- Ligação real ao endpoint diário de oceanografia da IPMA
- Campos de vento/energia/visibilidade ficam explicitamente indisponíveis quando a fonte não os fornece

## Executar
1. Instalar Node.js 18+
2. Na pasta do projeto: `npm install`
3. Executar: `npm start`
4. Abrir `http://localhost:3000`

## Próxima integração
Para produção, ligar uma fonte/API permitida para dados horários (vento, rajadas, energia), marés e observações/estimativas de visibilidade. Não fazer scraping/bypass de proteções de sites.
