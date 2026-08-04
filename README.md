# NF Renamer Tool

Crie o visual completo de uma ferramenta web chamada NF Renamer — uma página HTML + CSS moderna, responsiva, tema escuro.

Funcionalidade (apenas visual, sem lógica JS): ferramenta que importa imagens e PDFs de notas fiscais, escaneia o texto via OCR, e permite baixar o arquivo renomeado com informações da NF.

---

Layout em 4 zonas verticais:

Zona 1 — Configuração do padrão de nome:

Campo de texto com label "Padrão do nome do arquivo". Valor padrão: NF_{NUMERO}_{DATA}_{EMITENTE}. Abaixo, chips/badges clicáveis com os tokens disponíveis: {NUMERO} {DATA} {EMITENTE} {CNPJ} {VALOR} — ao clicar insere no campo. ID obrigatório: pattern-input.

Zona 2 — Upload:

Área grande de drag & drop com ícone, texto "Arraste arquivos aqui ou clique para importar" e subtexto "Suporta JPG, PNG e PDF — múltiplos arquivos". ID obrigatório no input: file-input (type file, multiple, accept .pdf,.jpg,.jpeg,.png).

Zona 3 — Duas colunas lado a lado:

Coluna esquerda (30%) — Lista de arquivos processados. Cada item tem: checkbox de seleção, ícone do tipo (PDF/imagem), nome original, badge de status (aguardando / processando / concluído / erro). ID do container: file-list.

Coluna direita (70%) — Preview do arquivo selecionado, dividido em:

- Área de visualização da imagem/PDF: ID preview-image

- Caixa de texto somente leitura com o texto bruto extraído pelo OCR: ID preview-text

- Cards com os campos extraídos (Número NF, Data, Emitente, CNPJ, Valor Total): ID preview-fields

- Campo editável "Nome do arquivo gerado" com extensão travada no fim: ID preview-filename

Zona 4 — Barra de ações fixa no rodapé:

Botão secundário "↓ Baixar selecionados" (ID: btn-download-selected) e botão primário "↓ Baixar todos como ZIP" (ID: btn-download-zip). Contador de arquivos selecionados ao lado.

---

Estilo:

- Fonte: Inter ou similar

- Bordas arredondadas, sombras suaves

- Barra de progresso animada por arquivo durante OCR

- Estados visuais claros: hover, selecionado, erro, sucesso

---

Importante: Não escreva nenhuma lógica JavaScript. Deixe os IDs exatamente como especificados — o JS será integrado separadamente. Pode adicionar dados mockados estáticos nos componentes só para visualização.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/908d4457-ea5f-4e1c-b69f-3b999df992be).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
