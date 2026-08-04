import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sanitize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export default defineTool({
  name: "build_filename",
  title: "Montar nome do arquivo",
  description:
    "Aplica um padrão como NF_{NUMERO}_{DATA}_{EMITENTE} aos dados de uma nota fiscal e devolve o nome de arquivo final, já higienizado e com a extensão.",
  inputSchema: {
    pattern: z
      .string()
      .min(1)
      .describe("Padrão do nome, com tokens entre chaves. Ex.: NF_{NUMERO}_{DATA}_{EMITENTE}"),
    extension: z
      .string()
      .describe("Extensão do arquivo, com ou sem ponto. Ex.: pdf, .jpg, png"),
    numero: z.string().optional().describe("Número da nota fiscal."),
    data: z.string().optional().describe("Data de emissão. Ex.: 12/03/2026"),
    emitente: z.string().optional().describe("Razão social do emitente."),
    cnpj: z.string().optional().describe("CNPJ do emitente."),
    valor: z.string().optional().describe("Valor total da nota. Ex.: R$ 4.820,55"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ pattern, extension, numero, data, emitente, cnpj, valor }) => {
    const values: Record<string, string | undefined> = {
      NUMERO: numero,
      DATA: data,
      EMITENTE: emitente,
      CNPJ: cnpj,
      VALOR: valor,
    };

    const missing: string[] = [];
    const unknown: string[] = [];

    const base = pattern.replace(/\{([A-Z_]+)\}/g, (_match, token: string) => {
      if (!(token in values)) {
        unknown.push(`{${token}}`);
        return "";
      }
      const value = values[token];
      if (!value || !value.trim()) {
        missing.push(`{${token}}`);
        return "";
      }
      return sanitize(value);
    });

    if (unknown.length > 0) {
      throw new ToolError(
        `Tokens desconhecidos no padrão: ${unknown.join(", ")}. Use list_pattern_tokens para ver os válidos.`,
      );
    }
    if (missing.length > 0) {
      throw new ToolError(
        `Dados ausentes para os tokens: ${missing.join(", ")}.`,
      );
    }

    const ext = extension.replace(/^\.+/, "").toLowerCase();
    const filename = `${base.replace(/-+/g, "-").replace(/_+/g, "_")}${ext ? `.${ext}` : ""}`;

    return {
      content: [{ type: "text", text: filename }],
      structuredContent: { filename, base, extension: ext },
    };
  },
});
