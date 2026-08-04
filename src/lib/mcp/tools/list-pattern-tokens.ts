import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

const TOKENS = [
  { token: "{NUMERO}", description: "Número da nota fiscal, sem pontuação." },
  { token: "{DATA}", description: "Data de emissão da nota fiscal." },
  { token: "{EMITENTE}", description: "Razão social do emitente." },
  { token: "{CNPJ}", description: "CNPJ do emitente, sem pontuação." },
  { token: "{VALOR}", description: "Valor total da nota fiscal." },
];

export default defineTool({
  name: "list_pattern_tokens",
  title: "Listar tokens de padrão",
  description:
    "Lista os tokens disponíveis para montar o padrão de nome de arquivo de notas fiscais no NF Renamer.",
  inputSchema: {},
  outputSchema: {
    tokens: z.array(z.object({ token: z.string(), description: z.string() })),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text", text: JSON.stringify(TOKENS, null, 2) }],
    structuredContent: { tokens: TOKENS },
  }),
});
