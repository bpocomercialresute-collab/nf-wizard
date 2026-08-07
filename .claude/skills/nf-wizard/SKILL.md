---
name: nf-wizard
description: >
  Contexto e regras do projeto NF Wizard — ferramenta de OCR e
  renomeação de notas fiscais. Use ao trabalhar em qualquer parte
  deste repositório.
triggers:
  - nota fiscal
  - NF
  - OCR
  - renomear arquivo
  - padrão de nome
  - upload
  - preview
---

## Stack

- React + Vite + TypeScript
- Bun como runtime
- shadcn/ui para componentes
- Prettier configurado — rodar antes de commitar
- Hospedado na Vercel

## IDs obrigatórios (nunca renomear)

Esses IDs são fixos — o JS de OCR é integrado separadamente e depende deles:

| ID | Descrição |
|---|---|
| `pattern-input` | Campo do padrão de nome do arquivo |
| `file-input` | Input de upload (type file, multiple) |
| `file-list` | Container da lista de arquivos processados |
| `preview-image` | Área de visualização do arquivo |
| `preview-text` | Caixa de texto com OCR bruto |
| `preview-fields` | Cards com campos extraídos da NF |
| `preview-filename` | Campo editável do nome gerado |
| `btn-download-selected` | Botão baixar selecionados |
| `btn-download-zip` | Botão baixar todos como ZIP |

## Tokens de padrão de nome

`{NUMERO}` `{DATA}` `{EMITENTE}` `{CNPJ}` `{VALOR}`

## Layout (4 zonas verticais)

1. **Configuração** — padrão de nome + chips de tokens clicáveis
2. **Upload** — drag & drop, aceita JPG, PNG, PDF, múltiplos arquivos
3. **Duas colunas** — lista de arquivos (30%) + preview (70%)
4. **Rodapé fixo** — botões de download + contador de selecionados

## Convenções

- Separar visual de lógica — JS de OCR não fica misturado nos componentes visuais
- Hooks para lógica de estado
- Tema escuro, bordas arredondadas, sombras suaves
- Barra de progresso animada por arquivo durante OCR
- Estados visuais: hover, selecionado, erro, sucesso