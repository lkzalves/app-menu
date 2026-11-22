# ROADMAP — app-menu

## Objetivo

O cliente, no restaurante, fotografa um cardápio (qualquer idioma) e vê cada prato
com foto ilustrativa e uma descrição curta, em português. Sem IA generativa de imagem.

## Requisitos que guiam as decisões

- Rápido: primeiros pratos na tela em poucos segundos, o resto chega aos poucos.
- Pouco esforço: o cliente só circula os nomes dos pratos que quer ver; não digita nem revisa texto. Só um botão "não é esse prato".
- Multi-idioma: o cliente informa o idioma do cardápio; o app mostra o nome original do prato, sem tradução.
- Toda foto rotulada como "imagem ilustrativa".
- Cache compartilhado: prato resolvido uma vez serve para todos.

## Stack

- App: Angular + Ionic + Capacitor
- API e worker: NestJS
- Banco: PostgreSQL + Prisma 7 (fixado; o Prisma 8 ainda é RC)
- Fila: BullMQ + Redis
- Arquivos: disco local no dev, Cloudflare R2/S3 depois
- OCR: Google Cloud Vision (detecta o idioma sozinho); Tesseract.js só como alternativa no dev
- Pratos/fotos: catálogo próprio → Wikidata/Wikipedia → Pixabay → Brave

## Etapas

- [x] 0. Ambiente: Node, Docker, Postgres e Redis via compose
- [x] 1. API base: Prisma 7, models Menu e MenuItem, CRUD com validação
- [x] 2. Upload da foto (disco local) ligado a um Menu
- [x] 3. OCR atrás de OcrProvider: Tesseract.js agora; Google Vision depois, se a qualidade pedir
- [x] 4. Pratos marcados: o cliente circula os nomes na foto, o app envia os retângulos e a API faz o OCR de cada recorte (nome do prato), com testes usando cardápios reais
- [x] 5. Catálogo de pratos: Dish + DishName (nome por idioma) + DishImage (fonte, licença, crédito, votos), busca aproximada com pg_trgm (nome normalizado no Node: minúsculas, sem acento, sem artigo; o unaccent do Postgres não é IMMUTABLE e não entra em índice)
- [x] 6. Busca de foto e descrição: cadeia de ImageProvider (catálogo → Wikidata → Pixabay → Brave), gravando no catálogo
  - Escopo entregue: catálogo → Pixabay (fotos) e Wikipedia (descrição em português, no Dish). Wikidata e Brave ficam como fontes futuras na mesma cadeia (token IMAGE_PROVIDERS)
  - Pixabay: `lang` = idioma do cardápio (`en` se não estiver entre os 26 aceitos), `image_type=photo`, `category=food`, `safesearch=true`; tira o artigo do início do nome
  - Só aceita o resultado se alguma tag contiver uma palavra do nome do prato; senão cai para a próxima fonte (a Pixabay não dá nota de relevância e erra pratos autorais)
  - Baixa a imagem para o storage; nunca usa a URL da Pixabay (hotlink proibido); respeita o cache de 24 h e o limite de 100 req/60 s; guarda fonte e crédito
- [x] 7. Fila + worker: OCR dos recortes e busca de foto assíncronos; SSE mandando cada prato assim que fica pronto
- [ ] 8. App Ionic: câmera → cliente escolhe o idioma do cardápio (grava em Menu.idioma) → circular os nomes dos pratos → lista progressiva (foto ilustrativa + nome original) → "não é esse prato" (troca a foto e alimenta o catálogo)
  - Ingredientes (segundo caminho de informação quando a Pixabay não tem o prato): o cliente circula o prato (amarelo) e, em seguida, as linhas de ingredientes (vermelho); o vínculo é pela ordem (o vermelho vai para o último prato circulado, até 5 linhas por prato). `POST /pratos` recebe `grupos: [{ prato, ingredientes? }]`
  - O mesmo job de OCR lê o prato e as linhas; `separarIngredientes` quebra o texto. Catálogo compartilhado `Ingrediente`/`IngredienteNome` (busca por nome normalizado exato); a lista de cada prato é `MenuItemIngrediente`
  - Descrição: Wikipédia em lote (1 job `ingredientes` por prato, na fila `descricoes`, em ~2 consultas), com singular (pomodori → pomodoro) e, se não achar no idioma do cardápio, título direto na wiki pt. Evento SSE `ingrediente`. Fotos e "não é esse prato" continuam como antes
- [ ] 9. Produção: usuário anônimo por dispositivo, limite de uso por dispositivo, deploy, Sentry
- [ ] 10. Extras: compartilhar resultado, histórico, filtros (vegetariano, alergênicos), sugestão automática dos títulos (caixas de linha do OCR) para o cliente só confirmar
