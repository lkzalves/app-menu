# ROADMAP — app-menu

## Objetivo

O cliente, no restaurante, fotografa um cardápio (qualquer idioma) e vê cada prato
com foto ilustrativa e uma descrição curta, em português. Sem IA generativa de imagem.

## Requisitos que guiam as decisões

- Rápido: primeiros pratos na tela em poucos segundos, o resto chega aos poucos.
- Zero esforço: o cliente não revisa texto de OCR. Só um botão "não é esse prato".
- Multi-idioma: detectar o idioma, mostrar o nome original + tradução.
- Toda foto rotulada como "imagem ilustrativa".
- Cache compartilhado: prato resolvido uma vez serve para todos.

## Stack

- App: Angular + Ionic + Capacitor
- API e worker: NestJS
- Banco: PostgreSQL + Prisma 7 (fixado; o Prisma 8 ainda é RC)
- Fila: BullMQ + Redis
- Arquivos: disco local no dev, Cloudflare R2/S3 depois
- OCR: Google Cloud Vision (detecta o idioma sozinho); Tesseract.js só como alternativa no dev
- Tradução: DeepL ou Google Translation, atrás de uma interface
- Pratos/fotos: catálogo próprio → Wikidata/Wikipedia → Pexels/Unsplash → Brave

## Etapas

- [x] 0. Ambiente: Node, Docker, Postgres e Redis via compose
- [x] 1. API base: Prisma 7, models Menu e MenuItem, CRUD com validação
- [x] 2. Upload da foto (disco local) ligado a um Menu
- [ ] 3. OCR atrás de OcrProvider: Tesseract.js agora; Google Vision depois, se a qualidade pedir
- [ ] 4. Parser: texto do OCR → itens (nome, descrição, preço), com testes usando cardápios reais em pt, en, es, it
- [ ] 5. Tradução atrás de TranslationProvider: nome em pt (para exibir) e em en (para buscar foto)
- [ ] 6. Catálogo de pratos: Dish + DishName (nome por idioma) + DishImage (fonte, licença, crédito, votos), busca aproximada com pg_trgm + unaccent
- [ ] 7. Busca de foto e descrição: cadeia de ImageProvider (catálogo → Wikidata → Pexels → Brave), gravando no catálogo
- [ ] 8. Fila + worker: OCR, tradução e busca assíncronos; SSE mandando cada prato assim que fica pronto
- [ ] 9. App Ionic: câmera → tela de resultado progressiva → "não é esse prato" (troca a foto e alimenta o catálogo)
- [ ] 10. Produção: usuário anônimo por dispositivo, limite de uso por dispositivo, deploy, Sentry
- [ ] 11. Extras: compartilhar resultado, histórico, filtros (vegetariano, alergênicos)
